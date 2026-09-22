import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { demoRequest, DEMO_STORAGE_KEY } from '../src/preview/demo.js';
import { createDemoState } from '../src/preview/seed.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

beforeEach(() => { globalThis.localStorage = new MemoryStorage(); });

function saveActionFixture(overrides = {}, state = createDemoState()) {
  const createdAt = new Date();
  const action = {
    id: 'fixture-action', name: 'create_goal',
    args: { title: '合成确认目标', target: 3, unit: '篇', why: '测试确认流程' },
    title: '创建目标', description: '仅在演示数据中创建合成目标。', status: 'pending',
    createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 30 * 60_000).toISOString(),
    ...overrides,
  };
  state.messages = [{
    id: 'fixture-message', role: 'assistant', content: '这是确定性的测试卡片，不是云端模型输出。',
    createdAt: createdAt.toISOString(), sources: [], mode: 'local',
    steps: [{ id: 'fixture-step', name: 'list_goals', label: '读取演示目标', status: 'completed', summary: '测试夹具，未读取浏览器。' }],
    actions: [action],
  }];
  globalThis.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  return { state, payload: { messageId: 'fixture-message', actionId: 'fixture-action', decision: 'approve' } };
}

test('demo seeds plausible synthetic memories relative to the supplied date', () => {
  const now = new Date('2026-09-10T10:00:00Z');
  const state = createDemoState(now);
  assert.equal(state.memories.length, 12);
  assert.equal(state.goals.length, 3);
  assert.equal(state.messages.length, 0);
  assert.equal(state.profile.name, 'Alex');
  assert.ok(state.memories.every(memory => Date.parse(memory.visitedAt) <= now.getTime()));
  assert.ok(state.memories.every(memory => memory.url.startsWith('https://')));
});

test('demo state persists changes without aliasing returned objects', async () => {
  const initial = await demoRequest('state.get');
  const id = initial.memories[0].id;
  const originalSaved = initial.memories[0].saved;
  const result = await demoRequest('memory.toggleSaved', { id });
  assert.equal(result.memories.find(memory => memory.id === id).saved, !originalSaved);
  result.profile.name = 'Unpersisted';
  assert.equal((await demoRequest('state.get')).profile.name, 'Alex');
  assert.equal(globalThis.localStorage.values.size, 1);
  assert.ok(globalThis.localStorage.values.has(DEMO_STORAGE_KEY));
});

test('demo rejects credentials without saving them, including nested and empty keys', async () => {
  await demoRequest('state.get');
  const before = globalThis.localStorage.getItem(DEMO_STORAGE_KEY);
  for (const payload of [{ ai: { apiKey: 'not-a-real-secret' } }, { ai: { apiKey: '' } }, { extra: { api_key: 'not-a-real-secret' } }]) {
    await assert.rejects(demoRequest('settings.update', payload), /不接收|不存储/);
    assert.equal(globalThis.localStorage.getItem(DEMO_STORAGE_KEY), before);
  }
  await assert.rejects(demoRequest('ai.test', {}), /演示沙盒不连接云端/);
});

