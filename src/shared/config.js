// ============================================================
// Avatara Extension — Centralized Configuration
// ============================================================
// All tunable constants live here. Modify freely without
// touching implementation files.
// ============================================================

export const APP = {
  NAME: 'Avatara',
  VERSION: '0.1.0',
  TAGLINE: 'Your browser, understood.',
};

// --- Storage ---
export const STORAGE = {
  DB_NAME: 'avatara_db',
  DB_VERSION: 1,
  /** Max days to retain raw experience stream entries */
  EXPERIENCE_RETENTION_DAYS: 90,
  /** Max entries per experience partition before compaction */
  MAX_EXPERIENCES_PER_PARTITION: 5000,
  /** chrome.storage.sync key prefix */
  SYNC_KEY_PREFIX: 'avatara_sync_',
};

// --- Ingestion ---
export const INGESTION = {
  MIN_VISIT_DURATION_MS: 3000,
  SUMMARIZE_THRESHOLD_MS: 30_000,
  MAX_HISTORY_IMPORT: 50_000,
  MAX_BOOKMARK_IMPORT: 10_000,
};

// --- Knowledge Engine ---
export const KNOWLEDGE = {
  EXTRACTION_INTERVAL_MIN: 15,
  MAX_INTEREST_CLUSTERS: 50,
  INTEREST_DECAY_DAYS: 30,
  PATTERN_THRESHOLD: 3,
};

// --- Butler: Alerts ---
export const ALERTS = {
  MAX_ALERTS_PER_DAY: 5,
  MIN_ALERT_INTERVAL_MIN: 60,
  ALERT_TTL_HOURS: 48,
};

// --- Butler: Goals ---
export const GOALS = {
  FREE_MAX_GOALS: 1,
  PRO_MAX_GOALS: Infinity,
  CHECK_INTERVAL_MIN: 10,
};

// --- AI ---
export const AI = {
  PREFER_ON_DEVICE: true,
  NANO_TIMEOUT_MS: 10_000,
  SUMMARY_MAX_TOKENS: 200,
  NL_PARSE_MAX_TOKENS: 100,
};

// --- UI ---
export const UI = {
  SIDEPANEL_DEFAULT_WIDTH: '380px',
  SEARCH_DEBOUNCE_MS: 300,
  MAX_CHAT_HISTORY: 100,
};

// --- Tier-based feature flags ---
export const TIER_FEATURES = {
  free: {
    nlSearch: true, basicStats: true, manualTabs: true,
    basicBookmarks: true, goals: 1, dailyDigest: true,
    aiSummarize: false, aiGrouping: false, proactiveAlerts: false,
    trendAnalysis: false, crossDeviceSync: false, cloudAI: false,
  },
  pro: {
    nlSearch: true, basicStats: true, manualTabs: true,
    basicBookmarks: true, goals: Infinity, dailyDigest: true,
    aiSummarize: true, aiGrouping: true, proactiveAlerts: true,
    trendAnalysis: true, crossDeviceSync: true, cloudAI: true,
  },
  team: {
    nlSearch: true, basicStats: true, manualTabs: true,
    basicBookmarks: true, goals: Infinity, dailyDigest: true,
    aiSummarize: true, aiGrouping: true, proactiveAlerts: true,
    trendAnalysis: true, crossDeviceSync: true, cloudAI: true,
    sharedKnowledge: true, adminDashboard: true,
  },
};
