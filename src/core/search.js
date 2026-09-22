import { sanitizeText } from './model.js';

const STOP_WORDS = new Set('a an and are as at be been by can could did do does for from have how i in is it me my of on or please recently that the these this to was were what when where which with would you your about find search show tell articles pages history 我 我的 的 了 和 与 或 是 在 有 吗 呢 啊 请 帮 帮我 帮忙 一下 想 想要 查 查找 找 找到 找出 搜 搜索 相关 关于 最近 近期 之前 以前 看 看过 浏览 读过 阅读 文章 页面 网页 资料 什么 哪些 哪个 内容 信息 记录 给 给我 看看 过 一些 一个 这 那 今天 本周 总结 关注 主题'.split(' '));
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;

export function queryTokens(value) {
  const query = sanitizeText(value, 1000).normalize('NFKC').toLowerCase();
  const words = segmenter
    ? [...segmenter.segment(query)].filter(item => item.isWordLike).map(item => item.segment)
    : query.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [];
  return [...new Set(words.filter(word => word && !STOP_WORDS.has(word)))].slice(0, 24);
}

function contains(haystack, term) {
  if (/[\p{Script=Han}]/u.test(term)) return haystack.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(haystack);
}

export function searchMemories(memories, query = '', options = {}) {
  const records = (Array.isArray(memories) ? memories : []).filter(memory => memory && typeof memory === 'object' && (options.filter !== 'saved' || memory.saved));
  const tokens = queryTokens(query);
  const meaningfulQuery = sanitizeText(query, 1000).replace(/[\s\p{P}\p{S}]/gu, '');
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Math.min(20000, Math.floor(Number(options.limit)))) : 20000;
  if (!tokens.length) {
    // Stop-word-only questions are broad; a symbol-only search has no matching evidence.
    if (sanitizeText(query, 1000) && !/[\p{L}\p{N}]/u.test(String(query))) return [];
    if (meaningfulQuery && !segmenter && !STOP_WORDS.has(meaningfulQuery.toLowerCase())) return [];
    return [...records].sort((a, b) => String(b.visitedAt ?? '').localeCompare(String(a.visitedAt ?? '')) || String(a.id).localeCompare(String(b.id))).slice(0, limit);
  }
  const prepared = records.map(memory => ({ memory, fields: [memory.title, (Array.isArray(memory.tags) ? memory.tags : []).join(' '), memory.domain, memory.url, memory.excerpt].map(field => String(field ?? '').normalize('NFKC').toLowerCase()) }));
  const frequencies = tokens.map(token => prepared.reduce((sum, record) => sum + (record.fields.some(field => contains(field, token)) ? 1 : 0), 0));
  const phrase = tokens.join('');
  return prepared.map(({ memory, fields }) => {
    let score = 0;
    let matches = 0;
    tokens.forEach((token, index) => {
      let weight = 0;
      fields.forEach((field, fieldIndex) => { if (contains(field, token)) weight += [9, 8, 3, 2, 2][fieldIndex]; });
      if (weight) { score += weight * (1 + Math.log(1 + records.length / (frequencies[index] + 1))); matches += 1; }
    });
    if (!matches) return null;
    score *= 0.5 + matches / tokens.length;
    if (tokens.length > 1 && fields[0].replace(/\s/g, '').includes(phrase)) score += 15;
    if (memory.saved) score += 0.25;
    return { memory, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || String(b.memory.visitedAt ?? '').localeCompare(String(a.memory.visitedAt ?? '')) || String(a.memory.id).localeCompare(String(b.memory.id))).slice(0, limit).map(record => record.memory);
}

export function buildInsights(memories, goals = []) {
  const records = (Array.isArray(memories) ? memories : []).filter(Boolean);
  const domains = new Map();
  const topics = new Map();
  const days = new Set();
  let totalVisits = 0;
  let savedCount = 0;
  for (const memory of records) {
    const domain = sanitizeText(memory.domain, 253);
    if (domain) domains.set(domain, (domains.get(domain) ?? 0) + 1);
    for (const name of new Set((Array.isArray(memory.tags) ? memory.tags : []).map(tag => sanitizeText(tag, 40)).filter(Boolean))) topics.set(name, (topics.get(name) ?? 0) + 1);
    const date = new Date(memory.visitedAt);
    if (Number.isFinite(date.getTime())) days.add(date.toLocaleDateString('en-CA'));
    const visits = Number(memory.visitCount);
    totalVisits += Number.isFinite(visits) ? Math.max(1, Math.floor(visits)) : 1;
    if (memory.saved) savedCount += 1;
  }
  const ranked = map => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    topDomains: ranked(domains).slice(0, 6).map(([domain, count]) => ({ domain, count })),
    topics: ranked(topics).slice(0, 8).map(([name, count]) => ({ name, count })),
    activeDays: days.size, totalVisits, savedCount,
    activeGoals: (Array.isArray(goals) ? goals : []).filter(goal => goal && goal.status === 'active').length,
  };
}
