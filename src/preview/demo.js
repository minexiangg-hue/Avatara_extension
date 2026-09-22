import { createInitialState, sanitizeState, mergeMemories, createGoal, advanceGoal, normalizeBaseUrl } from '../core/model.js';
import { searchMemories } from '../core/search.js';
import { answerLocal } from '../core/assistant.js';
import { validateToolArgs } from '../core/agent-tools.js';
import { createDemoState, createImportedMemories, createCapturedMemory } from './seed.js';

export const DEMO_STORAGE_KEY = 'avatara_demo_state_v1';
let requestQueue = Promise.resolve();

/** An isolated ordinary-web demo. No extension APIs, real history, or cloud calls. */
export function demoRequest(type, payload = {}) {
  const request = requestQueue.then(() => {
    // localhost tabs share storage. A same-origin lock also serializes their turns.
    const locks = globalThis.navigator?.locks;
    return locks?.request ? locks.request(DEMO_STORAGE_KEY, () => handleRequest(type, payload)) : handleRequest(type, payload);
  });
  requestQueue = request.catch(() => {});
  return request;
}

async function handleRequest(type, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('请求参数无效。');
  rejectSecrets(payload);
  if (type === 'ai.test') throw new Error('演示沙盒不连接云端，也不接收 API Key。请在安装后的 Avatara 扩展中配置并测试云端模型。');
  if (type === 'data.clear') return persist(createInitialState());
  const state = readState();
  switch (type) {
    case 'state.get':
    case 'data.export':
      return clone(state);
    case 'profile.update':
      if ('name' in payload) state.profile.name = limitedText(payload.name, 80);
      if ('focus' in payload) state.profile.focus = limitedText(payload.focus, 300);
      break;
    case 'settings.update':
      updateSettings(state, payload);
      break;
    case 'memory.search':
      return clone(searchMemories(state.memories, String(payload.query || ''), { filter: payload.filter || 'all' }));
    case 'memory.toggleSaved': {
      const memory = state.memories.find(item => item.id === payload.id);
      if (!memory) throw new Error('找不到这条记忆。');
      memory.saved = !memory.saved;
      break;
    }
    case 'history.import': {
      const days = Number(payload.days ?? 30);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('请选择 1–365 天的历史范围。');
      const now = new Date();
      const cutoff = now.getTime() - days * 86_400_000;
      const incoming = createImportedMemories(now).filter(item => Date.parse(item.visitedAt) >= cutoff && !isExcluded(item.domain, state.settings.excludedDomains));
      state.memories = mergeMemories(state.memories, incoming);
      state.importedAt = new Date().toISOString();
      addActivity(state, 'import', '导入了合成的演示历史记录');
      break;
    }
    case 'memory.capture': {
      const memory = createCapturedMemory();
      if (isExcluded(memory.domain, state.settings.excludedDomains)) throw new Error('此演示网页的域名已在排除列表中。');
      state.memories = mergeMemories(state.memories, [memory]);
      addActivity(state, 'capture', '保存了一条模拟当前页面摘录');
      break;
    }
    case 'goals.create':
      state.goals.unshift(createGoal(payload));
      addActivity(state, 'goal', '创建了一个新目标');
      break;
    case 'goals.advance': {
      const index = state.goals.findIndex(goal => goal.id === payload.id);
      if (index === -1) throw new Error('找不到这个目标。');
      state.goals[index] = advanceGoal(state.goals[index], payload.delta ?? 1);
      addActivity(state, 'goal', `更新了「${state.goals[index].title}」的进度`);
      break;
    }
    case 'goals.delete': {
      const index = state.goals.findIndex(goal => goal.id === payload.id);
      if (index === -1) throw new Error('找不到这个目标。');
      state.goals.splice(index, 1);
      break;
    }
    case 'chat.send': {
      const text = limitedText(payload.text, 6000);
      if (!text) throw new Error('先写下你想聊的内容。');
      const answer = await answerLocal(text, state);
      if (state.settings.ai.enabled) answer.content = `演示沙盒使用本地记忆回答，未调用云端模型。\n\n${answer.content}`;
      const createdAt = new Date().toISOString();
      state.messages.push(
        { id: makeId('message'), role: 'user', content: text, createdAt, sources: [], mode: 'local' },
        { id: makeId('message'), role: 'assistant', content: answer.content, sources: answer.sources || [], steps: answer.steps || [], actions: answer.actions || [], mode: 'local', createdAt },
      );
      state.messages = state.messages.slice(-100);
      break;
    }
    case 'chat.confirm':
      return confirmAction(state, payload);
    case 'chat.clear':
      state.messages = [];
      break;
    case 'tabs.list':
      return [
        { id: 101, title: '演示页面 · Chrome 扩展开发', url: 'https://developer.chrome.com/docs/extensions/develop', active: true },
        { id: 102, title: '演示页面 · Local-first software', url: 'https://www.inkandswitch.com/local-first/', active: false },
      ];
    case 'tabs.open': {
      let url;
      try { url = new URL(payload.url); } catch { throw new Error('网页地址无效。'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('只能打开有效的 HTTP 或 HTTPS 网页。');
      if (typeof globalThis.open !== 'function') throw new Error('当前环境无法打开网页。');
      globalThis.open(url.href, '_blank', 'noopener,noreferrer');
      return { opened: true };
    }
    default:
      throw new Error(`演示沙盒不支持这个操作：${String(type).slice(0, 60)}`);
  }
  return persist(state);
}

/** Exercise saved confirmation fixtures without pretending to call a cloud agent. */
function confirmAction(state, payload) {
  if (!['approve', 'reject'].includes(payload.decision)) throw new Error('请选择确认或拒绝。');
  const message = state.messages.find(item => item.id === payload.messageId && item.role === 'assistant');
  const action = message?.actions?.find(item => item.id === payload.actionId);
  if (!action) throw new Error('找不到这项待确认操作。');
  if (action.status !== 'pending') return clone(state);

  const now = Date.now();
  const createdAt = Date.parse(action.createdAt);
  const expiresAt = Date.parse(action.expiresAt);
  let receipt;
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now || expiresAt <= createdAt || now >= Math.min(expiresAt, createdAt + 30 * 60_000)) {
    action.status = 'expired';
    receipt = '这项演示操作已过期，没有修改目标。确认卡片只在创建后的 30 分钟内有效。';
  } else if (payload.decision === 'reject') {
    action.status = 'rejected';
    receipt = '已拒绝这项演示操作，目标没有变化。';
  } else {
    try {
      // Only the saved proposal supplies arguments. Client-supplied args are ignored.
      const args = validateToolArgs(action.name, action.args);
      if (action.name === 'create_goal') {
        const goal = createGoal(args);
        state.goals.unshift(goal);
        receipt = `已在独立演示数据中创建目标「${goal.title}」，目标为 ${goal.target} ${goal.unit}。`;
      } else if (action.name === 'advance_goal') {
        const index = state.goals.findIndex(goal => goal.id === args.id);
        if (index === -1) throw new Error('这个目标已不存在。');
        state.goals[index] = advanceGoal(state.goals[index], args.delta);
        const goal = state.goals[index];
        receipt = `已在独立演示数据中记录「${goal.title}」的进度：${goal.progress} / ${goal.target} ${goal.unit}。`;
      } else throw new Error('演示只支持确认创建目标或记录目标进度。');
      action.status = 'approved';
    } catch (error) {
      action.status = 'failed';
      receipt = `这项演示操作未完成，目标没有变化：${String(error.message || '操作无效。').slice(0, 240)}`;
    }
  }
  state.messages.push({ id: makeId('message'), role: 'assistant', content: receipt, createdAt: new Date(now).toISOString(), sources: [], mode: 'local', steps: [], actions: [] });
  state.messages = state.messages.slice(-100);
  addActivity(state, 'agent', receipt);
  return persist(state);
}

function updateSettings(state, payload) {
  if ('captureEnabled' in payload) {
    if (typeof payload.captureEnabled !== 'boolean') throw new Error('采集开关必须为布尔值。');
    state.settings.captureEnabled = payload.captureEnabled;
  }
  if ('retentionDays' in payload) {
    const value = Number(payload.retentionDays);
    if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error('保留天数需要在 1–3650 之间。');
    state.settings.retentionDays = value;
  }
  if ('excludedDomains' in payload) {
    if (!Array.isArray(payload.excludedDomains)) throw new Error('排除域名格式无效。');
    const domains = payload.excludedDomains.map(value => limitedText(value, 253).toLowerCase());
    if (domains.some(domain => !/^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(domain))) throw new Error('请填写域名，例如 example.com，无需 https:// 或路径。');
    state.settings.excludedDomains = [...new Set(domains)].slice(0, 100);
  }
  if ('ai' in payload) {
    if (!payload.ai || typeof payload.ai !== 'object' || Array.isArray(payload.ai)) throw new Error('模型设置无效。');
    if ('enabled' in payload.ai) {
      if (typeof payload.ai.enabled !== 'boolean') throw new Error('模型开关必须为布尔值。');
      state.settings.ai.enabled = payload.ai.enabled;
    }
    if ('baseUrl' in payload.ai) state.settings.ai.baseUrl = normalizeBaseUrl(payload.ai.baseUrl);
    if ('model' in payload.ai) {
      const model = limitedText(payload.ai.model, 120);
      if (!model) throw new Error('请填写模型名称。');
      state.settings.ai.model = model;
    }
  }
  state.settings.ai.hasKey = false;
}

function readState() {
  let raw;
  try { raw = globalThis.localStorage.getItem(DEMO_STORAGE_KEY); }
  catch { throw new Error('浏览器阻止了演示数据存储，请允许此本地页面使用本地存储。'); }
  if (raw === null) return persist(createDemoState());
  try {
    const parsed = JSON.parse(raw);
    rejectSecrets(parsed);
    const state = sanitizeState(parsed);
    state.settings.ai.hasKey = false;
    return state;
  } catch { throw new Error('演示数据无法读取。请清除此本地演示页面的站点数据后重试。'); }
}

function persist(state) {
  const safe = sanitizeState(state);
  safe.settings.ai.hasKey = false;
  rejectSecrets(safe);
  try { globalThis.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(safe)); }
  catch { throw new Error('演示数据保存失败，可能是本地存储空间不足。'); }
  return clone(safe);
}

function rejectSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[_-]?key|key|secret|access[_-]?token|authorization)$/i.test(key)) throw new Error('演示沙盒不接收或存储 API Key。请在真实扩展中配置云端连接。');
    rejectSecrets(child);
  }
}

function isExcluded(domain, excluded = []) { return excluded.some(item => domain === item || domain.endsWith(`.${item}`)); }
function limitedText(value, limit) {
  if (typeof value !== 'string') throw new Error('请输入有效文字。');
  const text = value.trim();
  if (text.length > limit) throw new Error(`文字请保持在 ${limit} 字以内。`);
  return text;
}
function clone(value) { return structuredClone(value); }
function makeId(prefix) { return `${prefix}-${globalThis.crypto.randomUUID()}`; }
function addActivity(state, type, label) {
  state.activity.unshift({ id: makeId('activity'), type, label, createdAt: new Date().toISOString() });
  state.activity = state.activity.slice(0, 40);
}
