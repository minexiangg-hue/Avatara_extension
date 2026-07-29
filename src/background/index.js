// ============================================================
// Avatara — Service Worker Entry Point
// ============================================================
// Orchestrates all background subsystems:
//   - Installs event listeners (tabs, bookmarks, downloads, …)
//   - Routes chrome.runtime.onMessage to the correct handler
//   - Manages chrome.alarms for periodic knowledge extraction
//   - Sets up context menu + side panel click handler
//   - Kicks off first-run history / bookmark import
// ============================================================

// --- Shared ---
import { APP, STORAGE as CONFIG_STORAGE, INGESTION, KNOWLEDGE } from '../shared/config.js';
import {
  INGESTION as MSG_INGESTION,
  KNOWLEDGE as MSG_KNOWLEDGE,
  BUTLER as MSG_BUTLER,
  ALERTS as MSG_ALERTS,
  GOALS as MSG_GOALS,
  STORAGE as MSG_STORAGE,
  UI as MSG_UI,
  LICENSE as MSG_LICENSE,
} from '../shared/message-types.js';
import { logger } from '../shared/logger.js';
import { i18n } from '../shared/i18n.js';

// --- Storage subsystem ---
import * as experienceStream from './storage/experience-stream.js';
import * as settings from './storage/settings.js';
import * as db from './storage/db.js';

// --- Ingestion subsystem ---
import { startHistoryImport } from './ingestion/history-import.js';
import { setupEventListeners } from './ingestion/event-listeners.js';
import { extractPageMetadata } from './ingestion/content-extractor.js';

// ===========================================================================
// Alarm names
// ===========================================================================
const ALARM_KNOWLEDGE_EXTRACTION = 'avatara:knowledgeExtraction';
const ALARM_COMPACTION = 'avatara:compaction';

// ===========================================================================
// Install / Startup
// ===========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('BG', `onInstalled reason=${details.reason}`);

  if (details.reason === 'install') {
    // First install — kick off history & bookmark import
    logger.info('BG', 'First install detected — starting import');
    startHistoryImport({ addEvent: experienceStream.addEvent });
  }

  // Set up context menu (always — idempotent via removeAll)
  _setupContextMenu();

  // Set up periodic alarms (always)
  _setupAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  logger.info('BG', 'onStartup');

  // If the import was interrupted by browser shutdown, try to resume it.
  const firstRun = await settings.isFirstRun();
  if (firstRun) {
    logger.info('BG', 'First-run not complete — resuming import');
    startHistoryImport({ addEvent: experienceStream.addEvent });
  }
});

// ===========================================================================
// Event Listeners — set up immediately (module top-level, runs once)
// ===========================================================================
setupEventListeners({
  addEvent: experienceStream.addEvent,
  extractPageMetadata,
});

// ===========================================================================
// Context Menu
// ===========================================================================

function _setupContextMenu() {
  // Remove all existing items first (idempotent)
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'avatara-ask-page',
      title: 'Ask Avatara about this page',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'avatara-summarize-page',
      title: 'Summarize this page',
      contexts: ['page'],
    });

    chrome.contextMenus.create({
      id: 'avatara-ask-selection',
      title: 'Ask Avatara about "%s"',
      contexts: ['selection'],
    });

    logger.info('BG', 'Context menus registered');
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (!tabId) return;

  // Open the side panel and send the user's intent
  chrome.sidePanel.open({ tabId }).catch((err) => {
    logger.error('BG', 'Failed to open side panel', err);
  });

  // Store the context intent so the side panel can pick it up on load.
  // Using session storage (cleared when browser closes — appropriate for
  // transient UI context).
  const payload = {
    action: info.menuItemId,
    url: info.pageUrl,
    selection: info.selectionText || '',
  };

  chrome.storage.session.set({ avatara_context_intent: payload }).catch(() => {});

  chrome.runtime
    .sendMessage({ type: 'ui:contextIntent', payload })
    .catch(() => {
      // Side panel may not be ready yet — it'll read from session storage on mount.
      logger.debug('BG', 'Context intent stored; side panel not yet listening');
    });
});

// ===========================================================================
// Side Panel click (toolbar icon)
// ===========================================================================

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  // In case Chrome version doesn't support this API
  logger.debug('BG', 'setPanelBehavior not supported');
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    logger.error('BG', 'Failed to open side panel via action', err);
  });
});

// ===========================================================================
// Commands (keyboard shortcuts from manifest)
// ===========================================================================

chrome.commands.onCommand.addListener(async (command) => {
  logger.debug('BG', `Command received: ${command}`);

  // Find the active tab to anchor the side panel
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'open-side-panel') {
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      logger.error('BG', 'Failed to open side panel via command', err);
    });
  }

  if (command === 'quick-search') {
    // Open side panel with a search intent so it focuses the search input
    chrome.storage.session
      .set({ avatara_context_intent: { action: 'quick-search' } })
      .catch(() => {});
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      logger.error('BG', 'Failed to open side panel via quick-search', err);
    });
  }
});

