// ============================================================
// Avatara — Message Type Constants
// ============================================================
// All inter-module communication types. Modules are loosely
// coupled via chrome.runtime.sendMessage with these well-known
// message types. Change one module without touching others.
// ============================================================

export const INGESTION = {
  PAGE_VISITED:        'ingestion:pageVisited',
  SEARCH_PERFORMED:    'ingestion:searchPerformed',
  TAB_ACTION:          'ingestion:tabAction',
  BOOKMARK_ACTION:     'ingestion:bookmarkAction',
  DOWNLOAD_ACTION:     'ingestion:downloadAction',
  HISTORY_IMPORT_DONE: 'ingestion:historyImportDone',
};

export const KNOWLEDGE = {
  INTEREST_UPDATED:   'knowledge:interestUpdated',
  PATTERN_DETECTED:   'knowledge:patternDetected',
  CONTENT_INDEXED:    'knowledge:contentIndexed',
  BEHAVIOR_SNAPSHOT:  'knowledge:behaviorSnapshot',
};

export const BUTLER = {
  NL_SEARCH:        'butler:nlSearch',
  NL_COMMAND:       'butler:nlCommand',
  GET_INSIGHTS:     'butler:getInsights',
  GET_DAILY_DIGEST: 'butler:getDailyDigest',
  GET_TRENDS:       'butler:getTrends',
};

export const ALERTS = {
  PROACTIVE_ALERT: 'alerts:proactiveAlert',
  GOAL_REMINDER:   'alerts:goalReminder',
  PATTERN_ALERT:   'alerts:patternAlert',
  DISMISS:         'alerts:dismiss',
};

export const GOALS = {
  CREATE:   'goals:create',
  UPDATE:   'goals:update',
  DELETE:   'goals:delete',
  PROGRESS: 'goals:progress',
  LIST:     'goals:list',
};

export const STORAGE = {
  QUERY:       'storage:query',
  GET_STATS:   'storage:getStats',
  EXPORT_DATA: 'storage:exportData',
  CLEAR_DATA:  'storage:clearData',
};

export const UI = {
  OPEN_SIDEPANEL:    'ui:openSidepanel',
  SHOW_INSIGHT:      'ui:showInsight',
  THEME_CHANGED:     'ui:themeChanged',
  LANGUAGE_CHANGED:  'ui:languageChanged',
};

export const LICENSE = {
  CHECK_STATUS:  'license:checkStatus',
  UPGRADE:       'license:upgrade',
  FEATURE_GATED: 'license:featureGated',
};
