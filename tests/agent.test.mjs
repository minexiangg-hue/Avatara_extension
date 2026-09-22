import test from 'node:test';
import assert from 'node:assert/strict';
import { answerCloud } from '../src/core/assistant.js';
import { AGENT_TOOLS, validateToolArgs } from '../src/core/agent-tools.js';
import { createInitialState, createGoal, normalizeMemory } from '../src/core/model.js';

const API_KEY = 'agent-fixture-secret-82194';
const tool = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const reply = (content, calls, extra = {}) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}), ...extra }, finish_reason: calls ? 'tool_calls' : 'stop' }] }) });
const toolReplies = body => body.messages.filter(message => message.role === 'tool').map(message => ({ ...message, value: JSON.parse(message.content) }));
function memoryState() {
  const state = createInitialState();
  state.memories = [normalizeMemory({ id: 'memory-vector', title: '向量检索实践', url: 'https://example.com/vector?token=hidden', excerpt: '详细证据。'.repeat(300), visitedAt: '2026-09-10T09:00:00Z' }), normalizeMemory({ id: 'memory-other', title: '无关的烹饪', url: 'https://example.com/food', excerpt: 'unrelated-body' })];
  return state;
}

test('native registry is strict, validates types and dates, and rejects extras and unsafe prototypes', () => {
  assert.equal(AGENT_TOOLS.length, 10);
  for (const item of AGENT_TOOLS) { assert.equal(item.type, 'function'); assert.equal(item.function.parameters.additionalProperties, false); }
  assert.deepEqual(validateToolArgs('search_memories', { query: '  向量  ' }), { query: '向量', limit: 6 });
  assert.deepEqual(validateToolArgs('search_memories', { query: '', limit: 1 }), { query: '', limit: 1 });
  assert.deepEqual(validateToolArgs('list_goals', {}), { status: 'active' });
  assert.deepEqual(validateToolArgs('create_goal', { title: '阅读', target: 3, dueDate: '2028-02-29' }), { title: '阅读', target: 3, dueDate: '2028-02-29' });
  const invalid = [
    ['missing', {}], ['search_memories', { query: 'a', limit: 7 }], ['search_memories', { query: 'a', limit: '2' }], ['search_memories', {}],
    ['read_memory', { id: '' }], ['list_goals', { status: 'pending' }], ['get_profile', { secret: true }], ['list_tabs', []],
    ['create_goal', { title: 'test', target: 1.5 }], ['create_goal', { title: 'test', target: 1, dueDate: '2026-02-30' }],
    ['create_goal', { title: 'test', target: 1, apiKey: 'no' }], ['advance_goal', { id: 'a', delta: -1 }], ['advance_goal', { id: 'a', delta: 100001 }],
    ['get_profile', Object.create({ hidden: true })], ['get_profile', JSON.parse('{"__proto__":{}}')],
  ];
  for (const [name, args] of invalid) assert.throws(() => validateToolArgs(name, args), undefined, `${name} ${JSON.stringify(args)}`);
});

test('ordinary direct answer does not read personal collections or force tool use', async () => {
  const state = { settings: createInitialState().settings, messages: Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `turn-${index}`, reasoning_content: 'old-hidden-reasoning', actions: [{ secret: 'private-action' }] })) };
  for (const key of ['memories', 'profile', 'goals', 'activity']) Object.defineProperty(state, key, { get() { throw new Error(`Unexpected ${key} read`); } });
  let calls = 0;
  const result = await answerCloud('帮我写一段春天的开场白', state, { apiKey: API_KEY, fetchImpl: async (_, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.tools.length, 10);
    assert.equal(body.messages.length, 8);
    assert.ok(body.messages.some(message => message.content === 'turn-4'));
    assert.equal(options.body.includes('turn-3'), false);
    assert.equal(options.body.includes('old-hidden-reasoning'), false);
    assert.equal(options.body.includes('private-action'), false);
    assert.equal(options.body.includes(API_KEY), false);
    assert.match(body.messages[0].content, /当前时间：\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(options.redirect, 'error');
    return reply('春风让故事有了新的开端。');
  } });
  assert.equal(calls, 1);
  assert.equal(result.content, '春风让故事有了新的开端。');
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.steps, []);
  assert.deepEqual(result.actions, []);
});

