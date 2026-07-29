// ============================================================
// Avatara — Behavior Patterns
// ============================================================
// Detects recurring browsing patterns (daily rhythm, habits).
// Data stored under key "behavior_patterns".
// ============================================================

import { logger } from '../../shared/logger.js';
import { getKnowledge, setKnowledge, queryExperiences } from '../storage/db.js';
import { INGESTION } from '../../shared/message-types.js';
import { KNOWLEDGE } from '../../shared/config.js';

const STORE_KEY = 'behavior_patterns';

function emptyPatterns() {
  return {
    dailyRhythm: { hourlyActivity: new Array(24).fill(0), peakHours: [], totalDays: 0 },
    habits: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Update behavior patterns from recent events.
 * @param {Array} events — recent experience stream entries
 */
export async function updateFromEvents(events) {
  if (!events || events.length === 0) return;

  const patterns = await getPatterns();
  const now = new Date().toISOString();
  const todayHourCounts = new Array(24).fill(0);

  for (const ev of events) {
    if (!ev.timestamp) continue;
    const hour = new Date(ev.timestamp).getHours();
    todayHourCounts[hour]++;
  }

  // Update daily rhythm
  for (let h = 0; h < 24; h++) {
    patterns.dailyRhythm.hourlyActivity[h] += todayHourCounts[h];
  }
  patterns.dailyRhythm.totalDays++;

  // Detect peak hours (hours where activity > 1.5x average)
  const total = patterns.dailyRhythm.hourlyActivity.reduce((a, b) => a + b, 0);
  const avg = total / Math.max(1, patterns.dailyRhythm.totalDays * 24 * 0.3); // 30% of hours active
  patterns.dailyRhythm.peakHours = [];
  for (let h = 0; h < 24; h++) {
    if (patterns.dailyRhythm.hourlyActivity[h] > avg * 1.5) {
      patterns.dailyRhythm.peakHours.push(h);
    }
  }

  // Detect habit: frequent tab openings from same domain in short window
  const PAGE_VISITS = events.filter(e => e.eventType === INGESTION.PAGE_VISITED);
  const domainBursts = {};
  for (const ev of PAGE_VISITS) {
    try {
      const domain = new URL(ev.data?.url || '').hostname.replace('www.', '');
      if (!domain) continue;
      if (!domainBursts[domain]) domainBursts[domain] = [];
      domainBursts[domain].push(ev.timestamp);
    } catch {}
  }

  for (const [domain, timestamps] of Object.entries(domainBursts)) {
    if (timestamps.length >= KNOWLEDGE.PATTERN_THRESHOLD) {
      const existing = patterns.habits.find(h => h.description.includes(domain));
      if (!existing) {
        patterns.habits.push({
          description: `Frequently visits ${domain}`,
          confidence: Math.min(1, timestamps.length / 10),
          trigger: domain,
          firstSeen: timestamps[0],
          lastSeen: timestamps[timestamps.length - 1],
        });
      } else {
        existing.confidence = Math.min(1, timestamps.length / 10);
        existing.lastSeen = timestamps[timestamps.length - 1];
      }
    }
  }

  patterns.lastUpdated = now;
  await setKnowledge(STORE_KEY, patterns);
}

/**
 * Get current behavior patterns.
 */
export async function getPatterns() {
  const stored = await getKnowledge(STORE_KEY);
  return stored || emptyPatterns();
}

/**
 * Get the typical daily activity distribution.
 */
export async function getDailyRhythm() {
  const patterns = await getPatterns();
  return patterns.dailyRhythm;
}

/**
 * Compare today's events against typical patterns.
 * Returns null if no significant anomaly detected.
 */
export async function detectAnomaly(todayEvents) {
  const patterns = await getPatterns();
  if (patterns.dailyRhythm.totalDays < 3) return null; // not enough data

  const todayHours = new Array(24).fill(0);
  for (const ev of todayEvents) {
    if (ev.timestamp) todayHours[new Date(ev.timestamp).getHours()]++;
  }

  const avgPerHour = patterns.dailyRhythm.hourlyActivity.map(
    h => h / Math.max(1, patterns.dailyRhythm.totalDays)
  );

  const deviations = [];
  for (let h = 0; h < 24; h++) {
    if (avgPerHour[h] > 2 && todayHours[h] === 0) {
      deviations.push(`No activity at hour ${h} (typically active)`);
    }
    if (todayHours[h] > avgPerHour[h] * 3 && avgPerHour[h] > 1) {
      deviations.push(`Unusually high activity at hour ${h}`);
    }
  }

  if (deviations.length > 0) {
    return { description: deviations[0], details: deviations };
  }
  return null;
}
