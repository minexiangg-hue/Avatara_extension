import { normalizeMemory, normalizeUrl } from '../core/model.js';
import { aggregateHistory, historyPage, historyRange, storedHistory } from '../core/history.js';

/** Read-only query. Raw URLs stay inside Chrome APIs; only normalized metadata leaves. */
export async function queryChromeHistory(api, state, args, { now = new Date(), cache = new Map(), maxCandidates = 10000, budgetMs = 18000 } = {}) {
  const allowed = url => {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    const host = new URL(normalized).hostname.toLowerCase().replace(/\.$/, '');
    return !state.settings.excludedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
  };
  const fallback = reason => historyPage(storedHistory(state.memories.filter(memory => allowed(memory.url)), args, now, reason), args);
  if (!await api.permissions.contains({ permissions: ['history'] }) || !api.history?.getVisits) return fallback('未获得浏览历史权限，或当前环境不支持逐次访问 API。请在「记忆」中点击导入并授权。');
  const range = historyRange(args, now);
  const key = JSON.stringify([range.startDate, range.endDate]);
  if (cache.has(key)) return historyPage(cache.get(key), args);
  const deadline = Date.now() + budgetMs;
  const bounded = async task => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('deadline');
    let timer;
    try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), remaining); })]); }
    finally { clearTimeout(timer); }
  };
  let entries;
  try {
    // Search through NOW, not just the requested end: a page revisited today can
    // still contain yesterday's VisitItems, despite a newer lastVisitTime.
    entries = await bounded(api.history.search({ text: '', startTime: range.startTime, endTime: now.getTime() + 1, maxResults: maxCandidates }));
  } catch { return fallback('Chrome 历史读取失败或超时；这里不是完整日期查询结果。'); }
  if (!Array.isArray(entries)) return fallback('Chrome 未返回有效的历史列表。');
  const reasons = [];
  if (entries.length >= maxCandidates) reasons.push(`候选网址达到 ${maxCandidates} 条扫描上限，部分网址可能遗漏。请缩小日期范围。`);
  const candidates = [...new Map(entries.filter(entry => allowed(entry.url)).map(entry => [entry.url, entry])).values()];
  const events = [], memories = new Map(state.memories.map(memory => [memory.url, memory]));
  const maxEvents = 50000;
  let cursor = 0, failed = 0, scanned = 0;
  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, async () => {
    while (cursor < candidates.length && Date.now() < deadline && events.length < maxEvents) {
      const entry = candidates[cursor++];
      try {
        const visits = await bounded(api.history.getVisits({ url: entry.url }));
        if (!Array.isArray(visits)) throw new Error('invalid visits');
        const memory = memories.get(normalizeUrl(entry.url)) || normalizeMemory({ url: entry.url, title: entry.title, visitedAt: entry.lastVisitTime, source: 'history' });
        for (const visit of visits) {
          if (events.length >= maxEvents) break;
          if (!Number.isFinite(visit.visitTime) || visit.visitTime < range.startTime || visit.visitTime >= range.endTime || visit.visitTime > now.getTime()) continue;
          events.push({ id: memory.id, url: memory.url, title: entry.title || memory.title, visitTime: visit.visitTime, eventId: visit.visitId ? `chrome:${visit.visitId}` : `${entry.url}\0${visit.visitTime}`, hasSavedBody: Boolean(memory.excerpt) });
        }
        scanned += 1;
      } catch { failed += 1; }
    }
  }));
  if (failed) reasons.push(`${failed} 个网址的逐次访问记录读取失败。`);
  if (events.length >= maxEvents) reasons.push('访问事件达到 50000 条处理上限，请缩小日期范围。');
  else if (cursor < candidates.length) reasons.push('扫描超时，尚有网址未核对。请缩小日期范围。');
  const snapshot = { range, source: 'chrome_visits', complete: !reasons.length, reasons, scannedPages: scanned, candidatePages: candidates.length, checkedAt: now.toISOString(), ...aggregateHistory(events, range) };
  cache.set(key, snapshot);
  return historyPage(snapshot, args);
}
