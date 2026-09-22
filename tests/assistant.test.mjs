import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLocal, answerCloud, testConnection } from '../src/core/assistant.js';
import { createInitialState, normalizeMemory, createGoal } from '../src/core/model.js';

const response = (content = '连接正常', extra = {}) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, ...extra }] }) });
function withMemories() {
  const state = createInitialState();
  state.memories = Array.from({ length: 3 }, (_, index) => normalizeMemory({ id: `memory-${index}`, url: `https://example.com/${index}`, title: `向量检索 ${index}`, excerpt: `向量检索的摘录 ${index}`, tags: ['AI'], visitedAt: `2026-09-0${index + 1}T09:00:00Z` }));
  return state;
}

test('local mode searches only explicit memory requests and explains its limits for normal chat', () => {
  const state = withMemories();
  const ordinary = answerLocal('帮我写一封请假邮件', state);
  assert.match(ordinary.content, /本机模式/);
  assert.match(ordinary.content, /连接云端模型/);
  assert.equal(ordinary.sources.length, 0);
  assert.equal(ordinary.content.includes('向量检索'), false);
  const generic = answerLocal('向量检索是什么？', state);
  assert.equal(generic.sources.length, 0);
  const answer = answerLocal('帮我找一下向量检索的文章', state);
  assert.equal(answer.sources.length, 3);
  assert.match(answer.content, /\[1\]/);
  const missing = answerLocal('查找 xylophone-unique-994731', state);
  assert.match(missing.content, /没有足够证据/);
  assert.equal(missing.sources.length, 0);
  const summary = answerLocal('我最近在关注什么？', state);
  assert.equal(summary.sources.length, 3);
  assert.match(summary.content, /AI/);
});

test('local greetings do not access personal state and empty history remains truthful', () => {
  const privateState = new Proxy({}, { get() { throw new Error('Unexpected state access'); } });
  assert.match(answerLocal('你好', privateState).content, /Avatara/);
  assert.match(answerLocal('解释一下递归', privateState).content, /本机模式/);
  assert.match(answerLocal('找一下向量检索', createInitialState()).content, /还没有/);
  assert.throws(() => answerLocal('   ', createInitialState()));
});

test('local goal answer uses actual recorded progress', () => {
  const state = withMemories();
  state.goals = [createGoal({ title: '阅读', target: 5, unit: '篇', why: '积累理解' })];
  const answer = answerLocal('我的目标进度如何', state);
  assert.match(answer.content, /0 \/ 5 篇/);
  assert.match(answer.content, /积累理解/);
  assert.equal(answer.sources.length, 0);
  assert.match(answerLocal('寻找目标检测论文', state).content, /没有.*匹配的记录/);
});

test('connection check is synthetic, allows reasoning budget, and normalizes optional v1', async () => {
  const result = await testConnection({ baseUrl: 'https://api.deepseek.com/v1', model: 'chosen-model', apiKey: 'synthetic-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'chosen-model');
    assert.equal(body.messages.length, 2);
    assert.match(body.messages[1].content, /No personal data/);
    assert.equal(body.max_tokens, 256);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.tools, undefined);
    return response('OK');
  } });
  assert.equal(result.model, 'chosen-model');
  assert.match(result.message, /连接成功/);
});

test('provider-specific thinking option is never injected into other compatible endpoints', async () => {
  await testConnection({ baseUrl: 'https://provider.example/api/v1', apiKey: 'key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://provider.example/api/v1/chat/completions');
    assert.equal(JSON.parse(options.body).thinking, undefined);
    return response('OK');
  } });
});

test('cloud errors are actionable and never expose provider bodies or arbitrary error text', async () => {
  for (const [status, expected] of [[401, /验证失败/], [403, /验证失败/], [429, /额度或频率/], [503, /HTTP 503/]]) {
    await assert.rejects(testConnection({ apiKey: 'sensitive-value', fetchImpl: async () => ({ ok: false, status, json: async () => ({ message: 'sensitive-value' }) }) }), expected);
  }
  await assert.rejects(testConnection({ apiKey: 'sensitive-value', fetchImpl: async () => { throw new Error('云端 sensitive-value arbitrary-provider-body'); } }), error => !error.message.includes('sensitive-value') && !error.message.includes('arbitrary-provider-body'));
  await assert.rejects(testConnection({ apiKey: 'key', fetchImpl: async () => { throw new TypeError('Network failed'); } }), /无法连接/);
  const answer = await answerCloud('你好', createInitialState(), { apiKey: 'ordinary-secret-9917', fetchImpl: async () => response('echo ordinary-secret-9917') });
  assert.equal(JSON.stringify(answer).includes('ordinary-secret-9917'), false);
});

test('invalid configuration fails before network, and empty or truncated responses never succeed', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response('OK'); };
  await assert.rejects(testConnection({ baseUrl: 'http://remote.test', apiKey: 'key', fetchImpl }), /HTTPS/);
  await assert.rejects(testConnection({ apiKey: '', fetchImpl }), /API 密钥/);
  await assert.rejects(testConnection({ apiKey: 'key\nmalformed', fetchImpl }), /格式/);
  assert.equal(calls, 0);
  await assert.rejects(testConnection({ apiKey: 'key', fetchImpl: async () => response('  ') }), /没有返回/);
  await assert.rejects(testConnection({ apiKey: 'key', fetchImpl: async () => response('incomplete', { finish_reason: 'length' }) }), /被截断/);
  await assert.rejects(testConnection({ apiKey: 'key', fetchImpl: async () => response('x'.repeat(12001)) }), /过长/);
  await assert.rejects(testConnection({ apiKey: 'key', fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }) }), /无法读取/);
});

test('request timeout aborts fetch and also bounds a stalled response body', async () => {
  let signal;
  await assert.rejects(testConnection({ apiKey: 'key', timeoutMs: 15, fetchImpl: (_, options) => { signal = options.signal; return new Promise(() => {}); } }), /超时/);
  assert.equal(signal.aborted, true);
  await assert.rejects(testConnection({ apiKey: 'key', timeoutMs: 15, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) }), /超时/);
});
