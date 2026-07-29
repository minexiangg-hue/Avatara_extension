// ============================================================
// Avatara — Content Indexer
// ============================================================
// Indexes page metadata for search. The foundation of
// "find that article about X from last week."
// MVP: keyword-based. Phase 2: embeddings for semantic search.
// ============================================================

import { logger } from '../../shared/logger.js';
import { addToContentIndex, queryContentIndex, queryExperiences } from '../storage/db.js';
import { INGESTION } from '../../shared/message-types.js';

/**
 * Index a page's metadata.
 * @param {string} url
 * @param {{ title?: string, description?: string, h1s?: string[], tags?: string[] }} metadata
 */
export async function indexPage(url, metadata) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
  try {
    await addToContentIndex({
      url,
      title: metadata.title || '',
      description: metadata.description || '',
      h1s: metadata.h1s || [],
      tags: extractTags(metadata),
      timestamp: new Date().toISOString(),
    });
    logger.debug('indexer', `Indexed: ${metadata.title || url}`);
  } catch (err) {
    logger.error('indexer', `Failed to index ${url}`, err.message);
  }
}

/**
 * Search indexed pages.
 * @param {string} query
 * @param {{ timeRange?: 'today'|'week'|'month'|'all', domain?: string, limit?: number }} opts
 * @returns {Promise<Array<{url:string,title:string,snippet:string,timestamp:string,score:number}>>}
 */
export async function searchIndex(query, opts = {}) {
  const results = await queryContentIndex(query, { limit: opts.limit || 20 });
  const scored = results.map(r => ({
    ...r,
    snippet: (r.description || r.title || '').slice(0, 200),
    score: computeScore(r, query),
    timestamp: r.timestamp || '',
  }));

  // Time filter
  const now = Date.now();
  const ranges = { today: 86400000, week: 604800000, month: 2592000000, all: Infinity };
  const cutoff = now - (ranges[opts.timeRange] || Infinity);

  const filtered = scored.filter(r => {
    const ts = new Date(r.timestamp).getTime();
    if (ts < cutoff) return false;
    if (opts.domain && !r.url.includes(opts.domain)) return false;
    return true;
  });

  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, opts.limit || 20);
}

/**
 * Get pages visited in the last N hours.
 * @param {number} hours
 */
export async function getRecentPages(hours = 24) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  return queryExperiences({ eventType: INGESTION.PAGE_VISITED, since, limit: 500 });
}

/**
 * Find tabs that are open but haven't been interacted with recently.
 */
export async function getStaleTabs(daysThreshold = 7) {
  const allTabs = await chrome.tabs.query({});
  const cutoff = new Date(Date.now() - daysThreshold * 86400000).toISOString();

  const stale = [];
  for (const tab of allTabs) {
    if (!tab.url || tab.url.startsWith('chrome://')) continue;
    const visits = await queryContentIndex(tab.url);
    if (visits.length === 0 || visits[0].timestamp < cutoff) {
      stale.push(tab);
    }
  }
  return stale;
}

/** Simple TF-IDF-like relevance scoring. */
function computeScore(entry, query) {
  const q = query.toLowerCase();
  const title = (entry.title || '').toLowerCase();
  const desc = (entry.description || '').toLowerCase();
  const h1s = (entry.h1s || []).join(' ').toLowerCase();
  const tags = (entry.tags || []).join(' ').toLowerCase();

  let score = 0;
  // Title matches weigh more
  if (title.includes(q)) score += 10;
  // H1 matches
  if (h1s.includes(q)) score += 5;
  // Description matches
  if (desc.includes(q)) score += 3;
  // Tag matches
  if (tags.includes(q)) score += 4;
  // Word-level matching
  const qWords = q.split(/\s+/);
  for (const word of qWords) {
    if (title.includes(word)) score += 2;
    if (desc.includes(word)) score += 1;
  }
  // Recency bonus
  if (entry.timestamp) {
    const age = Date.now() - new Date(entry.timestamp).getTime();
    score += Math.max(0, 5 - age / (7 * 86400000)); // up to 5 points for recency
  }
  return score;
}

/** Extract topic tags from page metadata using keyword matching. */
const TOPIC_KEYWORDS = {
  'ai-ml': ['ai', 'machine learning', 'deep learning', 'llm', 'gpt', 'transformer', 'neural network', '人工智能', '机器学习', '深度学习', '大模型'],
  'web-dev': ['javascript', 'react', 'vue', 'css', 'html', 'node', 'typescript', '前端', '后端'],
  'data-science': ['data', 'analytics', 'python', 'pandas', 'sql', 'statistics', '数据分析'],
  'design': ['design', 'ui', 'ux', 'figma', 'css', 'color', 'typography', '设计'],
  'devops': ['docker', 'kubernetes', 'aws', 'ci/cd', 'deploy', 'server', '运维'],
  'finance': ['stock', 'invest', 'crypto', 'bitcoin', 'etf', 'market', '股票', '投资', '理财'],
  'research': ['paper', 'research', 'arxiv', 'study', '论文', '研究'],
  'productivity': ['productivity', 'gtd', 'focus', 'habit', '效率', '习惯'],
  'reading': ['blog', 'article', 'news', 'read', '阅读', '文章', '新闻'],
  'video': ['youtube', 'bilibili', 'video', 'watch', '视频', 'B站'],
};

function extractTags(metadata) {
  const text = [metadata.title, metadata.description, ...(metadata.h1s || [])].join(' ').toLowerCase();
  const tags = [];
  for (const [tag, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      tags.push(tag);
    }
  }
  return tags;
}
