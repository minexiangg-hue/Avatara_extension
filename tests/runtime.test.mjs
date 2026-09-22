import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createRuntime, STATE_KEY, API_KEY } from '../src/background/service-worker.js';
import { createInitialState, normalizeMemory, sanitizeState, createGoal } from '../src/core/model.js';

const DATE = new Date('2026-09-10T12:00:00.000Z');
const clone = (value) => structuredClone(value);
function fixture({ state, key = '', permissions = [], origins = [], entries = [], tabs = [], page, ...options } = {}) {
  const persistent = state ? { [STATE_KEY]: clone(state) } : {};
  const session = key ? { [API_KEY]: key } : {};
  const storageArea = (store) => ({
    async get(key) { return { [key]: clone(store[key]) }; },
    async set(data) { Object.assign(store, clone(data)); },
    async remove(key) { delete store[key]; },
  });
  const grants = new Set([...permissions, ...origins]);
  const opened = [];
  const scripts = [];
  const broadcasts = [];
  const api = {
    runtime: { id: 'test-extension', async sendMessage(message) { broadcasts.push(clone(message)); } },
    storage: { local: storageArea(persistent), session: storageArea(session) },
    permissions: { async contains(request) { return [...request.permissions || [], ...request.origins || []].every(value => grants.has(value)); } },
    history: { async search() { return clone(entries); } },
    tabs: { async query(query) { return clone(query.active ? tabs.filter(tab => tab.active) : tabs); }, async create(tab) { opened.push(clone(tab)); } },
    scripting: { async executeScript(request) { scripts.push(request); return [{ result: clone(page) }]; } },
  };
  const runtime = createRuntime(api, { now: () => DATE, ...options });
  const send = (type, payload = {}) => runtime.handle({ type, payload }, { id: api.runtime.id });
  return { send, runtime, api, persistent, session, grants, opened, scripts, broadcasts };
}
const memory = (overrides = {}) => normalizeMemory({ url: 'https://example.com/article', title: 'AI 产品设计', excerpt: '面向阅读与目标的人工智能设计实践。', visitedAt: DATE.toISOString(), ...overrides });

test('fresh install has truthful empty state, local mode and no capture', async () => {
  const { send } = fixture();
  const response = await send('state.get');
  assert.equal(response.ok, true);
  assert.equal(response.data.settings.captureEnabled, false);
  assert.equal(response.data.settings.ai.enabled, false);
  assert.equal(response.data.settings.ai.hasKey, false);
  assert.deepEqual(response.data.memories, []);
  assert.deepEqual(response.data.messages, []);
});

test('rejects foreign senders, malformed messages and executable URLs', async () => {
  const { runtime, api, send, opened } = fixture();
  assert.equal((await runtime.handle({ type: 'profile.update', payload: { name: 'attacker' } }, { id: 'other' })).ok, false);
  assert.equal((await runtime.handle(null, { id: api.runtime.id })).ok, false);
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.com']) assert.equal((await send('tabs.open', { url })).ok, false);
  assert.deepEqual(opened, []);
  assert.equal((await send('tabs.open', { url: 'https://example.com/article' })).ok, true);
  assert.equal(opened.length, 1);
});

test('serializes concurrent mutations without losing updates', async () => {
  const { send } = fixture();
  const results = await Promise.all([
    send('profile.update', { name: '阿青' }),
    send('profile.update', { focus: '把浏览变成积累' }),
    send('goals.create', { title: '读完三篇', target: 3 }),
  ]);
  assert.ok(results.every(result => result.ok));
  const { data } = await send('state.get');
  assert.equal(data.profile.name, '阿青');
  assert.equal(data.profile.focus, '把浏览变成积累');
  assert.equal(data.goals.length, 1);
});

