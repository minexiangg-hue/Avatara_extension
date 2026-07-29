// ============================================================
// Avatara — Goal Tracker
// ============================================================
// User goal setting + progress tracking.
// Goals stored in IndexedDB, synced to chrome.storage.local.
// ============================================================

import { logger } from '../../shared/logger.js';
import { GOALS } from '../../shared/config.js';
import { addGoal, updateGoal, deleteGoal, getAllGoals } from '../storage/db.js';
import { getRecentPages } from '../knowledge/content-indexer.js';
import { getTier } from '../storage/settings.js';

/**
 * Create a new goal.
 * @param {string} description
 * @param {number} target
 * @param {'minutes'|'pages'|'times'} unit
 * @param {'daily'|'weekly'} frequency
 */
export async function createGoal(description, target, unit = 'minutes', frequency = 'daily') {
  // Check tier limit
  const tier = await getTier();
  const existing = await listActiveGoals();
  const maxGoals = tier === 'free' ? GOALS.FREE_MAX_GOALS : GOALS.PRO_MAX_GOALS;
  if (existing.length >= maxGoals) {
    throw new Error(`Tier limit reached: max ${maxGoals} goal(s) for ${tier}`);
  }

  const goal = {
    description,
    target: Number(target),
    unit,
    frequency,
    current: 0,
    streak: 0,
    lastChecked: new Date().toISOString(),
  };

  const id = await addGoal(goal);
  logger.info('goals', `Created goal ${id}: ${description}`);
  return { id, ...goal };
}

/**
 * Update progress for a goal based on browsing activity.
 * @param {number} goalId
 */
export async function updateProgress(goalId) {
  const goals = await getAllGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  const now = new Date().toISOString();
  const lastCheck = new Date(goal.lastChecked || 0);

  // Estimate progress based on recent page visits
  const recentEvents = await getRecentPages(24);
  const eventsSinceCheck = (recentEvents || []).filter(e => e.timestamp > (goal.lastChecked || 0));

  let increment = 0;
  if (goal.unit === 'pages') {
    increment = eventsSinceCheck.length;
  } else if (goal.unit === 'minutes') {
    // Rough estimate: ~3 minutes per page
    increment = eventsSinceCheck.length * 3;
  } else if (goal.unit === 'times') {
    increment = 1; // manual check-in counts as 1 session
  }

  const newCurrent = goal.current + increment;
  const completed = newCurrent >= goal.target;
  const newStreak = completed ? goal.streak + 1 : goal.streak;

  await updateGoal(goalId, {
    current: newCurrent,
    streak: newStreak,
    lastChecked: now,
  });

  return {
    id: goalId,
    current: newCurrent,
    target: goal.target,
    unit: goal.unit,
    percentage: Math.min(100, Math.round((newCurrent / goal.target) * 100)),
    streak: newStreak,
    completed,
  };
}

/**
 * Get progress for a specific goal.
 * @param {number} goalId
 */
export async function getGoalProgress(goalId) {
  const goals = await getAllGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return null;

  return {
    ...goal,
    percentage: Math.min(100, Math.round((goal.current / Math.max(1, goal.target)) * 100)),
    onTrack: goal.current >= goal.target * (goal.frequency === 'daily' ? 1 : (7 / 7)),
  };
}

/**
 * List all active (non-deleted) goals.
 */
export async function listActiveGoals() {
  return getAllGoals();
}

/**
 * Delete (soft-delete) a goal.
 * @param {number} goalId
 */
export async function removeGoal(goalId) {
  await deleteGoal(goalId);
  logger.info('goals', `Deleted goal ${goalId}`);
}

/**
 * Generate goal suggestions based on browsing patterns.
 * e.g., "You read AI papers for ~20 min/day. Want to set a 30 min daily goal?"
 */
export async function getGoalSuggestions() {
  const events = await getRecentPages(24 * 7); // last 7 days
  if (!events || events.length < 10) return [];

  const suggestions = [];

  // Detect frequent topic-based reading sessions
  const pagesPerDay = events.length / 7;
  if (pagesPerDay > 20) {
    suggestions.push({
      description: 'Read 30 pages daily',
      target: 30,
      unit: 'pages',
      frequency: 'daily',
      reason: `You average ${Math.round(pagesPerDay)} pages/day`,
    });
  }

  return suggestions;
}
