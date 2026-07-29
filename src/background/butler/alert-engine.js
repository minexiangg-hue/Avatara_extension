// ============================================================
// Avatara — Alert Engine
// ============================================================
// Proactive alert detection with rate limiting.
// Runs periodically. Generates alerts for:
//   - Trending topics
//   - Anomalies in daily behavior
//   - Stale tabs
//   - Goal reminders
//   - Sites user hasn't visited in a while
// ============================================================

import { logger } from '../../shared/logger.js';
import { ALERTS } from '../../shared/config.js';
import * as MT from '../../shared/message-types.js';
import { getInterestGraph, getTrendingTopics } from '../knowledge/interest-graph.js';
import { getPatterns, detectAnomaly } from '../knowledge/behavior-patterns.js';
import { getStaleTabs, getRecentPages } from '../knowledge/content-indexer.js';
import { addAlert, getPendingAlerts, getAllGoals } from '../storage/db.js';
import { getAlertFrequency } from '../storage/settings.js';

/** Track how many alerts were delivered today. */
let alertsDeliveredToday = 0;
let lastAlertTime = 0;

/**
 * Main periodic check. Called by the alarm handler.
 */
export async function checkAndGenerateAlerts() {
  try {
    const frequency = await getAlertFrequency();
    if (frequency === 'low') return; // user opted out of most alerts

    const recentEvents = await getRecentPages(24);

    // 1. Trending topics
    if (frequency !== 'low') {
      const trending = await getTrendingTopics(3);
      for (const t of trending.slice(0, 2)) {
        if (t.recentCount >= 5) {
          await createAlert({
            type: 'trending',
            priority: 'info',
            title: `Trending: ${t.name}`,
            message: `You've been reading a lot about ${t.name} recently (${t.recentCount} pages in 3 days).`,
            topic: t.name,
          });
        }
      }
    }

    // 2. Stale tabs
    const staleTabs = await getStaleTabs(7);
    if (staleTabs.length >= 5) {
      await createAlert({
        type: 'stale_tabs',
        priority: 'suggestion',
        title: `${staleTabs.length} tabs untouched for a week`,
        message: `You have ${staleTabs.length} tabs you haven't touched in over a week. Want to archive them?`,
        action: 'archive_stale',
      });
    }

    // 3. Haven't visited frequent sites
    const graph = await getInterestGraph();
    const topDomains = (graph?.domains || []).filter(d => d.visitCount > 10);
    for (const d of topDomains.slice(0, 3)) {
      const daysSince = d.lastVisit ? (Date.now() - new Date(d.lastVisit).getTime()) / 86400000 : 0;
      if (daysSince > 14) {
        await createAlert({
          type: 'missed_site',
          priority: 'reminder',
          title: `Haven't visited ${d.domain} in ${Math.round(daysSince)} days`,
          message: `You used to visit ${d.domain} regularly. Want to catch up?`,
          domain: d.domain,
        });
      }
    }

    // 4. Goal reminders
    if (frequency !== 'low') {
      const goals = await getAllGoals();
      for (const goal of goals) {
        const progress = goal.current / Math.max(1, goal.target);
        if (progress < 0.5) {
          await createAlert({
            type: 'goal',
            priority: 'reminder',
            title: `Goal behind: ${goal.description}`,
            message: `You're at ${Math.round(progress * 100)}% of your ${goal.frequency} goal.`,
            goalId: goal.id,
          });
        }
      }
    }

    logger.debug('alerts', `Check complete. Alerts today: ${alertsDeliveredToday}`);
  } catch (err) {
    logger.error('alerts', 'checkAndGenerateAlerts failed', err.message);
  }
}

/**
 * Create and deliver an alert, respecting rate limits.
 */
async function createAlert({ type, priority, title, message, ...rest }) {
  // Rate limit
  if (alertsDeliveredToday >= ALERTS.MAX_ALERTS_PER_DAY) return;
  if (Date.now() - lastAlertTime < ALERTS.MIN_ALERT_INTERVAL_MIN * 60000) return;

  // Check for duplicate pending alerts of same type
  const pending = await getPendingAlerts();
  if (pending.some(a => a.type === type)) return;

  const alert = {
    type,
    priority,
    title,
    message,
    ...rest,
    timestamp: new Date().toISOString(),
    dismissed: false,
  };

  await addAlert(alert);
  alertsDeliveredToday++;
  lastAlertTime = Date.now();

  // Deliver to UI if open
  try {
    chrome.runtime.sendMessage({ type: MT.ALERTS.PROACTIVE_ALERT, alert }).catch(() => {
      // UI might not be open — that's fine, alert is persisted
    });
  } catch {}

  logger.debug('alerts', `Delivered: ${type} (${priority})`);
}

/** Reset daily counter (call at midnight via alarm). */
export async function resetDailyCounter() {
  alertsDeliveredToday = 0;
}