test('demo serializes concurrent turns and answers using memory without network', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network is allowed in the demo'); };
  try {
    await demoRequest('settings.update', { ai: { enabled: true } });
    await Promise.all([
      demoRequest('chat.send', { text: '帮我找关于记忆检索的资料' }),
      demoRequest('chat.send', { text: '我的目标有什么进展？' }),
    ]);
    const state = await demoRequest('state.get');
    assert.equal(state.messages.length, 4);
    assert.deepEqual(state.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
    assert.ok(state.messages.every(message => message.mode === 'local'));
    assert.match(state.messages[1].content, /未调用云端模型/);
    assert.equal(state.settings.ai.hasKey, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('demo goal lifecycle, import, and capture survive successive requests', async () => {
  const initial = await demoRequest('state.get');
  const created = await demoRequest('goals.create', { title: '测试阅读计划', why: '确认闭环', target: 2, unit: '篇' });
  const goal = created.goals.find(item => item.title === '测试阅读计划');
  assert.ok(goal);
  await demoRequest('goals.advance', { id: goal.id, delta: 1 });
  const completed = await demoRequest('goals.advance', { id: goal.id, delta: 1 });
  assert.equal(completed.goals.find(item => item.id === goal.id).status, 'completed');
  const deleted = await demoRequest('goals.delete', { id: goal.id });
  assert.equal(deleted.goals.length, initial.goals.length);
  const imported = await demoRequest('history.import', { days: 30 });
  assert.ok(imported.memories.length > initial.memories.length);
  const importedAgain = await demoRequest('history.import', { days: 30 });
  assert.equal(importedAgain.memories.length, imported.memories.length);
  const captured = await demoRequest('memory.capture');
  assert.ok(captured.memories.some(memory => memory.id === 'demo-captured-page'));
  const capturedAgain = await demoRequest('memory.capture');
  assert.equal(capturedAgain.memories.length, captured.memories.length);
});

test('empty results and invalid operations do not mutate state', async () => {
  await demoRequest('state.get');
  const before = globalThis.localStorage.getItem(DEMO_STORAGE_KEY);
  assert.deepEqual(await demoRequest('memory.search', { query: 'xylophonequasar9876' }), []);
  await assert.rejects(demoRequest('memory.toggleSaved', { id: 'missing' }), /找不到/);
  await assert.rejects(demoRequest('chat.send', { text: '   ' }), /写下/);
  await assert.rejects(demoRequest('settings.update', { retentionDays: -1 }), /保留天数/);
  await assert.rejects(demoRequest('tabs.open', { url: 'javascript:alert(1)' }), /HTTP/);
  assert.equal(globalThis.localStorage.getItem(DEMO_STORAGE_KEY), before);
});

test('demo privacy exclusions and import date range affect subsequent collection', async () => {
  await demoRequest('data.clear');
  await demoRequest('settings.update', { captureEnabled: true, retentionDays: 180, excludedDomains: ['developer.chrome.com'] });
  const imported = await demoRequest('history.import', { days: 1 });
  assert.equal(imported.memories.length, 1);
  assert.equal(imported.memories[0].domain, 'nngroup.com');
  assert.equal(imported.settings.captureEnabled, true);
  assert.equal(imported.settings.retentionDays, 180);
  await assert.rejects(demoRequest('memory.capture'), /排除列表/);
  const updated = await demoRequest('profile.update', { name: '林', focus: '每周读完一本书' });
  assert.deepEqual(updated.profile, { name: '林', focus: '每周读完一本书' });
  const exported = await demoRequest('data.export');
  assert.equal(exported.profile.name, '林');
  assert.equal(exported.settings.ai.hasKey, false);
});

test('a failed request cannot poison later requests in the queue', async () => {
  const results = await Promise.allSettled([
    demoRequest('chat.send', { text: '' }),
    demoRequest('profile.update', { name: 'Sam' }),
    demoRequest('state.get'),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[2].status, 'fulfilled');
  assert.equal(results[2].value.profile.name, 'Sam');
});

test('clear remains empty and recovers corrupt demo storage', async () => {
  await demoRequest('state.get');
  const cleared = await demoRequest('data.clear');
  assert.equal(cleared.memories.length, 0);
  assert.equal(cleared.goals.length, 0);
  assert.equal((await demoRequest('state.get')).memories.length, 0);
  globalThis.localStorage.setItem(DEMO_STORAGE_KEY, '{broken');
  await assert.rejects(demoRequest('state.get'), /无法读取/);
  await demoRequest('data.clear');
  assert.equal((await demoRequest('data.export')).memories.length, 0);
});

test('demo does not invent a native model agent or create goals from chat keywords', async () => {
  const before = await demoRequest('state.get');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Demo must never invoke a cloud agent'); };
  try {
    const state = await demoRequest('chat.send', { text: '帮我创建一个每天阅读的目标，数量为 5 篇。' });
    assert.equal(state.goals.length, before.goals.length);
    assert.equal(state.messages.at(-1).mode, 'local');
    assert.deepEqual(state.messages.at(-1).actions || [], []);
  } finally { globalThis.fetch = originalFetch; }
});

test('saved demo confirmation uses authoritative arguments and concurrent approvals are idempotent', async () => {
  const { state, payload } = saveActionFixture();
  const read = await demoRequest('state.get');
  assert.equal(read.messages[0].steps[0].name, 'list_goals');
  assert.equal(read.messages[0].actions[0].status, 'pending');
  await Promise.all([
    demoRequest('chat.confirm', { ...payload, args: { title: '客户端替换标题', target: 999 } }),
    demoRequest('chat.confirm', payload),
  ]);
  const confirmed = await demoRequest('state.get');
  assert.equal(confirmed.goals.length, state.goals.length + 1);
  assert.equal(confirmed.goals[0].title, '合成确认目标');
  assert.equal(confirmed.goals[0].target, 3);
  assert.equal(confirmed.messages[0].actions[0].status, 'approved');
  assert.equal(confirmed.messages.length, 2);
  assert.match(confirmed.messages[1].content, /独立演示数据/);
  assert.equal(confirmed.messages[1].mode, 'local');
  assert.equal(confirmed.activity.length, state.activity.length + 1);
  const persisted = globalThis.localStorage.getItem(DEMO_STORAGE_KEY);
  await demoRequest('chat.confirm', { ...payload, decision: 'reject' });
  assert.equal(globalThis.localStorage.getItem(DEMO_STORAGE_KEY), persisted);
});

test('rejected and expired demo proposals cannot modify goals', async () => {
  const { state, payload } = saveActionFixture();
  const rejected = await demoRequest('chat.confirm', { ...payload, decision: 'reject' });
  assert.equal(rejected.messages[0].actions[0].status, 'rejected');
  const replay = await demoRequest('chat.confirm', payload);
  assert.deepEqual(replay.goals, state.goals);
  assert.equal(replay.messages.length, 2);

  const now = Date.now();
  const expiredFixture = saveActionFixture({ createdAt: new Date(now - 31 * 60_000).toISOString(), expiresAt: new Date(now - 60_000).toISOString() });
  const expired = await demoRequest('chat.confirm', payload);
  assert.equal(expired.messages[0].actions[0].status, 'expired');
  assert.deepEqual(expired.goals, expiredFixture.state.goals);
});

test('demo progress confirmation fails closed for stale or invalid proposals', async () => {
  const initial = createDemoState();
  const goal = initial.goals.find(item => item.status === 'active');
  const { payload } = saveActionFixture({ name: 'advance_goal', args: { id: goal.id, delta: 2 } }, initial);
  const advanced = await demoRequest('chat.confirm', payload);
  assert.equal(advanced.goals.find(item => item.id === goal.id).progress, goal.progress + 2);

  const missingFixture = saveActionFixture({ name: 'advance_goal', args: { id: 'missing-goal', delta: 1 } }, createDemoState());
  const missing = await demoRequest('chat.confirm', payload);
  assert.equal(missing.messages[0].actions[0].status, 'failed');
  assert.deepEqual(missing.goals, missingFixture.state.goals);

  saveActionFixture({ name: 'advance_goal', args: { id: goal.id, delta: -1 } });
  const invalid = await demoRequest('chat.confirm', payload);
  assert.equal(invalid.messages[0].actions[0].status, 'failed');
  assert.equal(invalid.goals.find(item => item.id === goal.id).progress, goal.progress);
});

test('demo confirmation requires a stored assistant proposal and a supported decision', async () => {
  const { payload } = saveActionFixture();
  const before = globalThis.localStorage.getItem(DEMO_STORAGE_KEY);
  await assert.rejects(demoRequest('chat.confirm', { ...payload, decision: 'execute' }), /确认或拒绝/);
  await assert.rejects(demoRequest('chat.confirm', { ...payload, messageId: 'missing' }), /找不到/);
  await assert.rejects(demoRequest('chat.confirm', { ...payload, actionId: 'missing' }), /找不到/);
  assert.equal(globalThis.localStorage.getItem(DEMO_STORAGE_KEY), before);

  const raw = JSON.parse(before);
  raw.messages[0].role = 'user';
  globalThis.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(raw));
  await assert.rejects(demoRequest('chat.confirm', payload), /找不到/);
});

test('demo confirmation persists goal, receipt and action status atomically across storage failure', async () => {
  const { state, payload } = saveActionFixture();
  const before = globalThis.localStorage.getItem(DEMO_STORAGE_KEY);
  const storage = globalThis.localStorage;
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  await assert.rejects(demoRequest('chat.confirm', payload), /保存失败/);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), before);
  storage.setItem = setItem;
  const retried = await demoRequest('chat.confirm', payload);
  assert.equal(retried.goals.length, state.goals.length + 1);
  assert.equal(retried.messages[0].actions[0].status, 'approved');
  assert.equal(retried.messages.length, 2);
});

test('same-origin web lock preserves chat and profile writes across separate demo tabs', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const leaseQueue = new Map();
  const acquired = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request(name, callback) {
      acquired.push(name);
      const lease = (leaseQueue.get(name) || Promise.resolve()).then(callback);
      leaseQueue.set(name, lease.catch(() => {}));
      return lease;
    } } },
  });
  try {
    const secondTab = await import('../src/preview/demo.js?independent-tab-test');
    await demoRequest('state.get');
    await Promise.all([
      demoRequest('chat.send', { text: '你好' }),
      secondTab.demoRequest('profile.update', { name: 'Ada' }),
    ]);
    const saved = await demoRequest('state.get');
    assert.equal(saved.profile.name, 'Ada');
    assert.equal(saved.messages.length, 2);
    assert.ok(acquired.length >= 4);
    assert.ok(acquired.every(name => name === DEMO_STORAGE_KEY));
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});