test('search then read uses native tool_call_id and ephemeral reasoning, with evidence-only sources', async () => {
  const state = memoryState();
  let round = 0;
  const updates = [];
  const answer = await answerCloud('找一下向量检索，再详细解释那篇文章', state, { apiKey: API_KEY, onStep: step => updates.push(step), fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    round += 1;
    if (round === 1) { assert.equal(options.body.includes('详细证据'), false); return reply(null, [tool('call-search', 'search_memories', { query: '向量检索' })], { reasoning_content: 'private-reasoning-never-display' }); }
    if (round === 2) {
      const previous = body.messages.find(message => message.tool_calls);
      assert.equal(previous.reasoning_content, 'private-reasoning-never-display');
      const [returned] = toolReplies(body);
      assert.equal(returned.tool_call_id, 'call-search');
      assert.equal(returned.value.data.results[0].id, 'memory-vector');
      assert.equal(returned.value.data.results[0].citation, 1);
      assert.ok(returned.value.data.results[0].excerpt.length <= 600);
      assert.equal(options.body.includes('unrelated-body'), false);
      return reply(null, [tool('call-read', 'read_memory', { id: 'memory-vector' })]);
    }
    const returned = toolReplies(body).at(-1);
    assert.equal(returned.tool_call_id, 'call-read');
    assert.equal(returned.value.data.citation, 1);
    assert.ok(returned.value.data.excerpt.length > 600);
    assert.equal(returned.value.data.url, 'https://example.com/vector');
    return reply('这篇文章的依据是详细证据 [1]。');
  } });
  assert.equal(round, 3);
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].id, 'memory-vector');
  assert.equal(answer.steps.length, 2);
  assert.deepEqual(updates.map(step => step.status), ['completed', 'completed']);
  assert.equal(JSON.stringify(answer).includes('private-reasoning-never-display'), false);
  assert.equal(JSON.stringify(answer).includes('call-search'), false);
});

test('follow-up gets prior shown source metadata, then re-reads rather than trusting prior excerpts', async () => {
  const state = memoryState();
  state.messages = [{ role: 'assistant', content: '之前找到这篇文章。', sources: [{ id: 'memory-vector', title: '向量检索实践', url: 'https://example.com/vector', excerpt: 'OLD-EXCERPT-MUST-NOT-BE-PRESENT' }] }, { role: 'user', content: '刚刚那篇再详细讲讲' }];
  let round = 0;
  await answerCloud('刚刚那篇再详细讲讲', state, { apiKey: API_KEY, fetchImpl: async (_, options) => {
    round += 1;
    const body = JSON.parse(options.body);
    if (round === 1) {
      assert.equal(body.messages.filter(message => message.role === 'user' && message.content === '刚刚那篇再详细讲讲').length, 1);
      assert.match(options.body, /memory-vector/);
      assert.equal(options.body.includes('OLD-EXCERPT-MUST-NOT-BE-PRESENT'), false);
      return reply(null, [tool('r', 'read_memory', { id: 'memory-vector' })]);
    }
    return reply('重新读取后，正文说明了详细证据 [1]。');
  } });
  assert.equal(round, 2);
});

test('goals are read only when called; progress writes remain pending without mutating state', async () => {
  const state = createInitialState();
  state.goals = [{ ...createGoal({ title: '阅读设计文章', target: 5, unit: '篇' }), progress: 2 }];
  const goalId = state.goals[0].id;
  const original = JSON.stringify(state);
  let round = 0;
  const answer = await answerCloud('看看目标，然后把阅读进度加一', state, { apiKey: API_KEY, executeTool: async () => { throw new Error('Write bridge must never run'); }, fetchImpl: async (_, options) => {
    round += 1;
    const body = JSON.parse(options.body);
    if (round === 1) { assert.equal(options.body.includes('阅读设计文章'), false); return reply(null, [tool('goals', 'list_goals', {})]); }
    if (round === 2) { assert.equal(toolReplies(body).at(-1).value.data.goals[0].progress, 2); return reply(null, [tool('advance', 'advance_goal', { id: goalId, delta: 1 })]); }
    const value = toolReplies(body).at(-1).value;
    assert.equal(value.confirmation_required, true);
    assert.equal(value.action.status, 'pending');
    return reply('已拟好增加一次进度的操作，请确认。');
  } });
  assert.equal(JSON.stringify(state), original);
  assert.equal(answer.actions.length, 1);
  assert.deepEqual(answer.actions[0].args, { id: goalId, delta: 1 });
  assert.equal(Date.parse(answer.actions[0].expiresAt) - Date.parse(answer.actions[0].createdAt), 1800000);
  assert.deepEqual(answer.steps.map(step => step.status), ['completed', 'pending']);
  assert.match(answer.content, /等待你确认，尚未执行/);
  assert.deepEqual(answer.sources, []);
});

