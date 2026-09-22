import { normalizeUrl, sanitizeText } from './model.js';

export function localDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function midnight(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期必须使用 YYYY-MM-DD。');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (year < 1970 || year > 9998 || localDate(date) !== value) throw new Error('日期无效。');
  return date;
}

/** Local calendar midnights, not UTC dates or rolling 24-hour windows (DST safe). */
export function historyRange(args, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (args.period) {
    const lengths = { today: 1, yesterday: 1, last_7_days: 7, last_30_days: 30, last_90_days: 90 };
    if (!Object.hasOwn(lengths, args.period)) throw new Error('不支持这个日期范围。');
    if (args.period === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    else start.setDate(start.getDate() - lengths[args.period] + 1);
  } else {
    start = midnight(args.startDate);
    const finish = midnight(args.endDate);
    end.setTime(finish.getTime()); end.setDate(end.getDate() + 1);
  }
  const calendarDays = Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
  if (calendarDays < 1 || calendarDays > 366) throw new Error('日期范围须为 1 至 366 个自然日。');
  const last = new Date(end); last.setDate(last.getDate() - 1);
  return { startDate: localDate(start), endDate: localDate(last), startTime: start.getTime(), endTime: end.getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, boundary: 'start_inclusive_end_exclusive' };
}

/** Event-level aggregation; repeated visits to one URL keep every observed day. */
export function aggregateHistory(events, range) {
  const pages = new Map(), days = new Map(), seen = new Set();
  let totalVisits = 0;
  for (const event of events) {
    const time = Number(event.visitTime), url = normalizeUrl(event.url);
    if (!url || !Number.isFinite(time) || time < range.startTime || time >= range.endTime) continue;
    const key = event.eventId || `${url}\0${time}`;
    if (seen.has(key)) continue;
    seen.add(key); totalVisits += 1;
    const date = localDate(time);
    const daily = days.get(date) || { date, visits: 0, urls: new Set() };
    daily.visits += 1; daily.urls.add(url); days.set(date, daily);
    const page = pages.get(url) || { id: sanitizeText(event.id, 120), title: sanitizeText(event.title, 240) || new URL(url).hostname, url, domain: new URL(url).hostname, visits: 0, firstVisitAt: new Date(time).toISOString(), lastVisitAt: new Date(time).toISOString(), dates: new Set(), hasSavedBody: event.hasSavedBody === true };
    page.visits += 1; page.dates.add(date);
    page.firstVisitAt = new Date(Math.min(Date.parse(page.firstVisitAt), time)).toISOString();
    page.lastVisitAt = new Date(Math.max(Date.parse(page.lastVisitAt), time)).toISOString();
    pages.set(url, page);
  }
  return { totalVisits, totalPages: pages.size, activeDays: days.size,
    days: [...days.values()].map(day => ({ date: day.date, visits: day.visits, pages: day.urls.size })).sort((a, b) => b.date.localeCompare(a.date)),
    pages: [...pages.values()].map(page => ({ ...page, dates: [...page.dates].sort() })).sort((a, b) => b.lastVisitAt.localeCompare(a.lastVisitAt) || a.url.localeCompare(b.url)),
  };
}

export function historyPage(snapshot, args = {}) {
  const { pages, days, ...metadata } = snapshot;
  const view = args.view || 'pages', offset = args.offset || 0, limit = args.limit || 30;
  const rows = view === 'days' ? days : pages;
  return { ...metadata, view, offset, limit, totalRows: rows.length, results: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null,
    note: `${snapshot.complete ? '已核对当前 Chrome 可提供且未被排除的逐次访问记录；不代表已删除、无痕或所有设备的历史。' : '查询不完整：不能根据空结果断言这段时间没有浏览。'}${offset + limit < rows.length ? '当前仅显示一页结果，请使用 nextOffset 继续，不要把这一页当作全部。' : ''} 页面标题为目前保存的标题，不能据此推断正文。` };
}

export function storedHistory(memories, args, now = new Date(), reason = 'local_last_visit_only') {
  const range = historyRange(args, now);
  const events = memories.map(memory => ({ ...memory, visitTime: Date.parse(memory.visitedAt), eventId: memory.id, hasSavedBody: Boolean(memory.excerpt) }));
  return { range, source: 'stored_latest_visits', complete: false, reasons: [reason, '旧数据每个网址只保留最后访问时间，不能还原所有访问日期；请授权浏览历史以核对逐次访问。'], ...aggregateHistory(events, range) };
}

export function temporalHistoryRequest(text) {
  if (!/(?:浏览|看过|访问|历史|记录|读过)/.test(text)) return null;
  const period = /昨天|昨日/.test(text) ? 'yesterday' : /今天|今日/.test(text) ? 'today' : /最近.{0,2}(?:7|七)天|近一周/.test(text) ? 'last_7_days' : /最近.{0,2}(?:30|三十)天|近一个月/.test(text) ? 'last_30_days' : null;
  return period ? { period, view: /哪些天|哪些日期|每天|逐日/.test(text) ? 'days' : 'pages', limit: 30, offset: 0 } : null;
}

export function historyLocalAnswer(data) {
  const label = `${data.range.startDate} 至 ${data.range.endDate}（${data.range.timeZone}）`;
  const lines = data.results.map(row => data.view === 'days' ? `• ${row.date}：${row.pages} 个页面，${row.visits} 次访问` : `• ${row.title}：${row.visits} 次，${new Date(row.lastVisitAt).toLocaleString('zh-CN')}`);
  return { mode: 'local', sources: [], steps: [], actions: [], content: `${label}\n\n${data.source === 'chrome_visits' ? '已核对 Chrome 逐次访问记录' : '仅核对本机保留的最后访问时间'}：共找到 ${data.totalPages} 个页面、${data.totalVisits} 条访问记录。\n\n${lines.join('\n') || '当前查询结果为空。'}\n\n${data.note}${data.reasons?.length ? '\n' + data.reasons.join('；') : ''}` };
}