test('key remains session-only and every mutation exposes current key availability', async () => {
  const { send, persistent, session } = fixture({ origins: ['https://api.deepseek.com/*'] });
  const secret = 'sk-test-credential-123456789';
  const changed = await send('settings.update', { ai: { enabled: true, apiKey: secret, baseUrl: 'https://api.deepseek.com/v1' } });
  assert.equal(changed.ok, true);
  assert.equal(changed.data.settings.ai.baseUrl, 'https://api.deepseek.com');
  assert.equal(changed.data.settings.ai.hasKey, true);
  assert.equal(session[API_KEY], secret);
  assert.equal(JSON.stringify(changed).includes(secret), false);
  assert.equal(JSON.stringify(persistent).includes(secret), false);
  assert.equal(persistent[STATE_KEY].settings.ai.hasKey, false);
  assert.equal((await send('profile.update', { name: '青' })).data.settings.ai.hasKey, true);
  const exported = await send('data.export');
  assert.equal(exported.data.settings.ai.hasKey, false);
  assert.equal(JSON.stringify(exported).includes(secret), false);
});

test('requires provider consent and validates settings before storing key', async () => {
  const { send, session } = fixture();
  assert.equal((await send('settings.update', { ai: { enabled: true, apiKey: 'private-test-key' } })).ok, false);
  assert.equal(session[API_KEY], undefined);
  assert.equal((await send('settings.update', { ai: { baseUrl: 'http://remote.example', apiKey: 'private-test-key' } })).ok, false);
  assert.equal(session[API_KEY], undefined);
  assert.equal((await send('settings.update', { captureEnabled: true })).ok, false);
  assert.equal((await send('settings.update', { retentionDays: 0 })).ok, false);
});

test('provider origin changes cannot reuse an implicit old key but same-origin v1 settings can', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  const originalKey = 'opaque-provider-one-73914';
  const nextKey = 'opaque-provider-two-58260';
  const { send, session, persistent } = fixture({ state, key: originalKey, origins: ['https://api.deepseek.com/*', 'https://another.example/*'] });
  for (const apiKey of [undefined, '']) {
    const ai = { baseUrl: 'https://another.example/v1', enabled: true, ...(apiKey === undefined ? {} : { apiKey }) };
    const rejected = await send('settings.update', { ai });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /明确填写/);
    assert.equal(session[API_KEY], originalKey);
    assert.equal(persistent[STATE_KEY].settings.ai.baseUrl, 'https://api.deepseek.com');
  }
  const sameOrigin = await send('settings.update', { ai: { baseUrl: 'https://api.deepseek.com/v1/' } });
  assert.equal(sameOrigin.ok, true);
  assert.equal(sameOrigin.data.settings.ai.hasKey, true);
  assert.equal(session[API_KEY], originalKey);
  const switched = await send('settings.update', { ai: { baseUrl: 'https://another.example', enabled: true, apiKey: nextKey } });
  assert.equal(switched.ok, true);
  assert.equal(session[API_KEY], nextKey);
  assert.equal(switched.data.settings.ai.baseUrl, 'https://another.example');
  const disabled = await send('settings.update', { ai: { baseUrl: 'https://api.deepseek.com', enabled: false } });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.settings.ai.hasKey, false);
  assert.equal(session[API_KEY], undefined);
});

test('failed provider settings commits restore old key binding for new-key and disabled transitions', async () => {
  for (const enabled of [true, false]) {
    const state = createInitialState();
    state.settings.ai.enabled = true;
    const oldKey = 'opaque-old-provider-39177';
    const { send, api, session, persistent } = fixture({ state, key: oldKey, origins: ['https://another.example/*'] });
    const originalSet = api.storage.local.set;
    api.storage.local.set = async () => { throw new Error('local disk full'); };
    const ai = { baseUrl: 'https://another.example', enabled, ...(enabled ? { apiKey: 'opaque-new-provider-42018' } : {}) };
    const result = await send('settings.update', { ai });
    assert.equal(result.ok, false);
    assert.equal(persistent[STATE_KEY].settings.ai.baseUrl, 'https://api.deepseek.com');
    assert.equal(persistent[STATE_KEY].settings.ai.enabled, true);
    assert.equal(session[API_KEY], oldKey);
    api.storage.local.set = originalSet;
    assert.equal((await send('settings.update', { ai })).ok, true);
    assert.equal(session[API_KEY], enabled ? 'opaque-new-provider-42018' : undefined);
  }
  const state = createInitialState();
  const context = fixture({ state, origins: ['https://another.example/*'] });
  context.api.storage.local.set = async () => { throw new Error('local write failure'); };
  const initialFailure = await context.send('settings.update', { ai: { baseUrl: 'https://another.example', enabled: true, apiKey: 'opaque-fresh-key-27019' } });
  assert.equal(initialFailure.ok, false);
  assert.equal(context.session[API_KEY], undefined);
  assert.equal(context.persistent[STATE_KEY].settings.ai.baseUrl, 'https://api.deepseek.com');
});

