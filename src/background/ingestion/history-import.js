// ============================================================
// Avatara — First-Run History & Bookmark Importer
// ============================================================
// On install (and only on install) we seed the experience stream
// with the user's existing browsing history and bookmarks so the
// knowledge engine has a meaningful corpus to work with from day
// one.  The import runs in the background; progress is reported
// via chrome.runtime.sendMessage.
// ============================================================

import { INGESTION as CONFIG_INGESTION } from '../../shared/config.js';
import { INGESTION as MSG_INGESTION } from '../../shared/message-types.js';
import { logger } from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Progress state (stored in chrome.storage.local for crash-resume safety)
// ---------------------------------------------------------------------------
const STATE_KEY = 'avatara_import_state';

/** @typedef {{ phase: 'idle'|'history'|'bookmarks'|'done', current: number, total: number, startedAt: string }} ImportState */

/**
 * @returns {Promise<ImportState>}
 */
async function _getState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  return result[STATE_KEY] || { phase: 'idle', current: 0, total: 0, startedAt: '' };
}

async function _setState(partial) {
  const current = await _getState();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [STATE_KEY]: next });
}

/**
 * Send a progress update to any listening UI (sidepanel / popup).
 */
function _sendProgress(current, total, phase) {
  chrome.runtime
    .sendMessage({
      type: 'ingestion:historyImportProgress',
      current,
      total,
      phase,
    })
    .catch(() => {
      // No listener is fine — UI may not be open.
    });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kick off history + bookmark import.
 *
 * Safe to call multiple times: if an import is already in progress or
 * finished it will be skipped.
 *
 * @param {{ addEvent: (type: string, data: object) => Promise<number> }} deps
 * @returns {Promise<void>}
 */
export async function startHistoryImport({ addEvent }) {
  const state = await _getState();
  if (state.phase === 'done') {
    logger.info('HistoryImport', 'Import already completed, skipping');
    return;
  }

  logger.info('HistoryImport', 'Starting first-run import…');

  try {
    // Phase 1 — History
    await _setState({
      phase: 'history',
      current: 0,
      total: 0,
      startedAt: new Date().toISOString(),
    });

    const historyCount = await _importHistory({ addEvent });

    // Phase 2 — Bookmarks
    await _setState({ phase: 'bookmarks', current: 0, total: 0 });

    const bookmarkCount = await _importBookmarks({ addEvent });

    // Done
    await _setState({ phase: 'done' });

    logger.info(
      'HistoryImport',
      `Import complete: ${historyCount} history, ${bookmarkCount} bookmarks`,
    );

    chrome.runtime
      .sendMessage({
        type: MSG_INGESTION.HISTORY_IMPORT_DONE,
        count: historyCount,
        bookmarkCount,
      })
      .catch(() => {});
  } catch (err) {
    logger.error('HistoryImport', 'Import failed', err);
    // Reset so it can be retried on next startup
    await _setState({ phase: 'idle' });
  }
}

// ---------------------------------------------------------------------------
// History import (internal)
// ---------------------------------------------------------------------------

/**
 * Import chrome.history items in time-slice batches until we hit
 * MAX_HISTORY_IMPORT or run out of items.
 *
 * @returns {Promise<number>} total imported
 */
async function _importHistory({ addEvent }) {
  const MAX_RESULTS = 2000; // chrome.history.search practical cap per call
  let totalImported = 0;
  const maxTotal = CONFIG_INGESTION.MAX_HISTORY_IMPORT;

  // Walk backwards in 90-day windows
  let endTime = Date.now();
  let windowStart = endTime - 90 * 24 * 3600 * 1000;

  while (totalImported < maxTotal) {
    /** @type {chrome.history.HistoryItem[]} */
    let items;
    try {
      items = await chrome.history.search({
        text: '',
        maxResults: MAX_RESULTS,
        startTime: windowStart,
        endTime,
      });
    } catch (err) {
      logger.error('HistoryImport', 'chrome.history.search failed', err);
      break;
    }

    if (!items || items.length === 0) break;

    // Build batch entries
    const batch = [];
    for (const item of items) {
      if (totalImported + batch.length >= maxTotal) break;

      let domain = '';
      try {
        domain = new URL(item.url).hostname;
      } catch (_) {
        /* malformed URL — skip domain */
      }

      batch.push({
        eventType: MSG_INGESTION.PAGE_VISITED,
        data: {
          url: item.url,
          title: item.title || '',
          domain,
          visitCount: item.visitCount || 0,
          lastVisitTime: item.lastVisitTime
            ? new Date(item.lastVisitTime).toISOString()
            : '',
          source: 'history_import',
        },
      });
    }

    // Write batch via a series of individual addEvent calls.
    // Individual calls avoid monolithic transactions that could timeout.
    for (const evt of batch) {
      try {
        await addEvent(evt.eventType, evt.data);
        totalImported++;
      } catch (err) {
        logger.error('HistoryImport', 'Failed to write event', err);
        // Continue with remaining items
      }
    }

    _sendProgress(totalImported, maxTotal, 'history');

    // Slide the time window backwards
    endTime = windowStart;
    windowStart = endTime - 90 * 24 * 3600 * 1000;

    // Yield to the event loop so the SW stays responsive
    await new Promise((r) => setTimeout(r, 50));

    // If the last batch was smaller than MAX_RESULTS, we've exhausted history
    if (items.length < MAX_RESULTS) break;
  }

  return totalImported;
}

// ---------------------------------------------------------------------------
// Bookmark import (internal)
// ---------------------------------------------------------------------------

/**
 * Walk the bookmark tree and import each bookmark as a PAGE_VISITED event.
 *
 * @returns {Promise<number>} total bookmarks imported
 */
async function _importBookmarks({ addEvent }) {
  let totalImported = 0;
  const maxTotal = CONFIG_INGESTION.MAX_BOOKMARK_IMPORT;

  /**
   * Recursively flatten the bookmark tree nodes.
   * @param {chrome.bookmarks.BookmarkTreeNode[]} nodes
   * @returns {chrome.bookmarks.BookmarkTreeNode[]}
   */
  function _flatten(nodes) {
    const result = [];
    for (const node of nodes) {
      if (node.url) result.push(node); // leaf bookmark
      if (node.children) result.push(..._flatten(node.children));
    }
    return result;
  }

  let tree;
  try {
    tree = await chrome.bookmarks.getTree();
  } catch (err) {
    logger.error('HistoryImport', 'chrome.bookmarks.getTree failed', err);
    return 0;
  }

  const bookmarks = _flatten(tree);
  logger.info('HistoryImport', `Found ${bookmarks.length} bookmarks`);

  for (const bm of bookmarks) {
    if (totalImported >= maxTotal) break;

    let domain = '';
    try {
      domain = new URL(bm.url).hostname;
    } catch (_) {
      /* malformed URL */
    }

    try {
      await addEvent(MSG_INGESTION.BOOKMARK_ACTION, {
        url: bm.url,
        title: bm.title || '',
        domain,
        dateAdded: bm.dateAdded ? new Date(bm.dateAdded).toISOString() : '',
        parentId: bm.parentId || '',
        source: 'bookmark_import',
      });
      totalImported++;
    } catch (err) {
      logger.error('HistoryImport', 'Failed to write bookmark event', err);
    }

    // Yield periodically
    if (totalImported % 100 === 0) {
      _sendProgress(totalImported, Math.min(bookmarks.length, maxTotal), 'bookmarks');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  return totalImported;
}
