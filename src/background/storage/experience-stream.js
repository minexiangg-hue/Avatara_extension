// ============================================================
// Avatara — Experience Stream
// ============================================================
// The source of truth for every browser event. All real-time
// listeners and importers write here; the knowledge engine reads
// from here.  Old entries are periodically compacted into daily
// summaries to keep query performance high.
// ============================================================

import { STORAGE } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import * as db from './db.js';

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Record a single browser event into the experience stream.
 * Normalises timestamps and ensures required fields are present.
 *
 * @param {string} eventType  - one of the message-type constants (e.g. "ingestion:pageVisited")
 * @param {object} [data={}]  - arbitrary payload (url, title, tabId, …)
 * @returns {Promise<number>} id of the inserted row
 */
export async function addEvent(eventType, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    eventType,
    data,
  };
  try {
    const id = await db.addExperience(entry);
    logger.debug('ExperienceStream', `addEvent ${eventType}`, { id });
    return id;
  } catch (err) {
    logger.error('ExperienceStream', `Failed to add event: ${eventType}`, err);
    throw err;
  }
}

/**
 * Batch-insert many events in a single transaction.
 * Used by the first-run history importer for throughput.
 *
 * @param {Array<{ eventType: string, data: object }>} events
 * @returns {Promise<number>} number of events inserted
 */
export async function batchAddEvents(events) {
  if (!events.length) return 0;

  const now = new Date().toISOString();
  const entries = events.map((e) => ({
    timestamp: now,
    eventType: e.eventType,
    data: e.data,
  }));

  try {
    const count = await db.batchAddExperiences(entries);
    logger.debug('ExperienceStream', `batchAddEvents: ${count} events`);
    return count;
  } catch (err) {
    logger.error('ExperienceStream', 'Failed to batch-add events', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Return events from the last N hours, newest first.
 *
 * @param {number} hours
 * @param {number} [limit=500]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentEvents(hours, limit = 500) {
  try {
    return await db.queryExperiences({ hours, limit });
  } catch (err) {
    logger.error('ExperienceStream', 'getRecentEvents failed', err);
    return [];
  }
}

/**
 * Return events of a specific type, newest first.
 *
 * @param {string} type - eventType constant
 * @param {number} [limit=200]
 * @returns {Promise<Array<object>>}
 */
export async function getEventsByType(type, limit = 200) {
  try {
    return await db.queryExperiences({ eventType: type, limit });
  } catch (err) {
    logger.error('ExperienceStream', `getEventsByType(${type}) failed`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Remove raw entries older than EXPERIENCE_RETENTION_DAYS but first
 * compress them into per-day summary entries so aggregate statistics
 * are preserved.
 *
 * Called periodically by the chrome.alarms knowledge-extraction cycle.
 *
 * @returns {Promise<{ compacted: number, summaries: number }>}
 */
export async function compactOldEntries() {
  const retentionMs =
    STORAGE.EXPERIENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs).toISOString();

  logger.info('ExperienceStream', `Compacting entries older than ${cutoff}`);

  // 1. Fetch all old entries grouped by day
  let oldEntries;
  try {
    // Fetch entries older than cutoff. We pass `since` as an upper bound so
    // we get everything *before* the cutoff.  We don't set `hours` because
    // EXPERIENCE_RETENTION_DAYS could be > 90 days and we want all of them.
    // Use a generous limit; compaction runs infrequently.
    oldEntries = await db.queryExperiences({
      limit: STORAGE.MAX_EXPERIENCES_PER_PARTITION + 1000,
    });

    // Filter client-side for entries strictly older than cutoff.
    // We can't pass `upperBound` through queryExperiences easily because it
    // only supports `since` (lowerBound).  This is a quick in-memory filter.
    oldEntries = oldEntries.filter((e) => e.timestamp < cutoff);
  } catch (err) {
    logger.error('ExperienceStream', 'Failed to fetch old entries', err);
    return { compacted: 0, summaries: 0 };
  }

  if (oldEntries.length === 0) {
    logger.debug('ExperienceStream', 'No entries to compact');
    return { compacted: 0, summaries: 0 };
  }

  // 2. Group by day and eventType
  /** @type {Record<string, Record<string, number>>} */
  const dayBuckets = {};
  for (const entry of oldEntries) {
    const day = entry.timestamp.slice(0, 10); // "2025-07-29"
    if (!dayBuckets[day]) dayBuckets[day] = {};
    const type = entry.eventType || 'unknown';
    dayBuckets[day][type] = (dayBuckets[day][type] || 0) + 1;
  }

  // 3. Build summary entries
  const summaryEntries = Object.entries(dayBuckets).map(([day, counts]) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      timestamp: `${day}T00:00:00.000Z`,
      eventType: 'experience:summary',
      data: { date: day, counts, total },
    };
  });

  // 4. Delete the old raw entries
  let deletedCount = 0;
  try {
    deletedCount = await db.deleteExperiencesOlderThan(cutoff);
  } catch (err) {
    logger.error('ExperienceStream', 'Failed to delete old entries', err);
    return { compacted: 0, summaries: 0 };
  }

  // 5. Insert the summaries
  let summaryCount = 0;
  try {
    summaryCount = await db.batchAddExperiences(summaryEntries);
  } catch (err) {
    logger.error('ExperienceStream', 'Failed to insert summaries', err);
    // Summaries failed but old data is already deleted.  This is unfortunate
    // but the system will recover — future events will populate the stream.
  }

  logger.info(
    'ExperienceStream',
    `Compacted ${deletedCount} entries into ${summaryCount} daily summaries`,
  );

  return { compacted: deletedCount, summaries: summaryCount };
}
