import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeMemory, mergeMemories, sanitizeState, createGoal, advanceGoal, normalizeBaseUrl, normalizeUrl, sanitizeText, deriveTags } from '../src/core/model.js';
import { searchMemories, buildInsights, queryTokens } from '../src/core/search.js';

const memory = (patch = {}) => normalizeMemory({ id: 'one', url: 'https://example.com/article', title: 'React 状态管理实践', excerpt: '状态管理适合使用 React reducer 组织更新。', tags: ['前端'], visitedAt: '2026-09-01T09:00:00Z', visitCount: 3, ...patch });

test('fresh state is independent, has no implicit capture or cloud consent', () => {
  const first = createInitialState();
  const second = createInitialState();
  first.memories.push({});
  assert.deepEqual(second.memories, []);
  assert.equal(second.settings.captureEnabled, false);
  assert.equal(second.settings.ai.enabled, false);
  assert.equal(second.settings.ai.hasKey, false);
});

test('URL normalization strips credentials, secret parameters and tracking while retaining useful query', () => {
  const url = normalizeUrl('https://name:password@Example.com/search?q=react&api_key=secret&accessToken=hidden&code=otp&email=private%40mail.test&utm_source=ad#token');
  assert.equal(url, 'https://example.com/search?q=react');
  for (const invalid of ['javascript:alert(1)', 'file:///private.txt', 'chrome://history', 'data:text/plain,secret', null, 42, 'not a url']) assert.equal(normalizeUrl(invalid), '');
  assert.equal(normalizeMemory({ url: 'javascript:alert(1)' }), null);
});

test('memory normalizer bounds untrusted fields and derives domain from URL', () => {
  const result = memory({ domain: 'fake.test', title: '', visitCount: -4, tags: ['AI', 'AI', null], saved: 'true', excerpt: 'x'.repeat(20000), visitedAt: 'bad' });
  assert.equal(result.id, 'one');
  assert.equal(result.domain, 'example.com');
  assert.equal(result.title, 'example.com');
  assert.equal(result.visitCount, 1);
  assert.equal(result.saved, false);
  assert.deepEqual(result.tags, ['AI']);
  assert.equal(result.excerpt.length, 12000);
  assert.ok(Number.isFinite(Date.parse(result.visitedAt)));
});

test('repeat history imports merge by canonical URL without losing captured content, identity or saved state', () => {
  const existing = memory({ saved: true, source: 'page', excerpt: 'A meaningfully captured page body.', visitCount: 8 });
  const incoming = { url: 'https://example.com/article?utm_source=mail', title: 'A newer title', source: 'history', excerpt: '', visitCount: 9, visitedAt: '2026-09-02T09:00:00Z' };
  const merged = mergeMemories([existing], [incoming, incoming]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'one');
  assert.equal(merged[0].excerpt, existing.excerpt);
  assert.equal(merged[0].source, 'page');
  assert.equal(merged[0].saved, true);
  assert.equal(merged[0].visitCount, 9);
  assert.equal(merged[0].title, 'A newer title');
});

test('untagged real history derives conservative Chinese and English keyword topics locally', () => {
  const chrome = normalizeMemory({ url: 'https://developer.chrome.com/docs/extensions/reference/api/storage', title: 'Chrome extension storage API', source: 'history' });
  assert.deepEqual(chrome.tags, ['浏览器扩展', '数据存储']);
  const learning = normalizeMemory({ url: 'https://example.com/learn', title: '如何学习机器学习', tags: [], source: 'history' });
  assert.deepEqual(learning.tags, ['机器学习']);
  assert.equal(learning.tags.includes('学习方法'), false);
  const captured = normalizeMemory({ url: 'https://example.com/article', title: '今日笔记', excerpt: 'This article discusses user experience and accessibility.', source: 'page' });
  assert.deepEqual(captured.tags, ['产品设计', '可访问性']);
  const topics = buildInsights([chrome, learning, captured], []).topics.map(topic => topic.name);
  assert.ok(topics.includes('浏览器扩展'));
  assert.ok(topics.includes('机器学习'));
});

