// ============================================================
// Avatara — Real-Time Browser Event Listeners
// ============================================================
// Thin wrappers around Chrome extension APIs.  Each listener
// normalises the raw Chrome event into a structured experience
// event and writes it to the experience stream.  No heavy
// processing — just record and move on.
//
// Listeners: tabs, tabGroups, bookmarks, downloads, webNavigation,
//            idle state
// ============================================================

import { INGESTION as CONFIG_INGESTION } from '../../shared/config.js';
import { INGESTION as MSG_INGESTION } from '../../shared/message-types.js';
import { logger } from '../../shared/logger.js';

// ===========================================================================
// Module state — populated by setupEventListeners (dependency injection)
// ===========================================================================

/** @type {(eventType: string, data: object) => Promise<number>} */
let _addEvent = null;

/** @type {(tabId: number) => Promise<object|null>} */
let _extractPageMetadata = null;

/** @type {(url: string, metadata: object) => Promise<void>} */
let _indexPage = null;

// Timer handles for deferred content extraction
/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const _extractionTimers = new Map();

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Wire up all real-time Chrome event listeners.
 *
 * Dependencies are injected so this module doesn't import across subsystem
 * boundaries (storage/experience-stream, content-extractor).
 *
 * @param {{
 *   addEvent: (eventType: string, data: object) => Promise<number>,
 *   extractPageMetadata: (tabId: number) => Promise<object|null>,
 *   indexPage: (url: string, metadata: object) => Promise<void>,
 * }} deps
 */
export function setupEventListeners({ addEvent, extractPageMetadata, indexPage }) {
  _addEvent = addEvent;
  _extractPageMetadata = extractPageMetadata;
  _indexPage = indexPage;

  // --- Tabs ---
  _setupTabListeners();

  // --- Tab Groups ---
  _setupTabGroupListeners();

  // --- Bookmarks ---
  _setupBookmarkListeners();

  // --- Downloads ---
  _setupDownloadListeners();

  // --- Web Navigation (page loads + search detection) ---
  _setupWebNavigationListeners();

  // --- Idle ---
  _setupIdleListener();

  logger.info('EventListeners', 'All listeners registered');
}

// ===========================================================================
// Tab listeners
// ===========================================================================

function _setupTabListeners() {
  // --- Tab created ---
  chrome.tabs.onCreated.addListener((tab) => {
    _safeRecord(MSG_INGESTION.TAB_ACTION, {
      action: 'created',
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || tab.pendingUrl || '',
      pinned: tab.pinned || false,
      groupId: tab.groupId ?? -1,
      index: tab.index,
    });
  });

  // --- Tab updated (URL change, title change, loading status) ---
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only log meaningful updates: URL changes or load completions
    if (changeInfo.url || changeInfo.status === 'complete') {
      _safeRecord(MSG_INGESTION.TAB_ACTION, {
        action: changeInfo.status === 'complete' ? 'loadComplete' : 'urlChanged',
        tabId,
        windowId: tab.windowId,
        url: changeInfo.url || tab.url || '',
        title: changeInfo.title || tab.title || '',
        pinned: tab.pinned || false,
        groupId: tab.groupId ?? -1,
      });

      // When a page finishes loading, schedule a deferred content extraction.
      // We only extract if the user stays on the tab long enough.
      if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
        _scheduleExtraction(tabId);
      }
    }

    // Track audible state changes (user consuming media)
    if (changeInfo.audible !== undefined) {
      _safeRecord(MSG_INGESTION.TAB_ACTION, {
        action: changeInfo.audible ? 'audible' : 'muted',
        tabId,
        url: tab.url || '',
        title: tab.title || '',
      });
    }
  });

  // --- Tab removed (closed) ---
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // Cancel any pending extraction for this tab
    _cancelExtraction(tabId);

    _safeRecord(MSG_INGESTION.TAB_ACTION, {
      action: 'closed',
      tabId,
      windowId: removeInfo.windowId,
    });
  });

  // --- Tab activated (user switched to this tab) ---
  chrome.tabs.onActivated.addListener((activeInfo) => {
    // Cancel pending extractions for the previously active tab
    // (we only extract if the tab remains active)

    chrome.tabs.get(activeInfo.tabId).then((tab) => {
      _safeRecord(MSG_INGESTION.TAB_ACTION, {
        action: 'activated',
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
        url: tab.url || '',
        title: tab.title || '',
      });
    }).catch(() => {
      // Tab may already be gone
    });
  });
}