// ===========================================================================
// chrome.alarms — Periodic tasks
// ===========================================================================

function _setupAlarms() {
  // Knowledge extraction — run every EXTRACTION_INTERVAL_MIN minutes
  chrome.alarms.create(ALARM_KNOWLEDGE_EXTRACTION, {
    delayInMinutes: 1, // first run soon after install
    periodInMinutes: KNOWLEDGE.EXTRACTION_INTERVAL_MIN,
  });

  // Compaction — run once per day
  chrome.alarms.create(ALARM_COMPACTION, {
    delayInMinutes: 60,
    periodInMinutes: 24 * 60,
  });

  logger.info('BG', 'Alarms registered');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  logger.debug('BG', `Alarm fired: ${alarm.name}`);

  if (alarm.name === ALARM_KNOWLEDGE_EXTRACTION) {
    // Compact old entries (aggregate into daily summaries)
    await experienceStream.compactOldEntries();

    // Broadcast a snapshot so the knowledge engine can process new events.
    // The knowledge engine (loaded in a future phase) listens for this and
    // runs interest clustering, pattern detection, etc.
    chrome.runtime
      .sendMessage({ type: MSG_KNOWLEDGE.BEHAVIOR_SNAPSHOT })
      .catch(() => {
        // No listener yet — that's fine.
      });
  }

  if (alarm.name === ALARM_COMPACTION) {
    const result = await experienceStream.compactOldEntries();
    logger.info(
      'BG',
      `Compaction complete: ${result.compacted} removed, ${result.summaries} summaries`,
    );
  }
});

// ===========================================================================
// Message Router
// ===========================================================================

/**
 * Map of message type to handler function.
 * Each handler receives (payload, sender) and must return a value (or
 * Promise) that becomes the `data` field of the response sent back.
 *
 * @type {Record<string, (payload: any, sender: chrome.runtime.MessageSender) => any>}
 */