test('testing another provider also requires an explicit key without altering saved binding', async () => {
  const calls = [];
  const { send, session } = fixture({ key: 'opaque-stored-key-52319', origins: ['https://another.example/*', 'https://api.deepseek.com/*'], test: async config => { calls.push(config); return { message: 'OK', model: config.model }; } });
  assert.equal((await send('ai.test', { baseUrl: 'https://another.example' })).ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await send('ai.test', { baseUrl: 'https://api.deepseek.com/v1' })).ok, true);
  assert.equal(calls[0].apiKey, 'opaque-stored-key-52319');
  assert.equal((await send('ai.test', { baseUrl: 'https://another.example', apiKey: 'opaque-test-only-key-72018' })).ok, true);
  assert.equal(calls[1].apiKey, 'opaque-test-only-key-72018');
  assert.equal(session[API_KEY], 'opaque-stored-key-52319');
});

test('chat removes exact opaque session keys from stored user text and public answer in cloud and local modes', async () => {
  const secret = 'OpaqueCredential78426Random';
  for (const enabled of [true, false]) {
    const state = createInitialState();
    state.settings.ai.enabled = enabled;
    let receivedText;
    const answer = (text) => {
      receivedText = text;
      return { content: `模拟回显 ${secret}`, sources: [{ id: 'source', title: secret, url: `https://example.com/${secret}`, excerpt: secret }], mode: enabled ? 'cloud' : 'local', actions: [pendingAction({ args: { title: `目标 ${secret}`, target: 3 }, description: secret })] };
    };
    const { send, session, persistent } = fixture({ state, key: secret, origins: ['https://api.deepseek.com/*'], cloud: async text => answer(text), local: answer });
    const result = await send('chat.send', { text: `请看看 ${secret} 这段文字` });
    assert.equal(result.ok, true);
    assert.equal(receivedText, '请看看 [已隐藏密钥] 这段文字');
    assert.equal(result.data.messages[0].content, '请看看 [已隐藏密钥] 这段文字');
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(persistent).includes(secret), false);
    assert.equal(JSON.stringify(await send('data.export')).includes(secret), false);
    assert.equal(session[API_KEY], secret);
  }
});

test('import deduplicates clean URLs, preserves saved body and excludes only incoming domains', async () => {
  const state = createInitialState();
  state.memories = [memory({ saved: true }), memory({ url: 'https://private.example/old' })];
  const { send } = fixture({ state, permissions: ['history'], entries: [
    { url: 'https://example.com/article?utm_source=test&access_token=secret', title: 'AI 新标题', lastVisitTime: DATE.getTime(), visitCount: 8 },
    { url: 'https://private.example/new', title: '不应导入' },
    { url: 'chrome://extensions/', title: '内部页' },
  ] });
  assert.equal((await send('settings.update', { excludedDomains: ['private.example'] })).ok, true);
  const { data } = await send('history.import', { days: 30 });
  assert.equal(data.memories.length, 2);
  assert.ok(data.memories.find(item => item.url === 'https://private.example/old'));
  const merged = data.memories.find(item => item.url === 'https://example.com/article');
  assert.equal(merged.saved, true);
  assert.ok(merged.excerpt.length > 0);
  assert.equal(merged.visitCount, 8);
  assert.equal(data.importedAt, DATE.toISOString());
  assert.equal(JSON.stringify(data).includes('access_token'), false);
});

test('manual capture uses current granted page and retains readable content', async () => {
  const { send, scripts } = fixture({ tabs: [{ id: 7, active: true, url: 'https://example.com/article' }], page: { title: '一次阅读', url: 'https://example.com/article', excerpt: '值得记住的段落' } });
  const { ok, data } = await send('memory.capture');
  assert.equal(ok, true);
  assert.equal(scripts[0].target.tabId, 7);
  assert.equal(typeof scripts[0].func, 'function');
  assert.equal(data.memories[0].source, 'page');
  assert.equal(data.memories[0].saved, true);
  assert.equal(data.memories[0].excerpt, '值得记住的段落');
  assert.equal((await fixture({ tabs: [{ id: 1, active: true, url: 'chrome://settings/' }] }).send('memory.capture')).ok, false);
});