test('identical write proposals are deduplicated and cannot execute browser callback', async () => {
  let round = 0;
  const args = { title: '每周阅读', target: 3, unit: '篇' };
  const state = createInitialState();
  const answer = await answerCloud('给我建一个每周阅读三篇的目标', state, { apiKey: API_KEY, executeTool: async () => { assert.fail('No writes execute'); }, fetchImpl: async (_, options) => {
    round += 1;
    if (round === 1) return reply(null, [tool('create-one', 'create_goal', args), tool('create-two', 'create_goal', args)]);
    const returned = toolReplies(JSON.parse(options.body));
    assert.equal(returned[0].value.action.id, returned[1].value.action.id);
    return reply('请确认这张目标卡片。');
  } });
  assert.equal(answer.actions.length, 1);
  assert.equal(answer.steps.length, 2);
  assert.equal(state.goals.length, 0);
});

test('malformed, unknown and extra-argument tool calls return safe errors for model recovery', async () => {
  let round = 0;
  let bridgeCalls = 0;
  const state = createInitialState();
  const answer = await answerCloud('帮我看看网页', state, { apiKey: API_KEY, executeTool: async () => { bridgeCalls += 1; return []; }, fetchImpl: async (_, options) => {
    round += 1;
    if (round === 1) return reply(null, [tool('a', 'delete_everything', {}), tool('b', 'read_memory', '{"id":'), tool('c', 'list_tabs', { url: 'https://evil.test' }), tool('d', 'advance_goal', { id: 'invented', delta: 1 })]);
    const returned = toolReplies(JSON.parse(options.body));
    assert.equal(returned.length, 4);
    assert.ok(returned.every(result => result.value.ok === false));
    return reply('这些请求未能完成，我没有修改任何数据。');
  } });
  assert.equal(bridgeCalls, 0);
  assert.equal(answer.actions.length, 0);
  assert.deepEqual(answer.steps.map(step => step.status), ['error', 'error', 'error', 'error']);
  assert.equal(answer.steps[0].name, 'unknown_tool');
});

test('browser read tools go through the bridge and only observed page evidence can become a source', async () => {
  let round = 0;
  const called = [];
  const answer = await answerCloud('看一下当前页面和标签页', createInitialState(), { apiKey: API_KEY, executeTool: async (name, args) => {
    called.push(name);
    assert.deepEqual(args, {});
    if (name === 'read_current_page') return { title: '当前文章', url: 'https://example.com/page?token=secret', excerpt: '当前页面正文', password: 'PRIVATE-FIELD' };
    return [{ id: 3, title: '另一个标签', url: 'https://example.com/tab', active: false, private: 'PRIVATE-FIELD' }, { id: 4, title: 'internal', url: 'chrome://settings' }];
  }, fetchImpl: async (_, options) => {
    round += 1;
    if (round === 1) return reply(null, [tool('page', 'read_current_page', {}), tool('tabs', 'list_tabs', {})]);
    const returned = toolReplies(JSON.parse(options.body));
    assert.equal(returned[0].value.data.citation, 1);
    assert.equal(returned[1].value.data.tabs.length, 1);
    assert.equal(options.body.includes('PRIVATE-FIELD'), false);
    assert.equal(options.body.includes('token=secret'), false);
    return reply('当前文章记录了页面正文 [1]。');
  } });
  assert.deepEqual(called, ['read_current_page', 'list_tabs']);
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].url, 'https://example.com/page');
});

