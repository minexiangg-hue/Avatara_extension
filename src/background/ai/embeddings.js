// ============================================================
// Avatara — Embeddings (MVP: Bag-of-Words)
// ============================================================
// Text → vector for semantic similarity search.
// MVP: simple TF-IDF-like bag-of-words with fixed vocabulary.
// Phase 2: Replace with Gemini Nano embeddings or ONNX model.
// Interface stays the same: embedText(text) → number[]
// ============================================================

import { logger } from '../../shared/logger.js';

/** Fixed vocabulary (~200 terms covering tech + general topics). */
const VOCABULARY = [
  // Tech
  'ai', 'machine', 'learning', 'deep', 'neural', 'network', 'model', 'training', 'data',
  'python', 'javascript', 'typescript', 'react', 'vue', 'node', 'api', 'database',
  'docker', 'kubernetes', 'aws', 'cloud', 'server', 'deploy', 'ci', 'cd',
  'design', 'ui', 'ux', 'css', 'html', 'component', 'layout', 'color', 'typography',
  'code', 'programming', 'software', 'engineering', 'architecture', 'pattern',
  'algorithm', 'complexity', 'performance', 'optimization', 'cache', 'memory',
  'security', 'auth', 'encryption', 'token', 'privacy',
  'open', 'source', 'github', 'git', 'version', 'control',
  // Business/Finance
  'stock', 'market', 'invest', 'crypto', 'bitcoin', 'finance', 'revenue', 'startup',
  'business', 'strategy', 'management', 'team', 'product', 'user', 'customer',
  'growth', 'marketing', 'sales', 'pricing', 'revenue',
  // Research/Academic
  'research', 'paper', 'study', 'experiment', 'analysis', 'result', 'conclusion',
  'theory', 'method', 'approach', 'evaluation', 'benchmark',
  // General/Reading
  'article', 'blog', 'news', 'tutorial', 'guide', 'documentation', 'review',
  'video', 'podcast', 'book', 'course', 'lecture',
  'productivity', 'habit', 'focus', 'goal', 'tracking',
  // Chinese tech terms (romanized for matching)
  '人工智能', '机器学习', '深度学习', '大模型', '编程', '前端', '后端', '设计',
  '数据', '分析', '投资', '股票', '研究', '论文', '效率',
  // Common domains
  'github', 'stackoverflow', 'medium', 'arxiv', 'youtube', 'reddit', 'twitter',
  'zhihu', 'bilibili', 'weibo',
];

const VOCAB_SIZE = VOCABULARY.length;

/**
 * Convert text to a sparse bag-of-words vector.
 * @param {string} text
 * @returns {number[]} — vector of length VOCAB_SIZE
 */
export function embedText(text) {
  if (!text) return new Array(VOCAB_SIZE).fill(0);

  const lower = text.toLowerCase();
  const words = lower.split(/[\s,.;:!?()\[\]{}"'\/\\]+/).filter(Boolean);
  const totalWords = words.length || 1;

  const vector = new Array(VOCAB_SIZE).fill(0);

  for (let i = 0; i < VOCABULARY.length; i++) {
    const term = VOCABULARY[i].toLowerCase();
    // Count occurrences of this vocabulary term in the text
    let count = 0;
    for (const word of words) {
      if (word.includes(term) || term.includes(word)) count++;
    }
    // Normalize by total words (simple TF)
    vector[i] = count / totalWords;
  }

  return vector;
}

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} — similarity score [0, 1]
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Search candidates by embedding similarity.
 * @param {string} query
 * @param {Array<{text:string, data:any}>} candidates
 * @param {number} [limit=10]
 * @returns {Array<{data:any, score:number}>}
 */
export function searchByEmbedding(query, candidates, limit = 10) {
  const queryVec = embedText(query);
  const scored = candidates.map(c => ({
    data: c.data,
    score: cosineSimilarity(queryVec, embedText(c.text)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