test('capture respects excluded domains before reading page content', async () => {
  const state = createInitialState();
  state.settings.excludedDomains = ['example.com'];
  const { send, scripts } = fixture({ state, tabs: [{ id: 7, active: true, url: 'https://sub.example.com/article' }] });
  assert.equal((await send('memory.capture')).ok, false);
  assert.equal(scripts.length, 0);
});

test('goals validate input, clamp progress, complete and delete', async () => {
  const { send } = fixture();
  for (const payload of [{ title: '' }, { title: '读书', target: -1 }, { title: '读书', target: 1.5 }, { title: '读书', dueDate: '2026-02-30' }]) assert.equal((await send('goals.create', payload)).ok, false);
  const created = await send('goals.create', { title: '读三篇', target: 3, unit: '篇' });
  const id = created.data.goals[0].id;
  assert.equal((await send('goals.advance', { id, delta: 1.5 })).ok, false);
  const advanced = await send('goals.advance', { id, delta: 5 });
  assert.equal(advanced.data.goals[0].progress, 3);
  assert.equal(advanced.data.goals[0].status, 'completed');
  assert.equal((await send('goals.delete', { id })).data.goals.length, 0);
});

test('local chat is evidence-based, searchable and clearable', async () => {
  const state = createInitialState();
  state.memories = [memory({ saved: true })];
  const { send } = fixture({ state });
  const response = await send('chat.send', { text: '找一下我看过的 AI 产品设计文章' });
  assert.equal(response.ok, true);
  assert.equal(response.data.messages.length, 2);
  assert.equal(response.data.messages[1].mode, 'local');
  assert.equal(response.data.messages[1].sources.length, 1);
  assert.equal((await send('memory.search', { query: 'zzzzzxxyy', filter: 'all' })).data.length, 0);
  assert.equal((await send('memory.search', { query: '', filter: 'saved' })).data.length, 1);
  assert.equal((await send('memory.toggleSaved', { id: state.memories[0].id })).data.memories[0].saved, false);
  assert.equal((await send('chat.clear')).data.messages.length, 0);
});

test('cloud turns are serialized and provider failures never fabricate a response', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  const calls = [];
  const { send } = fixture({ state, key: 'test-secret-1234', origins: ['https://api.deepseek.com/*'], cloud: async (text, current, { apiKey }) => {
    calls.push({ text, history: current.messages.length });
    assert.equal(apiKey, 'test-secret-1234');
    await Promise.resolve();
    if (text === 'fail') throw new Error('test-secret-1234 is invalid');
    return { content: `回答：${text}`, mode: 'cloud', sources: [] };
  } });
  const results = await Promise.all([send('chat.send', { text: 'first' }), send('chat.send', { text: 'second' })]);
  assert.ok(results.every(result => result.ok));
  assert.deepEqual(calls.map(call => call.history), [0, 2]);
  const failed = await send('chat.send', { text: 'fail' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.includes('test-secret-1234'), false);
  assert.equal((await send('state.get')).data.messages.length, 4);
});

test('connection test receives synthetic config only and does not persist key', async () => {
  const state = createInitialState();
  state.memories = [memory()];
  let received;
  const { send, session } = fixture({ state, origins: ['https://api.deepseek.com/*'], test: async (config) => { received = config; return { message: 'OK', model: config.model }; } });
  const response = await send('ai.test', { baseUrl: 'https://api.deepseek.com/v1', model: 'test-model', apiKey: 'test-key' });
  assert.equal(response.ok, true);
  assert.deepEqual(Object.keys(received).sort(), ['apiKey', 'baseUrl', 'model']);
  assert.equal(received.baseUrl, 'https://api.deepseek.com');
  assert.equal(session[API_KEY], undefined);
});