test('uncited evidence is not shown as a source; unobserved citations fail', async () => {
  let round = 0;
  const answer = await answerCloud('搜索向量检索', memoryState(), { apiKey: API_KEY, fetchImpl: async () => ++round === 1 ? reply(null, [tool('search', 'search_memories', { query: '向量检索' })]) : reply('找到一条记录，你还想了解哪方面？') });
  assert.deepEqual(answer.sources, []);
  await assert.rejects(answerCloud('你好', memoryState(), { apiKey: API_KEY, fetchImpl: async () => reply('未查询却声称有来源 [1]') }), /未读取/);
});

test('six model rounds and ten total calls bound looping agents', async () => {
  let rounds = 0;
  const first = await answerCloud('回顾一下', createInitialState(), { apiKey: API_KEY, fetchImpl: async () => { rounds += 1; return reply(null, [tool(`repeat-${rounds}`, 'get_profile', {})]); } });
  assert.equal(rounds, 6);
  assert.equal(first.steps.length, 6);
  assert.match(first.content, /处理上限/);
  let requests = 0;
  const second = await answerCloud('看看', createInitialState(), { apiKey: API_KEY, fetchImpl: async () => { requests += 1; return reply(null, Array.from({ length: 12 }, (_, index) => tool(`call-${index}`, 'get_profile', {}))); } });
  assert.equal(requests, 1);
  assert.equal(second.steps.length, 10);
  assert.match(second.content, /处理上限/);
});

test('whole-turn timeout bounds browser tools that never resolve', async () => {
  let requests = 0;
  const result = await answerCloud('读当前网页', createInitialState(), { apiKey: API_KEY, turnTimeoutMs: 20, executeTool: () => new Promise(() => {}), fetchImpl: async () => { requests += 1; return reply(null, [tool('page', 'read_current_page', {})]); } });
  assert.equal(requests, 1);
  assert.equal(result.steps[0].status, 'error');
  assert.match(result.steps[0].summary, /超时/);
  assert.match(result.content, /处理上限/);
});

test('tool errors and model echoes never leak the configured key or private reasoning', async () => {
  let round = 0;
  const result = await answerCloud('读页面', createInitialState(), { apiKey: API_KEY, executeTool: async () => { throw new Error(`provider error with ${API_KEY}`); }, fetchImpl: async (_, options) => {
    round += 1;
    if (round === 1) return reply(null, [tool('page', 'read_current_page', {})], { reasoning_content: 'HIDDEN-REASONING' });
    const returned = toolReplies(JSON.parse(options.body)).at(-1).value;
    assert.equal(JSON.stringify(returned).includes(API_KEY), false);
    return reply(`无法读取，secret echo ${API_KEY}`, undefined, { reasoning_content: 'HIDDEN-FINAL-REASONING' });
  } });
  const publicResult = JSON.stringify(result);
  assert.equal(publicResult.includes(API_KEY), false);
  assert.equal(publicResult.includes('HIDDEN-REASONING'), false);
  assert.equal(publicResult.includes('HIDDEN-FINAL-REASONING'), false);
});

test('exact key in source paths, prior-source metadata and pending goal descriptions is redacted', async () => {
  const state = createInitialState();
  state.memories = [normalizeMemory({ id: 'secret-source', title: '阅读笔记', url: `https://example.com/path/${API_KEY}`, excerpt: '正文' })];
  state.goals = [createGoal({ title: `目标 ${API_KEY}`, target: 5 })];
  state.messages = [{ role: 'assistant', content: '已有来源。', sources: [{ id: 'secret-source', title: '阅读笔记', url: `https://example.com/path/${API_KEY}` }] }];
  let round = 0;
  const result = await answerCloud('读取该笔记，并把目标进度加一', state, { apiKey: API_KEY, fetchImpl: async (_, options) => {
    round += 1;
    assert.equal(options.body.includes(API_KEY), false);
    if (round === 1) return reply(null, [tool('read', 'read_memory', { id: 'secret-source' }), tool('advance', 'advance_goal', { id: state.goals[0].id, delta: 1 })]);
    return reply('读取了笔记 [1]，目标进度等待确认。');
  } });
  assert.equal(result.sources.length, 1);
  assert.equal(result.actions.length, 1);
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
  assert.equal(result.sources[0].url, 'https://example.com/path/redacted');
});
