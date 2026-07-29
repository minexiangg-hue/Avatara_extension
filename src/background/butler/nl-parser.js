// ============================================================
// Avatara — Natural Language Command Parser
// ============================================================
// Parses user input into structured intents.
// MVP: rule-based regex + keyword extraction.
// Phase 2: Replace with Gemini Nano Prompt API.
// Interface stays the same: parse(input) → {intent, params, confidence}
// ============================================================

import { logger } from '../../shared/logger.js';

/**
 * Parse a user's natural language input into a structured command.
 * @param {string} input
 * @returns {Promise<{intent:string, params:object, confidence:number}>}
 */
export async function parseCommand(input) {
  const text = input.trim();
  if (!text) return { intent: 'unknown', params: {}, confidence: 0 };

  // Try each intent parser
  const parsers = [parseSearch, parseStats, parseTabs, parseGoal, parseGeneral];

  for (const parser of parsers) {
    const result = parser(text);
    if (result) return result;
  }

  return { intent: 'general', params: { query: text }, confidence: 0.3 };
}

/**
 * Execute a parsed command.
 * @param {{intent:string, params:object}} parsed
 */
export async function executeCommand(parsed) {
  switch (parsed.intent) {
    case 'manage_tabs':
      return executeTabAction(parsed.params);
    case 'goal':
      return executeGoalAction(parsed.params);
    default:
      return { ok: false, reason: `Cannot execute intent: ${parsed.intent}` };
  }
}

// --- Intent Parsers ---

function parseSearch(text) {
  // EN: "find/search/look for X from last week/today/yesterday"
  // ZH: "找/搜/帮我找 X 上周/今天/昨天"
  const patterns = [
    /(?:find|search|look\s*for|open|show\s*me)\s+(.+?)(?:\s+(?:from|about|on)\s+)?(today|yesterday|this\s*week|last\s*week|this\s*month|last\s*month)?$/i,
    /(?:找|搜|帮我找|帮我搜|打开|给我看)\s*(.+?)(?:的)?(?:关于)?(今天|昨天|上周|本周|这个月|上个月)?$/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'search_history',
        params: { query: match[1].trim(), timeRange: parseTimeRange(match[2]), opts: {} },
        confidence: 0.7,
      };
    }
  }
  return null;
}

function parseStats(text) {
  const patterns = [
    /(?:summarize|summary|stats|how\s*much\s*time|how\s*many)\s+(today|this\s*week|yesterday)/i,
    /(?:总结|统计|花了多少时间|看了多少)\s*(今天|本周|昨天)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'get_stats',
        params: { timeRange: parseTimeRange(match[1]), metric: 'summary' },
        confidence: 0.7,
      };
    }
  }
  return null;
}

function parseTabs(text) {
  // "group my AI tabs", "archive stale tabs", "close tabs from X"
  // "把AI标签分组", "归档不用的标签"
  const groupMatch = text.match(/(?:group|organize|分组|整理)\s*(?:my\s*)?(.+?)\s*(?:tabs|标签)/i);
  if (groupMatch) {
    return { intent: 'manage_tabs', params: { action: 'group', topic: groupMatch[1].trim() }, confidence: 0.7 };
  }

  const archiveMatch = text.match(/(?:archive|close|clean|归档|清理|关闭)\s*(?:stale|old|unused|不用的|旧的)?\s*(?:tabs|标签)/i);
  if (archiveMatch) {
    return { intent: 'manage_tabs', params: { action: 'archive' }, confidence: 0.6 };
  }

  return null;
}

