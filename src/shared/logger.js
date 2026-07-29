// ============================================================
// Avatara — Structured Logger
// ============================================================
// All log output flows through here. In production, debug/verbose
// are suppressed. Structured for future remote debugging (opt-in).
// ============================================================

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLevel = LEVELS.INFO;

export const logger = {
  setLevel(level) {
    if (LEVELS[level] !== undefined) currentLevel = LEVELS[level];
  },

  debug(tag, msg, data) {
    if (currentLevel <= LEVELS.DEBUG) console.debug(`[Avatara:${tag}]`, msg, data ?? '');
  },

  info(tag, msg, data) {
    if (currentLevel <= LEVELS.INFO) console.info(`[Avatara:${tag}]`, msg, data ?? '');
  },

  warn(tag, msg, data) {
    if (currentLevel <= LEVELS.WARN) console.warn(`[Avatara:${tag}]`, msg, data ?? '');
  },

  error(tag, msg, data) {
    if (currentLevel <= LEVELS.ERROR) console.error(`[Avatara:${tag}]`, msg, data ?? '');
  },
};