test('history observation is opt-in, respects grant revocation and never extracts content', async () => {
  const { send, runtime, grants, scripts } = fixture({ permissions: ['history'] });
  const entry = { url: 'https://example.com/new', title: '新阅读', lastVisitTime: DATE.getTime() };
  await runtime.observeHistory(entry);
  assert.equal((await send('state.get')).data.memories.length, 0);
  await send('settings.update', { captureEnabled: true });
  await runtime.observeHistory(entry);
  assert.equal((await send('state.get')).data.memories.length, 1);
  grants.delete('history');
  await runtime.revokeHistory();
  assert.equal((await send('state.get')).data.settings.captureEnabled, false);
  await runtime.observeHistory({ ...entry, url: 'https://example.com/ignored' });
  assert.equal((await send('state.get')).data.memories.length, 1);
  assert.equal(scripts.length, 0);
});

test('retention keeps saved memories and clear removes durable data plus session key', async () => {
  const state = createInitialState();
  state.memories = [memory({ url: 'https://example.com/expired', visitedAt: '2020-01-01T00:00:00Z' }), memory({ url: 'https://example.com/kept', visitedAt: '2020-01-01T00:00:00Z', saved: true })];
  const { send, persistent, session } = fixture({ state, key: 'temporary-key' });
  const loaded = await send('state.get');
  assert.deepEqual(loaded.data.memories.map(item => item.url), ['https://example.com/kept']);
  const cleared = await send('data.clear');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.memories.length, 0);
  assert.equal(cleared.data.settings.ai.hasKey, false);
  assert.equal(session[API_KEY], undefined);
  assert.equal(persistent[STATE_KEY].memories.length, 0);
});

test('tab list only includes granted ordinary page metadata', async () => {
  const { send } = fixture({ tabs: [{ id: 1, title: '页面', url: 'https://example.com', active: true }, { id: 2, active: false }, { id: 3, url: 'chrome://extensions/', active: false }] });
  const { data } = await send('tabs.list');
  assert.deepEqual(data, [{ id: 1, title: '页面', url: 'https://example.com/', active: true }]);
});

test('failed local writes preserve prior data, return actionable errors and do not poison the queue', async () => {
  const state = createInitialState();
  state.profile.name = '原有名字';
  state.memories = [memory({ saved: true })];
  const { send, api, persistent } = fixture({ state });
  const originalSet = api.storage.local.set;
  api.storage.local.set = async () => { throw new Error('QUOTA_BYTES exceeded: internal-private-details'); };
  const failed = await send('profile.update', { name: '未保存的名字' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /保存失败.*已有数据仍保留/);
  assert.match(failed.error, /导出备份/);
  assert.equal(failed.error.includes('internal-private-details'), false);
  assert.equal(persistent[STATE_KEY].profile.name, '原有名字');
  assert.equal(persistent[STATE_KEY].memories.length, 1);
  assert.equal((await send('data.export')).data.profile.name, '原有名字');
  // Export remains available even if retention maintenance itself cannot be written.
  persistent[STATE_KEY].memories.push(memory({ url: 'https://example.com/expired', visitedAt: '2020-01-01T00:00:00Z' }));
  const backup = await send('data.export');
  assert.equal(backup.ok, true);
  assert.equal(backup.data.memories.length, 1);
  api.storage.local.set = originalSet;
  const recovered = await send('profile.update', { name: '恢复后保存' });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.data.profile.name, '恢复后保存');
  assert.equal(recovered.data.memories.length, 1);
});

function pendingAction(overrides = {}) {
  return { id: 'action-1', name: 'create_goal', args: { title: '读三篇', target: 3, unit: '篇' }, title: '创建目标：读三篇', description: '目标数量为 3 篇，等待确认。', status: 'pending', createdAt: DATE.toISOString(), expiresAt: new Date(DATE.getTime() + 30 * 60000).toISOString(), ...overrides };
}
function stateWithAction(action = pendingAction()) {
  const state = createInitialState();
  state.messages.push({ id: 'assistant-1', role: 'assistant', content: '已拟定操作，请确认。', sources: [], mode: 'cloud', createdAt: DATE.toISOString(), steps: [], actions: [action] });
  return sanitizeState(state);
}
const confirmation = (overrides = {}) => ({ messageId: 'assistant-1', actionId: 'action-1', decision: 'approve', ...overrides });