const messageRouter = {
  // --- Storage ---
  [MSG_STORAGE.QUERY]: async (payload) => {
    // Payload expected: { store: 'experience'|'content', query/hours/limit }
    if (payload?.store === 'experience') {
      return experienceStream.getRecentEvents(payload.hours || 24, payload.limit);
    }
    if (payload?.store === 'content') {
      return db.queryContentIndex({ query: payload.query, limit: payload.limit });
    }
    throw new Error(`Unknown store: ${payload?.store}`);
  },

  [MSG_STORAGE.GET_STATS]: async () => {
    const [recentEvents, pendingAlerts, goals] = await Promise.all([
      experienceStream.getRecentEvents(24, 1000),
      db.getPendingAlerts(),
      db.getAllGoals(),
    ]);
    return {
      events24h: recentEvents.length,
      pendingAlerts: pendingAlerts.length,
      activeGoals: goals.filter((g) => g.active !== false).length,
    };
  },

  [MSG_STORAGE.EXPORT_DATA]: async () => {
    const [recentExperiences, contentIndex, goals, alerts] = await Promise.all([
      experienceStream.getRecentEvents(
        CONFIG_STORAGE.EXPERIENCE_RETENTION_DAYS * 24,
        100000,
      ),
      db.queryContentIndex({ limit: 100000 }),
      db.getAllGoals(),
      db.getPendingAlerts(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      version: APP.VERSION,
      experiences: recentExperiences,
      contentIndex,
      goals,
      alerts,
    };
  },

  [MSG_STORAGE.CLEAR_DATA]: async () => {
    await db.clearAllData();
    logger.warn('BG', 'All data cleared by user request');
    return { cleared: true };
  },

  // --- Goals ---
  [MSG_GOALS.CREATE]: async (payload) => {
    const id = await db.addGoal({
      description: payload.description || '',
      target: payload.target || 0,
      unit: payload.unit || '',
      progress: 0,
      created: new Date().toISOString(),
      active: true,
    });
    return { id };
  },

  [MSG_GOALS.UPDATE]: async (payload) => {
    await db.updateGoal(payload.id, payload.updates);
    return { updated: true };
  },

  [MSG_GOALS.DELETE]: async (payload) => {
    await db.deleteGoal(payload.id);
    return { deleted: true };
  },

  [MSG_GOALS.PROGRESS]: async (payload) => {
    // payload: { id, progress }
    await db.updateGoal(payload.id, { progress: payload.progress });
    return { updated: true };
  },

  [MSG_GOALS.LIST]: async () => {
    return db.getAllGoals();
  },

  // --- Alerts ---
  [MSG_ALERTS.DISMISS]: async (payload) => {
    await db.dismissAlert(payload.id);
    return { dismissed: true };
  },

  // --- Butler (stubs for now — the butler subsystem will replace these) ---
  [MSG_BUTLER.NL_SEARCH]: async (_payload) => {
    logger.debug('BG', 'NL_SEARCH — not yet implemented');
    return { results: [], note: 'NL search engine not yet available' };
  },

  [MSG_BUTLER.NL_COMMAND]: async (_payload) => {
    logger.debug('BG', 'NL_COMMAND — not yet implemented');
    return { ok: false, note: 'NL command engine not yet available' };
  },

  [MSG_BUTLER.GET_INSIGHTS]: async () => {
    // Quick insights: top domains in the last 7 days
    const recent = await experienceStream.getRecentEvents(24 * 7, 5000);
    const pageVisits = recent.filter(
      (e) => e.eventType === MSG_INGESTION.PAGE_VISITED,
    );

    /** @type {Record<string, number>} */
    const domainCount = {};
    for (const evt of pageVisits) {
      const domain = evt.data?.domain;
      if (domain) {
        domainCount[domain] = (domainCount[domain] || 0) + 1;
      }
    }

    const topSites = Object.entries(domainCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }));

    return {
      totalEvents: recent.length,
      pageVisits: pageVisits.length,
      topSites,
      period: '7d',
    };
  },

  [MSG_BUTLER.GET_DAILY_DIGEST]: async (_payload) => {
    logger.debug('BG', 'GET_DAILY_DIGEST — not yet implemented');
    return { digest: '', note: 'Daily digest not yet available' };
  },

  [MSG_BUTLER.GET_TRENDS]: async (_payload) => {
    logger.debug('BG', 'GET_TRENDS — not yet implemented');
    return { trends: [], note: 'Trend analysis not yet available' };
  },

  // --- UI ---
  [MSG_UI.OPEN_SIDEPANEL]: async (_payload, sender) => {
    const tabId = sender?.tab?.id;
    if (tabId) {
      await chrome.sidePanel.open({ tabId });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    }
    return { opened: true };
  },

  [MSG_UI.SHOW_INSIGHT]: async (_payload) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.storage.session
        .set({ avatara_context_intent: { action: 'show-insight' } })
        .catch(() => {});
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    return { opened: true };
  },

  [MSG_UI.THEME_CHANGED]: async (payload) => {
    await settings.setSetting('avatara_theme', payload?.theme || 'system');
    return { theme: payload?.theme || 'system' };
  },

  [MSG_UI.LANGUAGE_CHANGED]: async (payload) => {
    if (payload?.lang) {
      await i18n.setLang(payload.lang);
    }
    return { lang: i18n.getLang() };
  },

  // --- License ---
  [MSG_LICENSE.CHECK_STATUS]: async () => {
    const tier = await settings.getTier();
    return { tier };
  },

  [MSG_LICENSE.UPGRADE]: async (_payload) => {
    logger.debug('BG', 'LICENSE_UPGRADE — not yet implemented');
    return { ok: false, note: 'License upgrade flow not yet available' };
  },

  [MSG_LICENSE.FEATURE_GATED]: async (payload) => {
    const tier = await settings.getTier();
    return { tier, feature: payload?.feature || '' };
  },
};

// ===========================================================================
// onMessage dispatcher
// ===========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Guard: messages must have a recognised type
  if (!message || typeof message.type !== 'string') {
    logger.warn('BG', 'Received message without valid type', message);
    sendResponse({ error: 'Invalid message: missing type' });
    return false; // synchronous response, no keep-alive needed
  }

  const { type } = message;
  const payload = message.payload ?? message.data ?? {};

  const handler = messageRouter[type];
  if (!handler) {
    logger.debug('BG', `Unhandled message type: ${type}`);
    sendResponse({ error: `Unknown message type: ${type}` });
    return false;
  }

  // Execute handler asynchronously and send the response when ready.
  // Return `true` to tell Chrome to keep the message channel open.
  Promise.resolve()
    .then(() => handler(payload, sender))
    .then((result) => {
      try {
        sendResponse({ data: result });
      } catch (_) {
        // Receiver may already be gone
      }
    })
    .catch((err) => {
      logger.error('BG', `Handler error for ${type}`, err);
      try {
        sendResponse({ error: err.message || 'Internal error' });
      } catch (_) {
        // Receiver may already be gone
      }
    });

  return true; // keep channel open for async response
});

// ===========================================================================
// Initialisation complete
// ===========================================================================

// Restore language from stored preference
settings
  .getLanguage()
  .then((lang) => {
    i18n.init(lang);
    logger.info(
      'BG',
      `Service worker ready [${APP.NAME} v${APP.VERSION}] lang=${lang}`,
    );
  })
  .catch(() => {
    logger.info('BG', `Service worker ready [${APP.NAME} v${APP.VERSION}]`);
  });
