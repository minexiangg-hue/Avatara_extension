// ============================================================
// Avatara — Interest Graph
// ============================================================
// Models what topics/domains the user cares about.
// Data stored in IndexedDB under key "interest_graph".
// Time-decay weighted. MVP: keyword-based topic extraction.
// ============================================================

import { logger } from '../../shared/logger.js';
import { getKnowledge, setKnowledge, queryExperiences, queryContentIndex } from '../storage/db.js';
import { INGESTION } from '../../shared/message-types.js';
import { KNOWLEDGE } from '../../shared/config.js';

const STORE_KEY = 'interest_graph';

/** Topic keyword → label mapping. Extend this to add domain coverage. */
const TOPIC_MAP = {
  'ai': ['ai', 'machine learning', 'deep learning', 'llm', 'gpt', 'transformer', 'neural network', 'openai', 'claude', 'gemini', '人工智能', '机器学习', '深度学习', '大模型', 'transformer'],
  'web-dev': ['javascript', 'react', 'vue', 'css', 'html', 'node', 'typescript', 'next.js', '前端', '后端', 'web', 'api'],
  'data': ['data', 'analytics', 'python', 'pandas', 'sql', 'statistics', '数据分析', '数据库'],
  'design': ['design', 'ui', 'ux', 'figma', 'color', 'typography', '设计', '配色'],
  'devops': ['docker', 'kubernetes', 'aws', 'ci/cd', 'deploy', 'server', '运维', '部署'],
  'finance': ['stock', 'invest', 'crypto', 'bitcoin', 'etf', 'market', '股票', '投资', '理财', '基金'],
  'research': ['paper', 'research', 'arxiv', 'study', '论文', '研究', '学术'],
  'productivity': ['productivity', 'gtd', 'focus', 'habit', '效率', '习惯', '时间管理'],
  'gaming': ['game', 'gaming', 'steam', 'playstation', '游戏', '手游'],
  'social': ['twitter', 'weibo', 'reddit', 'discord', '社交', '微博', '推特'],
};

/**
 * Extract topic labels from a text string.
 * @param {string} text
 * @returns {string[]}
 */
function extractTopics(text) {
  const lower = (text || '').toLowerCase();
  const matched = [];
  for (const [label, keywords] of Object.entries(TOPIC_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched.push(label);
    }
  }
  return matched;
}

/**
 * Create an empty interest graph structure.
 */
function emptyGraph() {
  return { topics: [], domains: [], lastUpdated: new Date().toISOString() };
}

/**
 * Apply time decay to a weight.
 * weight' = weight * (1/2)^(daysSinceLastSeen / halfLife)
 */
function decayWeight(weight, lastSeen, halfLifeDays = KNOWLEDGE.INTEREST_DECAY_DAYS) {
  const daysSince = (Date.now() - new Date(lastSeen).getTime()) / 86400000;
  return weight * Math.pow(0.5, daysSince / halfLifeDays);
}

/**
 * Update the interest graph from a browser event.
 * @param {{ type: string, data: object }} event
 */
export async function updateFromEvent(event) {
  const graph = await getInterestGraph();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Extract topics from page metadata
  const text = [event.data?.title, event.data?.description, event.data?.query].filter(Boolean).join(' ');
  const topics = extractTopics(text);

  // Extract domain
  let domain = '';
  if (event.data?.url) {
    try { domain = new URL(event.data.url).hostname.replace('www.', ''); } catch {}
  }

  // Update topics
  for (const topic of topics) {
    let entry = graph.topics.find(t => t.name === topic);
    if (!entry) {
      entry = { name: topic, weight: 0, firstSeen: now, lastSeen: now, dailyCounts: [] };
      graph.topics.push(entry);
    }
    entry.lastSeen = now;
    entry.weight = Math.min(1, (entry.weight || 0) + 0.05);
    let dayEntry = entry.dailyCounts.find(d => d.date === today);
    if (!dayEntry) {
      dayEntry = { date: today, count: 0 };
      entry.dailyCounts.push(dayEntry);
    }
    dayEntry.count++;
  }

  // Update domain
  if (domain) {
    let dom = graph.domains.find(d => d.domain === domain);
    if (!dom) {
      dom = { domain, weight: 0, category: topics[0] || 'other', visitCount: 0, lastVisit: now };
      graph.domains.push(dom);
    }
    dom.visitCount++;
    dom.lastVisit = now;
    dom.weight = Math.min(1, (dom.weight || 0) + 0.02);
  }

  // Apply decay to all entries
  for (const t of graph.topics) {
    t.weight = decayWeight(t.weight, t.lastSeen);
  }
  for (const d of graph.domains) {
    d.weight = decayWeight(d.weight, d.lastVisit);
  }

  // Trim to MAX_INTEREST_CLUSTERS
  graph.topics.sort((a, b) => b.weight - a.weight);
  graph.domains.sort((a, b) => b.weight - a.weight);
  if (graph.topics.length > KNOWLEDGE.MAX_INTEREST_CLUSTERS) {
    graph.topics = graph.topics.slice(0, KNOWLEDGE.MAX_INTEREST_CLUSTERS);
  }
  if (graph.domains.length > KNOWLEDGE.MAX_INTEREST_CLUSTERS) {
    graph.domains = graph.domains.slice(0, KNOWLEDGE.MAX_INTEREST_CLUSTERS);
  }

  graph.lastUpdated = now;
  await setKnowledge(STORE_KEY, graph);
}

/**
 * Get the current interest graph.
 * @returns {Promise<object>}
 */
export async function getInterestGraph() {
  const stored = await getKnowledge(STORE_KEY);
  return stored || emptyGraph();
}

/**
 * Get topics with the highest weight increase in the last N days.
 * @param {number} days
 * @returns {Promise<Array<{name:string, weight:number, recentCount:number}>>}
 */
export async function getTrendingTopics(days = 7) {
  const graph = await getInterestGraph();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  return graph.topics
    .map(t => {
      const recent = t.dailyCounts.filter(d => d.date >= cutoff).reduce((sum, d) => sum + d.count, 0);
      return { name: t.name, weight: t.weight, recentCount: recent };
    })
    .filter(t => t.recentCount > 0)
    .sort((a, b) => b.recentCount - a.recentCount);
}

/**
 * Get top N domains by weight.
 * @param {number} [limit=10]
 */
export async function getTopDomains(limit = 10) {
  const graph = await getInterestGraph();
  return graph.domains.slice(0, limit);
}

/**
 * Get detailed history for a specific topic.
 * @param {string} topicName
 */
export async function getTopicHistory(topicName) {
  const graph = await getInterestGraph();
  const topic = graph.topics.find(t => t.name === topicName);
  return topic?.dailyCounts || [];
}
