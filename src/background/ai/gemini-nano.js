// ============================================================
// Avatara — Gemini Nano Integration
// ============================================================
// Wrapper around Chrome's built-in Prompt API.
// MVP: stubs — returns null for all calls.
// Phase 2: When Gemini Nano is available (Chrome 138+ with flags),
//   swap in real implementations. The interface stays the same.
// All callers check for null and fall back to rule-based methods.
// ============================================================

import { AI } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';

/**
 * Check if Gemini Nano is available in this Chrome instance.
 * Requires Chrome 138+ with chrome://flags/#prompt-api-for-gemini-nano enabled.
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  try {
    // @ts-ignore — experimental API
    if (typeof ai !== 'undefined' && ai.languageModel) {
      const capabilities = await ai.languageModel.capabilities();
      return capabilities.available === 'readily';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Summarize text using Gemini Nano.
 * @param {string} text
 * @param {number} [maxTokens]
 * @returns {Promise<string|null>} — null if unavailable
 */
export async function summarize(text, maxTokens = AI.SUMMARY_MAX_TOKENS) {
  if (!AI.PREFER_ON_DEVICE || !(await isAvailable())) return null;

  try {
    // @ts-ignore
    const session = await ai.languageModel.create({
      systemPrompt: 'Summarize the following text concisely in 2-3 sentences.',
    });
    const result = await session.prompt(`Summarize: ${text.slice(0, 5000)}`);
    session.destroy();
    return result.slice(0, maxTokens * 4); // rough char estimate
  } catch (err) {
    logger.warn('gemini-nano', 'Summarize failed', err.message);
    return null;
  }
}

/**
 * Classify the main topic of a text.
 * @param {string} text
 * @returns {Promise<string|null>}
 */
export async function classifyTopic(text) {
  if (!AI.PREFER_ON_DEVICE || !(await isAvailable())) return null;

  try {
    // @ts-ignore
    const session = await ai.languageModel.create({
      systemPrompt: 'Classify this text into a single topic category (e.g., "AI/ML", "Web Dev", "Finance", "Design", "Research"). Reply with only the category name.',
    });
    const result = await session.prompt(text.slice(0, 2000));
    session.destroy();
    return result.trim();
  } catch (err) {
    logger.warn('gemini-nano', 'Classify failed', err.message);
    return null;
  }
}

/**
 * Advanced NL command parsing using Gemini Nano.
 * Phase 2 replacement for nl-parser.js rule-based approach.
 * @param {string} input
 * @returns {Promise<object|null>}
 */
export async function parseNLCommand(input) {
  if (!AI.PREFER_ON_DEVICE || !(await isAvailable())) return null;

  try {
    // @ts-ignore
    const session = await ai.languageModel.create({
      systemPrompt: `Parse the user's browser-related command into JSON with intent and params.
Intents: search_history, get_stats, manage_tabs, goal, general.
Return ONLY valid JSON like: {"intent":"search_history","params":{"query":"machine learning","timeRange":"week"}}`,
    });
    const result = await session.prompt(input);
    session.destroy();
    return JSON.parse(result);
  } catch (err) {
    logger.warn('gemini-nano', 'parseNLCommand failed', err.message);
    return null;
  }
}
