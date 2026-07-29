// ============================================================
// Avatara — Settings (chrome.storage.local wrapper)
// ============================================================
// Extension-level settings, tier info, language preference, and
// first-run flag.  All values are stored in chrome.storage.local
// (persistent, not synced — privacy decision).
// ============================================================

import { logger } from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Internal key conventions
// ---------------------------------------------------------------------------
const KEYS = {
  FIRST_RUN: 'avatara_first_run_done',
  TIER: 'avatara_tier',
  LANGUAGE: 'avatara_lang',
};

// ---------------------------------------------------------------------------
// Generic get / set
// ---------------------------------------------------------------------------

/**
 * Read a single key from chrome.storage.local.
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getSetting(key) {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key];
  } catch (err) {
    logger.error('Settings', `getSetting(${key}) failed`, err);
    return undefined;
  }
}

/**
 * Write a single key to chrome.storage.local.
 * @param {string} key
 * @param {*} value - must be JSON-serialisable
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    logger.error('Settings', `setSetting(${key}) failed`, err);
  }
}

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

/**
 * Get the current license tier (defaults to 'free').
 * @returns {Promise<'free'|'pro'|'team'>}
 */
export async function getTier() {
  const tier = await getSetting(KEYS.TIER);
  return tier || 'free';
}

/**
 * Persist the license tier.
 * @param {'free'|'pro'|'team'} tier
 * @returns {Promise<void>}
 */
export async function setTier(tier) {
  await setSetting(KEYS.TIER, tier);
  logger.info('Settings', `Tier set to ${tier}`);
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/**
 * Get the user's preferred language.
 * @returns {Promise<'en'|'zh'>}
 */
export async function getLanguage() {
  const lang = await getSetting(KEYS.LANGUAGE);
  if (lang === 'en' || lang === 'zh') return lang;

  // Fall back to browser language detection
  if (typeof navigator !== 'undefined') {
    const navLang = navigator.language || 'en';
    return navLang.startsWith('zh') ? 'zh' : 'en';
  }
  return 'en';
}

// ---------------------------------------------------------------------------
// First-run detection
// ---------------------------------------------------------------------------

/**
 * Has the user completed the first-run onboarding flow?
 * @returns {Promise<boolean>}
 */
export async function isFirstRun() {
  const done = await getSetting(KEYS.FIRST_RUN);
  // If the key is absent it's the first run
  return done !== true;
}

/**
 * Mark first-run as done so we don't trigger onboarding again.
 * @returns {Promise<void>}
 */
export async function markFirstRunDone() {
  await setSetting(KEYS.FIRST_RUN, true);
  logger.info('Settings', 'First-run marked complete');
}