test('derived tags require explicit content cues and do not infer from domains or URL paths', () => {
  assert.deepEqual(deriveTags({ title: '今天的天气', excerpt: '晴，有微风。', domain: 'developer.chrome.com' }), []);
  assert.deepEqual(normalizeMemory({ url: 'https://github.com/example/machine-learning', title: 'Home', tags: [] }).tags, []);
  assert.deepEqual(normalizeMemory({ url: 'https://privacy.com' }).tags, []);
  assert.deepEqual(normalizeMemory({ url: 'https://privacy.com', title: 'privacy.com' }).tags, []);
  assert.deepEqual(deriveTags({ title: '文章链接', excerpt: 'https://example.com/privacy/Chrome-extension' }), []);
  assert.deepEqual(deriveTags({ title: 'The daily mailbox and remaining items' }), []);
  assert.deepEqual(deriveTags(null), []);
});

test('custom tags survive normalization; automatic topics are bounded and state sanitization is stable', () => {
  const custom = normalizeMemory({ url: 'https://example.com/custom', title: 'Chrome extension storage API', tags: ['项目资料', '待读', '项目资料'] });
  assert.deepEqual(custom.tags, ['项目资料', '待读']);
  const derived = deriveTags({ title: 'Chrome extension machine learning AI assistant large language model user experience privacy IndexedDB accessibility' });
  assert.equal(derived.length, 4);
  assert.deepEqual(derived, deriveTags({ title: 'Chrome extension machine learning AI assistant large language model user experience privacy IndexedDB accessibility' }));
  const state = createInitialState();
  state.memories = [{ url: 'https://example.com/learning', title: '如何学习机器学习', visitedAt: '2026-09-10T08:00:00Z' }, custom];
  const sanitized = sanitizeState(state);
  assert.deepEqual(sanitizeState(sanitized), sanitized);
  assert.deepEqual(sanitized.memories.find(item => item.url.endsWith('/learning')).tags, ['机器学习']);
});

test('sanitization allows only public state fields and removes recognizable credentials from content', () => {
  const state = createInitialState();
  state.apiKey = 'top-level-private';
  state.settings.ai.apiKey = 'nested-private';
  state.settings.ai.token = 'other-private';
  state.settings.ai.baseUrl = 'http://untrusted.example';
  state.profile.name = 'sk-abcdefghijklmnopqrstuvw';
  state.messages = [{ role: 'system', content: 'not a supported role' }, { role: 'user', content: 'password=hunter2 Bearer abcdefg sk-abcdefghijklmnopqrstuvw', secret: 'hidden', sources: [{ url: 'javascript:alert(1)' }] }];
  state.memories = [memory({ excerpt: 'api_key=private-secret https://user:secret@example.com/?token=hidden&q=useful' })];
  const clean = sanitizeState(state);
  const serialized = JSON.stringify(clean);
  for (const secret of ['top-level-private', 'nested-private', 'other-private', 'hunter2', 'abcdefg', 'sk-abcdefghijklmnopqrstuvw', 'private-secret', 'token=hidden', 'user:secret']) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(clean.messages.length, 1);
  assert.equal(clean.messages[0].sources.length, 0);
  assert.equal(clean.settings.ai.baseUrl, 'https://api.deepseek.com');
  assert.deepEqual(sanitizeState(null), createInitialState());
  assert.equal(sanitizeText({ token: 'no' }), '');
});

test('provider endpoint accepts optional v1 and safe local dev endpoints only', () => {
  assert.equal(normalizeBaseUrl(' https://api.deepseek.com/v1/ '), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('https://provider.example/api/v1'), 'https://provider.example/api');
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:9000/'), 'http://127.0.0.1:9000');
  assert.equal(normalizeBaseUrl('http://[::1]:9000/v1'), 'http://[::1]:9000');
  for (const value of ['http://remote.example', 'ftp://localhost', 'https://user:password@example.com', 'https://example.com/?key=secret', 'https://example.com/#key', '', null]) assert.throws(() => normalizeBaseUrl(value));
});