test('agent proposals do not mutate goals, and confirmation uses stored args not request-supplied args', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  const { send, persistent } = fixture({ state, key: 'test-agent-key', origins: ['https://api.deepseek.com/*'], cloud: async () => ({ content: '请确认这个目标。', mode: 'cloud', sources: [], actions: [pendingAction()], steps: [{ id: 'step-1', name: 'create_goal', label: '拟定新目标', status: 'pending', summary: '等待确认' }] }) });
  const answer = await send('chat.send', { text: '帮我创建一个目标', requestId: 'request-1' });
  assert.equal(answer.ok, true);
  assert.equal(answer.data.goals.length, 0);
  const message = answer.data.messages.at(-1);
  assert.equal(message.steps.length, 1);
  assert.equal(message.actions[0].status, 'pending');
  const approved = await send('chat.confirm', { ...confirmation(), messageId: message.id, args: { title: '篡改', target: 9999 }, name: 'advance_goal' });
  assert.equal(approved.ok, true);
  assert.equal(approved.data.goals.length, 1);
  assert.equal(approved.data.goals[0].title, '读三篇');
  assert.equal(approved.data.goals[0].target, 3);
  assert.equal(approved.data.messages.find(item => item.id === message.id).actions[0].status, 'approved');
  assert.match(approved.data.messages.at(-1).content, /已按你的确认创建目标/);
  assert.equal(persistent[STATE_KEY].activity[0].type, 'agent_action');
});

test('concurrent approval replay advances progress only once and appends one receipt', async () => {
  const goal = createGoal({ title: '读十篇', target: 10, unit: '篇' });
  const state = stateWithAction(pendingAction({ name: 'advance_goal', args: { id: goal.id, delta: 2 }, title: '增加两篇' }));
  state.goals = [goal];
  const { send } = fixture({ state });
  const results = await Promise.all([send('chat.confirm', confirmation()), send('chat.confirm', confirmation())]);
  assert.ok(results.every(result => result.ok));
  assert.equal(results[1].data.goals[0].progress, 2);
  assert.equal(results[1].data.messages.length, 2);
  assert.equal(results[1].data.activity.length, 1);
  assert.equal((await send('chat.confirm', confirmation({ decision: 'reject' }))).data.goals[0].progress, 2);
});

test('rejected and expired actions never mutate goals or revive on replay', async () => {
  const rejected = fixture({ state: stateWithAction() });
  const result = await rejected.send('chat.confirm', confirmation({ decision: 'reject' }));
  assert.equal(result.data.messages[0].actions[0].status, 'rejected');
  assert.equal(result.data.goals.length, 0);
  assert.equal((await rejected.send('chat.confirm', confirmation())).data.goals.length, 0);
  const expiredState = stateWithAction(pendingAction({ createdAt: new Date(DATE.getTime() - 31 * 60000).toISOString(), expiresAt: new Date(DATE.getTime() - 60000).toISOString() }));
  const expired = fixture({ state: expiredState });
  const late = await expired.send('chat.confirm', confirmation());
  assert.equal(late.ok, true);
  assert.equal(late.data.messages[0].actions[0].status, 'expired');
  assert.equal(late.data.goals.length, 0);
  assert.match(late.data.messages.at(-1).content, /未执行/);
  assert.equal((await expired.send('chat.confirm', confirmation())).data.messages.length, 2);
});