// ===========================================================================
// Tab Group listeners
// ===========================================================================

function _setupTabGroupListeners() {
  chrome.tabGroups.onCreated.addListener((group) => {
    _safeRecord(MSG_INGESTION.TAB_ACTION, {
      action: 'groupCreated',
      groupId: group.id,
      title: group.title || '',
      color: group.color,
      windowId: group.windowId,
    });
  });

  chrome.tabGroups.onUpdated.addListener((group) => {
    _safeRecord(MSG_INGESTION.TAB_ACTION, {
      action: 'groupUpdated',
      groupId: group.id,
      title: group.title || '',
      color: group.color,
    });
  });

  chrome.tabGroups.onRemoved.addListener((group) => {
    _safeRecord(MSG_INGESTION.TAB_ACTION, {
      action: 'groupRemoved',
      groupId: group.id,
    });
  });
}

// ===========================================================================
// Bookmark listeners
// ===========================================================================

function _setupBookmarkListeners() {
  chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    let domain = '';
    try {
      if (bookmark.url) domain = new URL(bookmark.url).hostname;
    } catch (_) { /* ignore */ }

    _safeRecord(MSG_INGESTION.BOOKMARK_ACTION, {
      action: 'created',
      id,
      parentId: bookmark.parentId || '',
      title: bookmark.title || '',
      url: bookmark.url || '',
      domain,
    });
  });

  chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
    _safeRecord(MSG_INGESTION.BOOKMARK_ACTION, {
      action: 'removed',
      id,
      parentId: removeInfo.parentId || '',
      title: '', // removeInfo only has index + parentId + node info
    });
  });

  chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    _safeRecord(MSG_INGESTION.BOOKMARK_ACTION, {
      action: 'changed',
      id,
      title: changeInfo.title || '',
      url: changeInfo.url || '',
    });
  });

  chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    _safeRecord(MSG_INGESTION.BOOKMARK_ACTION, {
      action: 'moved',
      id,
      parentId: moveInfo.parentId || '',
      oldParentId: moveInfo.oldParentId || '',
      oldIndex: moveInfo.oldIndex,
      index: moveInfo.index,
    });
  });
}

// ===========================================================================
// Download listeners
// ===========================================================================

function _setupDownloadListeners() {
  chrome.downloads.onCreated.addListener((downloadItem) => {
    let domain = '';
    try {
      domain = new URL(downloadItem.url).hostname;
    } catch (_) { /* ignore */ }

    _safeRecord(MSG_INGESTION.DOWNLOAD_ACTION, {
      action: 'started',
      id: downloadItem.id,
      url: downloadItem.url,
      domain,
      filename: downloadItem.filename || '',
      fileSize: downloadItem.fileSize || 0,
      mime: downloadItem.mime || '',
    });
  });

  chrome.downloads.onChanged.addListener((delta) => {
    // Only record when a download completes or is interrupted
    if (delta.state) {
      _safeRecord(MSG_INGESTION.DOWNLOAD_ACTION, {
        action: delta.state.current, // 'complete' or 'interrupted'
        id: delta.id,
      });
    }
  });
}

// ===========================================================================
// Web Navigation listeners (page loads, search detection)
// ===========================================================================

function _setupWebNavigationListeners() {
  chrome.webNavigation.onCompleted.addListener((details) => {
    // Only track main frame navigations (not iframes)
    if (details.frameId !== 0) return;

    _safeRecord(MSG_INGESTION.PAGE_VISITED, {
      url: details.url,
      tabId: details.tabId,
      timeStamp: new Date(details.timeStamp).toISOString(),
      transitionType: details.transitionType || '',
    });

    // Detect search queries in the URL
    const searchQuery = _detectSearchQuery(details.url);
    if (searchQuery) {
      _safeRecord(MSG_INGESTION.SEARCH_PERFORMED, {
        query: searchQuery.query,
        engine: searchQuery.engine,
        url: details.url,
        tabId: details.tabId,
        timeStamp: new Date(details.timeStamp).toISOString(),
      });
    }
  });
}

// ===========================================================================
// Idle listener
// ===========================================================================