test('goal progress is immutable, bounded, reversible, and status follows actual progress', () => {
  const goal = createGoal({ title: '阅读设计文章', target: 2, unit: '篇', dueDate: '2026-02-30' });
  assert.equal(goal.dueDate, '');
  const first = advanceGoal(goal, 1);
  assert.equal(goal.progress, 0);
  assert.equal(first.progress, 1);
  const completed = advanceGoal(first, 50);
  assert.equal(completed.progress, 2);
  assert.equal(completed.status, 'completed');
  const reopened = advanceGoal(completed, -1);
  assert.equal(reopened.status, 'active');
  assert.equal(advanceGoal(reopened, -50).progress, 0);
  assert.throws(() => advanceGoal(goal, NaN));
  assert.throws(() => createGoal({ title: '  ' }));
  assert.equal(createGoal({ title: 'valid', target: -4 }).target, 1);
});

test('retrieval supports mixed Chinese and English, ranks title over incidental body mentions', () => {
  const records = [
    memory({ id: 'body', url: 'https://other.test/item', title: 'Reading notes', excerpt: 'React was mentioned once.', tags: [], visitedAt: '2026-09-03T00:00:00Z' }),
    memory(),
    memory({ id: 'unrelated', url: 'https://example.com/cooking', title: '今日食谱', excerpt: '番茄鸡蛋', tags: [] }),
  ];
  assert.deepEqual(queryTokens('帮我找一下关于React状态管理的文章'), ['react', '状态', '管理']);
  assert.equal(searchMemories(records, 'React')[0].id, 'one');
  assert.equal(searchMemories(records, '状态管理')[0].id, 'one');
  assert.equal(searchMemories(records, 'react')[0].id, searchMemories(records, 'REACT')[0].id);
  assert.equal(searchMemories(records, '找一下番茄鸡蛋的文章')[0].id, 'unrelated');
  assert.deepEqual(searchMemories(records, 'xylophone-zebra-984771'), []);
  assert.deepEqual(searchMemories(records, '鲸'), []);
  assert.deepEqual(searchMemories(records, '🦄'), []);
  assert.equal(searchMemories(records, '', { limit: 1 }).length, 1);
  assert.equal(searchMemories(records, '', { limit: 0 }).length, 0);
  assert.equal(searchMemories(records, '', { filter: 'saved' }).length, 0);
  records[0].saved = true;
  assert.deepEqual(searchMemories(records, 'react', { filter: 'saved' }).map(item => item.id), ['body']);
});

test('word boundaries prevent short English query matching unrelated host fragments', () => {
  assert.deepEqual(searchMemories([memory({ title: 'google search', excerpt: '', tags: [], url: 'https://google.com/' })], 'go'), []);
});

test('insights count stored evidence, unique tags per record and actual goal status', () => {
  const result = buildInsights([memory({ saved: true }), memory({ id: 'two', url: 'https://example.com/2', visitCount: 2, visitedAt: '2026-09-02T09:00:00Z', tags: ['前端', '设计'] })], [{ status: 'active' }, { status: 'completed' }]);
  assert.deepEqual(result.topDomains, [{ domain: 'example.com', count: 2 }]);
  assert.equal(result.topics.find(topic => topic.name === '前端').count, 2);
  assert.equal(result.activeDays, 2);
  assert.equal(result.totalVisits, 5);
  assert.equal(result.savedCount, 1);
  assert.equal(result.activeGoals, 1);
  assert.deepEqual(buildInsights(null, null), { topDomains: [], topics: [], activeDays: 0, totalVisits: 0, savedCount: 0, activeGoals: 0 });
});