test('unknown tools, malformed stored arguments, bad decisions and missing goals cannot execute', async () => {
  const actions = [
    pendingAction({ name: 'delete_all', args: {} }),
    pendingAction({ args: { title: '坏参数', target: 0 } }),
    pendingAction({ args: { title: '坏参数', target: 3, script: 'sideEffect()' } }),
    pendingAction({ args: { title: '坏日期', target: 3, dueDate: '2026-02-30' } }),
    pendingAction({ expiresAt: new Date(DATE.getTime() + 31 * 60000).toISOString() }),
    pendingAction({ createdAt: new Date(DATE.getTime() + 60000).toISOString(), expiresAt: new Date(DATE.getTime() + 31 * 60000).toISOString() }),
    pendingAction({ name: 'advance_goal', args: { id: 'missing-goal', delta: 1 } }),
  ];
  for (const action of actions) {
    const { send } = fixture({ state: stateWithAction(action) });
    await send('chat.confirm', confirmation());
    const { data } = await send('state.get');
    assert.equal(data.goals.length, 0);
    assert.ok(data.messages[0].actions.every(item => item.status !== 'approved'));
  }
  const { send } = fixture({ state: stateWithAction() });
  assert.equal((await send('chat.confirm', confirmation({ decision: 'maybe' }))).ok, false);
  assert.equal((await send('chat.confirm', confirmation({ messageId: 'unknown' }))).ok, false);
  assert.equal((await send('state.get')).data.messages[0].actions[0].status, 'pending');
});

test('confirmation storage failure is atomic and a subsequent retry commits once', async () => {
  const goal = createGoal({ title: '读十篇', target: 10 });
  const state = stateWithAction(pendingAction({ name: 'advance_goal', args: { id: goal.id, delta: 2 } }));
  state.goals = [goal];
  const { send, api, persistent } = fixture({ state });
  const originalSet = api.storage.local.set;
  api.storage.local.set = async () => { throw new Error('disk write failed'); };
  assert.equal((await send('chat.confirm', confirmation())).ok, false);
  assert.equal(persistent[STATE_KEY].goals[0].progress, 0);
  assert.equal(persistent[STATE_KEY].messages[0].actions[0].status, 'pending');
  assert.equal(persistent[STATE_KEY].messages.length, 1);
  api.storage.local.set = originalSet;
  const retry = await send('chat.confirm', confirmation());
  assert.equal(retry.ok, true);
  assert.equal(retry.data.goals[0].progress, 2);
  assert.equal(retry.data.messages[0].actions[0].status, 'approved');
});

test('browser read tools sanitize metadata, emit progress and do not create durable memories', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  const secret = 'test-agent-credential';
  let pageResult, tabResult;
  const { send, broadcasts, scripts, persistent } = fixture({ state, key: secret, origins: ['https://api.deepseek.com/*'], tabs: [{ id: 5, active: true, url: 'https://example.com/article?access_token=private' }], page: { url: 'https://example.com/article?access_token=private', title: '页面', excerpt: '正文 api_key=sk-private-1234567890 内容' }, cloud: async (text, current, { executeTool, onStep }) => {
    pageResult = await executeTool('read_current_page', {});
    tabResult = await executeTool('list_tabs', {});
    await onStep({ id: 'step-read', name: 'read_current_page', label: '阅读页面', status: 'completed', summary: `已读取 ${secret}`, rawContent: '不可广播原始内容' });
    return { content: '已读取当前页面，未保存为记忆。', mode: 'cloud', sources: [], steps: [{ id: 'step-read', name: 'read_current_page', label: '阅读页面', status: 'completed', summary: '完成' }], actions: [] };
  } });
  const result = await send('chat.send', { text: '看看当前页面', requestId: 'turn-browser' });
  assert.equal(result.ok, true);
  assert.equal(scripts.length, 1);
  assert.equal(pageResult.url, 'https://example.com/article');
  assert.equal(pageResult.excerpt.includes('sk-private'), false);
  assert.equal(tabResult[0].url.includes('access_token'), false);
  assert.equal(persistent[STATE_KEY].memories.length, 0);
  assert.equal(result.data.messages.at(-1).steps[0].name, 'read_current_page');
  assert.equal(broadcasts[0].requestId, 'turn-browser');
  assert.equal(broadcasts[0].type, 'agent.progress');
  assert.equal(JSON.stringify(broadcasts).includes(secret), false);
  assert.equal(JSON.stringify(broadcasts).includes('rawContent'), false);
});