function _setupIdleListener() {
  // Listen for both 'idle' and 'locked' states (Chrome's idle API default
  // detection interval is 60 seconds).
  chrome.idle.onStateChanged.addListener((newState) => {
    _safeRecord('ingestion:idleState', {
      state: newState, // 'active' | 'idle' | 'locked'
    });
  });
}

// ===========================================================================
// Search query detection
// ===========================================================================

/**
 * Detect search engines in a URL and extract the query string.
 * Returns null if the URL doesn't match a known search pattern.
 *
 * @param {string} url
 * @returns {{ engine: string, query: string }|null}
 */
function _detectSearchQuery(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // Google
    if (host.includes('google.')) {
      const q = parsed.searchParams.get('q');
      if (q) return { engine: 'google', query: q };
    }

    // Bing
    if (host.includes('bing.com')) {
      const q = parsed.searchParams.get('q');
      if (q) return { engine: 'bing', query: q };
    }

    // DuckDuckGo
    if (host.includes('duckduckgo.com')) {
      const q = parsed.searchParams.get('q');
      if (q) return { engine: 'duckduckgo', query: q };
    }

    // Baidu
    if (host.includes('baidu.com')) {
      const q = parsed.searchParams.get('wd') || parsed.searchParams.get('word');
      if (q) return { engine: 'baidu', query: q };
    }

    // Yandex
    if (host.includes('yandex.')) {
      const q = parsed.searchParams.get('text');
      if (q) return { engine: 'yandex', query: q };
    }

    // Brave Search
    if (host.includes('search.brave.com')) {
      const q = parsed.searchParams.get('q');
      if (q) return { engine: 'brave', query: q };
    }

    // Kagi
    if (host.includes('kagi.com')) {
      const q = parsed.searchParams.get('q');
      if (q) return { engine: 'kagi', query: q };
    }
  } catch (_) {
    // Invalid URL — not a concern
  }

  return null;
}

// ===========================================================================
// Content extraction scheduling
// ===========================================================================

/**
 * Schedule deferred metadata extraction for a tab.
 * Extraction fires after MIN_VISIT_DURATION_MS, but only if the tab
 * hasn't been navigated away or closed in the meantime.
 *
 * @param {number} tabId
 */
function _scheduleExtraction(tabId) {
  // Cancel any pending extraction for this tab
  _cancelExtraction(tabId);

  const handle = setTimeout(async () => {
    _extractionTimers.delete(tabId);

    // Verify the tab still exists
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;
    } catch (_) {
      return; // Tab gone
    }

    const metadata = await _extractPageMetadata(tabId);
    if (!metadata) return;

    // Record the enriched page visit
    let domain = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      domain = tab.url ? new URL(tab.url).hostname : '';
    } catch (_) { /* ignore */ }

    await _safeRecord(MSG_INGESTION.PAGE_VISITED, {
      ...metadata,
      domain,
      tabId,
      source: 'content_extractor',
    });

    // Index the page for search (async, fire-and-forget)
    if (_indexPage && metadata.url) {
      _indexPage(metadata.url, metadata).catch(() => {});
    }
  }, CONFIG_INGESTION.MIN_VISIT_DURATION_MS);

  _extractionTimers.set(tabId, handle);
}

/**
 * Cancel a pending extraction timer for a tab.
 * @param {number} tabId
 */
function _cancelExtraction(tabId) {
  const handle = _extractionTimers.get(tabId);
  if (handle) {
    clearTimeout(handle);
    _extractionTimers.delete(tabId);
  }
}

// ===========================================================================
// Safe record helper
// ===========================================================================

/**
 * Call addEvent AND broadcast a message so the knowledge engine can
 * process the event asynchronously.  Both operations are fire-and-forget;
 * errors are silently swallowed so a single failure cannot crash the SW.
 *
 * @param {string} eventType
 * @param {object} data
 */
async function _safeRecord(eventType, data) {
  try {
    if (!_addEvent) {
      logger.warn('EventListeners', 'addEvent not wired — skipping record');
      return;
    }
    // 1. Persist to experience stream (source of truth)
    await _addEvent(eventType, data);

    // 2. Broadcast so the knowledge engine can react in real time
    chrome.runtime.sendMessage({ type: eventType, data }).catch(() => {
      // No listener is normal — the knowledge engine may not be loaded yet.
    });
  } catch (err) {
    logger.error('EventListeners', `Record failed for ${eventType}`, err);
  }
}