function parseGoal(text) {
  // "remind me to X daily", "set a goal to X for Y minutes"
  // "提醒我每天X", "我要每天X分钟"
  const patterns = [
    /(?:remind\s*me\s*to|set\s*a\s*goal\s*(?:to)?|i\s*want\s*to)\s+(.+?)\s+(?:for\s*)?(\d+)\s*(minutes?|mins?|hours?|pages?|times?)\s*(daily|every\s*day|weekly|every\s*week)?/i,
    /(?:提醒我|我要|我想|设定目标)\s*(.+?)\s*(?:每天|每周)?\s*(\d+)\s*(分钟|小时|页|次)\s*(每天|每周)?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'goal',
        params: {
          action: 'create',
          description: match[1].trim(),
          target: parseInt(match[2]),
          unit: normalizeUnit(match[3]),
          frequency: match[4] ? normalizeFrequency(match[4]) : 'daily',
        },
        confidence: 0.7,
      };
    }
  }

  // Check progress: "how am I doing on my goals" / "我的目标怎么样了"
  if (/how.*goal|goal.*progress|check.*goal|目标.*进度|目标.*怎么样/i.test(text)) {
    return { intent: 'goal', params: { action: 'check' }, confidence: 0.6 };
  }

  return null;
}

function parseGeneral(text) {
  // Catch-all: treat as a search query
  return { intent: 'search_history', params: { query: text, opts: {} }, confidence: 0.4 };
}

// --- Helpers ---

function parseTimeRange(str) {
  if (!str) return 'all';
  const mapping = {
    'today': 'today', '今天': 'today',
    'yesterday': 'yesterday', '昨天': 'yesterday',
    'this week': 'week', '本周': 'week', '这周': 'week',
    'last week': 'week', '上周': 'week',
    'this month': 'month', '这个月': 'month',
    'last month': 'month', '上个月': 'month',
  };
  return mapping[str?.toLowerCase()] || 'all';
}

function normalizeUnit(str) {
  if (!str) return 'minutes';
  const mapping = { 'minute': 'minutes', 'minutes': 'minutes', 'mins': 'minutes', 'min': 'minutes',
    'hour': 'hours', 'hours': 'hours', 'hrs': 'hours',
    'page': 'pages', 'pages': 'pages',
    'time': 'times', 'times': 'times',
    '分钟': 'minutes', '小时': 'hours', '页': 'pages', '次': 'times',
  };
  return mapping[str?.toLowerCase()] || 'minutes';
}

function normalizeFrequency(str) {
  if (!str) return 'daily';
  if (/daily|every day|每天/i.test(str)) return 'daily';
  if (/weekly|every week|每周/i.test(str)) return 'weekly';
  return 'daily';
}

// --- Command Executors ---

async function executeTabAction(params) {
  try {
    if (params.action === 'group') {
      const tabs = await chrome.tabs.query({});
      const matching = tabs.filter(t => {
        const title = (t.title || '').toLowerCase();
        const topic = (params.topic || '').toLowerCase();
        return title.includes(topic);
      });

      if (matching.length > 1) {
        const tabIds = matching.map(t => t.id);
        const group = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(group, { title: params.topic || 'Grouped' });
        return { ok: true, grouped: matching.length, groupId: group };
      }
      return { ok: true, grouped: 0, message: 'No matching tabs found' };
    }

    if (params.action === 'archive') {
      // Close tabs inactive for >7 days (approximated by not being in current window's active set)
      const tabs = await chrome.tabs.query({ active: false });
      const toClose = tabs.filter(t => !t.pinned && !t.audible).slice(0, 10);
      if (toClose.length > 0) {
        await chrome.tabs.remove(toClose.map(t => t.id));
        return { ok: true, archived: toClose.length };
      }
      return { ok: true, archived: 0, message: 'No tabs to archive' };
    }

    return { ok: false, reason: `Unknown tab action: ${params.action}` };
  } catch (err) {
    logger.error('nl-parser', 'Tab action failed', err.message);
    return { ok: false, reason: err.message };
  }
}

async function executeGoalAction(params) {
  if (params.action === 'create') {
    const { addGoal } = await import('../storage/db.js');
    const id = await addGoal({
      description: params.description,
      target: params.target,
      unit: params.unit,
      frequency: params.frequency,
      current: 0,
      streak: 0,
    });
    return { ok: true, goalId: id };
  }
  if (params.action === 'check') {
    const { getAllGoals } = await import('../storage/db.js');
    const goals = await getAllGoals();
    return { ok: true, goals };
  }
  return { ok: false, reason: `Unknown goal action: ${params.action}` };
}