test('browser executor refuses input injection and writes and respects exclusions before and after read', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  state.settings.excludedDomains = ['private.example'];
  const run = async ({ tabUrl, pageUrl }) => {
    const errors = [];
    const context = fixture({ state, key: 'test-agent-key', origins: ['https://api.deepseek.com/*'], tabs: [{ id: 5, active: true, url: tabUrl }], page: { url: pageUrl, title: '页面', excerpt: '正文' }, cloud: async (text, current, { executeTool }) => {
      for (const [name, args] of [['read_current_page', { script: 'dangerous()' }], ['create_goal', { title: '不应创建', target: 3 }], ['read_current_page', {}]]) {
        try { await executeTool(name, args); } catch (error) { errors.push(error.message); }
      }
      return { content: '未读取该页面。', mode: 'cloud', sources: [], steps: [], actions: [] };
    } });
    await context.send('chat.send', { text: '测试边界' });
    return { ...context, errors };
  };
  const before = await run({ tabUrl: 'https://sub.private.example/', pageUrl: 'https://sub.private.example/' });
  assert.equal(before.scripts.length, 0);
  assert.equal(before.errors.length, 3);
  const dotted = await run({ tabUrl: 'https://private.example./', pageUrl: 'https://private.example./' });
  assert.equal(dotted.scripts.length, 0);
  assert.equal(dotted.errors.length, 3);
  const after = await run({ tabUrl: 'https://example.com/', pageUrl: 'https://private.example/' });
  assert.equal(after.scripts.length, 1);
  assert.equal(after.errors.length, 3);
  assert.equal(after.persistent[STATE_KEY].goals.length, 0);
  assert.equal(after.persistent[STATE_KEY].memories.length, 0);
});

test('injected page reader excludes forms, editable controls and hidden text', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  let result;
  const { send, api } = fixture({ state, key: 'test-key', origins: ['https://api.deepseek.com/*'], tabs: [{ id: 5, active: true, url: 'https://example.com/' }], cloud: async (text, current, { executeTool }) => {
    result = await executeTool('read_current_page', {});
    return { content: '已读取。', mode: 'cloud', sources: [] };
  } });
  api.scripting.executeScript = async request => {
    let index = 0;
    const nodes = [
      { text: '公开正文', excluded: false, hidden: false },
      { text: '表单中秘密', excluded: true, hidden: false },
      { text: '编辑框秘密', excluded: true, hidden: false },
      { text: '隐藏文本', excluded: false, hidden: true },
      { text: '余下公开正文', excluded: false, hidden: false },
    ].map(item => ({ nodeValue: item.text, parentElement: { hidden: item.hidden, closest(selector) { assert.match(selector, /form,input,textarea/); assert.match(selector, /contenteditable/); return item.excluded ? {} : null; } } }));
    const document = { title: '页面', body: {}, querySelector() { return null; }, createTreeWalker() { return { nextNode() { return nodes[index++] || null; } }; } };
    const extracted = runInNewContext(`(${request.func.toString()})()`, { document, location: { href: 'https://example.com/' }, NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle(element) { return { display: element.hidden ? 'none' : 'block', visibility: 'visible' }; } });
    return [{ result: extracted }];
  };
  assert.equal((await send('chat.send', { text: '读页面' })).ok, true);
  assert.equal(result.excerpt, '公开正文 余下公开正文');
});

test('agent tab metadata is capped, excludes disallowed domains and tolerates disconnected progress views', async () => {
  const state = createInitialState();
  state.settings.ai.enabled = true;
  state.settings.excludedDomains = ['private.example'];
  let tabsResult;
  const tabs = [{ id: 1, url: 'https://private.example/' }, ...Array.from({ length: 40 }, (_, i) => ({ id: i + 2, url: `https://example.com/${i}?session=secret`, title: '公开页面' }))];
  const { send, api } = fixture({ state, key: 'test-key', origins: ['https://api.deepseek.com/*'], tabs, cloud: async (text, current, { executeTool, onStep }) => {
    tabsResult = await executeTool('list_tabs', {});
    await onStep({ id: 'step', name: 'list_tabs', label: '标签页', summary: '完成', status: 'completed' });
    return { content: '完成。', mode: 'cloud', sources: [] };
  } });
  api.runtime.sendMessage = async () => { throw new Error('Receiving end does not exist'); };
  assert.equal((await send('chat.send', { text: '看标签页', requestId: 'test-turn' })).ok, true);
  assert.equal(tabsResult.length, 30);
  assert.equal(tabsResult.some(tab => tab.url.includes('private') || tab.url.includes('session=')), false);
});
