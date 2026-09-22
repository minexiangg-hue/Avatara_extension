import { createInitialState, normalizeMemory, mergeMemories, sanitizeState, sanitizeText, normalizeUrl, normalizeAgentStep, normalizeAgentAction, createGoal, advanceGoal, normalizeBaseUrl } from '../core/model.js';
import { searchMemories } from '../core/search.js';
import { answerLocal, answerCloud, testConnection } from '../core/assistant.js';
import { validateToolArgs } from '../core/agent-tools.js';
import { queryChromeHistory } from './history-query.js';
import { temporalHistoryRequest, historyLocalAnswer } from '../core/history.js';

export const STATE_KEY = 'avatara_state';
export const API_KEY = 'avatara_api_key';

/** All mutations, including AI turns and history events, share one queue. */
export function createRuntime(api, { cloud = answerCloud, local = answerLocal, test = testConnection, now = () => new Date() } = {}) {
  let queue = Promise.resolve();
  const serial = (task) => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  };
  const timestamp = () => now().toISOString();
  const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  const fail = (message) => { throw new Error(message); };
  const requireObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const checkedUrl = (value) => {
    let url;
    try { url = new URL(String(value)); } catch { fail('页面地址无效。'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('只支持不含登录凭证的 HTTP 或 HTTPS 页面。');
    return url;
  };
  const matchesDomain = (hostname, excluded) => {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return excluded.some((domain) => host === domain || host.endsWith(`.${domain}`));
  };
  const excludedDomains = (values) => {
    if (!Array.isArray(values)) fail('排除域名应为列表。');
    return [...new Set(values.slice(0, 100).map((value) => {
      const raw = cleanText(value, 253).replace(/^\*\./, '');
      if (!raw) return '';
      const url = checkedUrl(raw.includes('://') ? raw : `https://${raw}`);
      return url.hostname.toLowerCase().replace(/^www\./, '');
    }).filter(Boolean))];
  };
  const enforcePolicy = (state) => {
    const safe = sanitizeState(state);
    const cutoff = now().getTime() - safe.settings.retentionDays * 86400000;
    safe.memories = safe.memories.filter((memory) => {
      try { new URL(memory.url); } catch { return false; }
      return memory.saved || new Date(memory.visitedAt).getTime() >= cutoff;
    });
    safe.settings.ai.hasKey = false;
    return safe;
  };
  const writeState = async (state) => {
    try { await api.storage.local.set({ [STATE_KEY]: state }); }
    catch {
      // Browser storage errors can include implementation details; do not echo them.
      fail('本机数据保存失败，已有数据仍保留。请检查磁盘剩余空间，或在设置中先导出备份，再释放存储空间后重试。');
    }
  };
  const readState = async (persistMaintenance = true) => {
    const stored = await api.storage.local.get(STATE_KEY);
    const safe = enforcePolicy(stored[STATE_KEY] || createInitialState());
    // Apply retention to durable storage too, not just the visible list.
    if (persistMaintenance && JSON.stringify(stored[STATE_KEY]) !== JSON.stringify(safe)) await writeState(safe);
    return safe;
  };
  const keyValue = async () => {
    const data = await api.storage.session.get(API_KEY);
    return typeof data[API_KEY] === 'string' ? data[API_KEY] : '';
  };
  const exposed = async (state) => {
    const safe = enforcePolicy(state);
    safe.settings.ai.hasKey = Boolean(await keyValue());
    return safe;
  };
  const save = async (state) => {
    const safe = enforcePolicy(state);
    await writeState(safe);
    return exposed(safe);
  };
  const activity = (state, type, label) => {
    state.activity.unshift({ id: crypto.randomUUID(), type, label, createdAt: timestamp() });
    state.activity = state.activity.slice(0, 100);
  };
  const permission = async (requested) => Boolean(await api.permissions.contains(requested));
  const checkProvider = async (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const url = new URL(normalized);
    const origin = `${url.protocol}//${url.hostname}/*`;
    if (!await permission({ origins: [origin] })) fail('尚未授权连接这个 AI 服务。请在设置中点击「测试连接」并允许访问。');
    return normalized;
  };
  const findMemory = (state, id) => state.memories.find((memory) => memory.id === id) || fail('这条记忆已不存在，请刷新后重试。');
  const findGoal = (state, id) => state.goals.findIndex((goal) => goal.id === id);
  const currentTab = async () => {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) fail('请在想保存的普通网页上点击 Avatara 图标，再选择「记住当前页面」。');
    return tab;
  };
  const allowedTabs = async (state) => (await api.tabs.query({ currentWindow: true }))
    .filter(tab => Number.isInteger(tab.id) && /^https?:\/\//.test(tab.url || ''))
    .map(tab => ({ id: tab.id, title: sanitizeText(tab.title || new URL(tab.url).hostname, 240), url: normalizeUrl(tab.url), active: Boolean(tab.active) }))
    .filter(tab => tab.url && !matchesDomain(new URL(tab.url).hostname, state.settings.excludedDomains))
    .slice(0, 30);
  const readCurrentPage = async (state) => {
    const tab = await currentTab();
    if (matchesDomain(new URL(tab.url).hostname, state.settings.excludedDomains)) fail('这个网站在排除列表中，未读取页面。');
    let results;
    try {
      results = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const root = document.querySelector('main') || document.querySelector('article') || document.body;
          const chunks = [];
          let length = 0;
          if (root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode()) && length < 12000) {
              const element = node.parentElement;
              if (!element || element.closest('script,style,noscript,template,form,input,textarea,select,option,button,[contenteditable],[role="textbox"],[hidden],[aria-hidden="true"]')) continue;
              const style = getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') continue;
              if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) continue;
              const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
              if (!text) continue;
              chunks.push(text.slice(0, 12000 - length));
              length += text.length + 1;
            }
          }
          return { title: document.title, url: location.href, excerpt: chunks.join(' ').slice(0, 12000) };
        },
      });
    } catch { fail('当前页面尚未授权读取。请在该网页上点击 Avatara 扩展图标后再试；内部页与商店页不支持读取。'); }
    const page = results?.[0]?.result;
    if (!page?.url) fail('没有读取到页面，请等它加载完成后重试。');
    const currentUrl = checkedUrl(page.url);
    if (matchesDomain(currentUrl.hostname, state.settings.excludedDomains)) fail('这个网站在排除列表中，未读取页面。');
    // Discard a document that changed origin while script execution was pending.
    if (currentUrl.origin !== new URL(tab.url).origin) fail('页面在读取期间发生跳转，请重新授权当前页面后再试。');
    const excerpt = sanitizeText(page.excerpt, 12000);
    if (!excerpt) fail('当前页面没有可读取的正文。表单和输入内容不会被读取。');
    return { title: sanitizeText(page.title, 240), url: normalizeUrl(currentUrl.href), excerpt, domain: currentUrl.hostname };
  };
  const browserTool = async (name, args, state, historyCache = new Map()) => {
    args = validateToolArgs(name, args);
    if (name === 'query_history') return queryChromeHistory(api, state, args, { now: now(), cache: historyCache });
    if (name === 'read_current_page') return readCurrentPage(state);
    if (name === 'list_tabs') return allowedTabs(state);
    fail('该工具不能在浏览器运行时直接执行。');
  };
  const receipt = (state, content) => {
    state.messages.push({ id: crypto.randomUUID(), role: 'assistant', content, createdAt: timestamp(), mode: 'local', sources: [], steps: [], actions: [] });
  };

  async function execute(type, payload) {
    if (type === 'data.clear') {
      await api.storage.session.remove(API_KEY);
      return save(createInitialState());
    }
    if (type === 'tabs.open') {
      const url = checkedUrl(payload.url);
      await api.tabs.create({ url: url.href });
      return { opened: true };
    }
    if (type === 'tabs.list') {
      return allowedTabs(await readState());
    }
    const state = await readState(type !== 'data.export');
    switch (type) {
      case 'state.get': return exposed(state);
      case 'history.query': return browserTool('query_history', payload, state);
      case 'data.export': {
        const safe = enforcePolicy(state);
        safe.settings.ai.hasKey = false;
        return safe;
      }
      case 'profile.update': {
        if ('name' in payload) state.profile.name = cleanText(payload.name, 80);
        if ('focus' in payload) state.profile.focus = cleanText(payload.focus, 300);
        return save(state);
      }
      case 'settings.update': {
        const previousOrigin = new URL(state.settings.ai.baseUrl).origin;
        let nextSessionKey;
        if ('captureEnabled' in payload) {
          if (typeof payload.captureEnabled !== 'boolean') fail('自动记录设置无效。');
          if (payload.captureEnabled && !await permission({ permissions: ['history'] })) fail('请先允许读取浏览历史，再开启自动记录。');
          state.settings.captureEnabled = payload.captureEnabled;
        }
        if ('retentionDays' in payload) {
          const days = Number(payload.retentionDays);
          if (!Number.isInteger(days) || days < 1 || days > 3650) fail('保留时长需为 1 至 3650 天。');
          state.settings.retentionDays = days;
        }
        if ('excludedDomains' in payload) state.settings.excludedDomains = excludedDomains(payload.excludedDomains);
        if ('ai' in payload) {
          const ai = requireObject(payload.ai);
          if ('baseUrl' in ai) state.settings.ai.baseUrl = normalizeBaseUrl(ai.baseUrl);
          if ('model' in ai) {
            state.settings.ai.model = cleanText(ai.model, 120);
            if (!state.settings.ai.model) fail('请填写模型名称。');
          }
          if ('enabled' in ai) {
            if (typeof ai.enabled !== 'boolean') fail('云端 AI 设置无效。');
            state.settings.ai.enabled = ai.enabled;
          }
          const originChanged = new URL(state.settings.ai.baseUrl).origin !== previousOrigin;
          const suppliedKey = 'apiKey' in ai ? cleanText(ai.apiKey, 4096) : '';
          if (originChanged && state.settings.ai.enabled && !suppliedKey) fail('AI 服务地址已更换，请明确填写新服务使用的 API 密钥后再启用。原连接与密钥未改变。');
          if (state.settings.ai.enabled) await checkProvider(state.settings.ai.baseUrl);
          if ('apiKey' in ai || originChanged) nextSessionKey = suppliedKey;
        }
        if (nextSessionKey === undefined) return save(state);
        const previousKey = await keyValue();
        if (nextSessionKey) await api.storage.session.set({ [API_KEY]: nextSessionKey });
        else await api.storage.session.remove(API_KEY);
        try { return await save(state); }
        catch (error) {
          // Settings and credentials live in different storage areas. Restore the
          // previous credential if the persistent settings commit is rejected.
          try {
            if (previousKey) await api.storage.session.set({ [API_KEY]: previousKey });
            else await api.storage.session.remove(API_KEY);
          } catch { await api.storage.session.remove(API_KEY).catch(() => {}); }
          throw error;
        }
      }
      case 'history.import': {
        if (!await permission({ permissions: ['history'] })) fail('尚未获得浏览历史权限，请点击导入并允许访问。');
        const days = Number(payload.days ?? 30);
        if (!Number.isInteger(days) || days < 1 || days > 365) fail('请选择 1 至 365 天内的历史。');
        const entries = await api.history.search({ text: '', startTime: now().getTime() - days * 86400000, endTime: now().getTime(), maxResults: 5000 });
        const memories = entries.map((entry) => normalizeMemory({
          url: entry.url, title: entry.title, visitedAt: new Date(entry.lastVisitTime || now().getTime()).toISOString(),
          visitCount: entry.visitCount || 1, source: 'history'
        })).filter((memory) => memory && !matchesDomain(new URL(memory.url).hostname, state.settings.excludedDomains));
        state.memories = mergeMemories(state.memories, memories);
        state.importedAt = timestamp();
        activity(state, 'import', `导入近 ${days} 天浏览历史`);
        return save(state);
      }
      case 'memory.search': {
        const memories = payload.filter === 'saved' ? state.memories.filter((memory) => memory.saved) : state.memories;
        return searchMemories(memories, cleanText(payload.query, 500), { limit: 200 });
      }
      case 'memory.toggleSaved': {
        const memory = findMemory(state, payload.id);
        memory.saved = !memory.saved;
        return save(state);
      }
      case 'memory.capture': {
        const tab = await currentTab();
        if (matchesDomain(new URL(tab.url).hostname, state.settings.excludedDomains)) fail('这个网站在排除列表中。可以在设置中更改。');
        let results;
        try {
          results = await api.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const root = document.querySelector('main') || document.querySelector('article') || document.body;
              return { title: document.title, url: location.href, excerpt: (root?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12000) };
            }
          });
        } catch { fail('暂时无法读取这个页面。请在该网页上重新点击 Avatara 图标后保存；浏览器内部页与商店页不支持采集。'); }
        const page = results?.[0]?.result;
        if (!page?.url || !page.excerpt) fail('页面还没有可保存的正文，请等它加载完成再试。');
        if (matchesDomain(checkedUrl(page.url).hostname, state.settings.excludedDomains)) fail('这个网站在排除列表中。');
        const memory = normalizeMemory({ ...page, source: 'page', visitedAt: timestamp(), saved: true, visitCount: 1 });
        if (!memory) fail('无法保存这个页面的地址。');
        state.memories = mergeMemories(state.memories, [memory]);
        activity(state, 'capture', `记住了「${cleanText(page.title || memory.domain, 80)}」`);
        return save(state);
      }
      case 'goals.create': {
        const input = { title: cleanText(payload.title, 180), why: cleanText(payload.why, 500), target: Number(payload.target ?? 5), unit: cleanText(payload.unit || '次', 20), dueDate: cleanText(payload.dueDate, 10) };
        if (!input.title) fail('给这个目标起一个名字吧。');
        if (!Number.isInteger(input.target) || input.target <= 0 || input.target > 100000) fail('目标次数需为 1 至 100000 的整数。');
        if (input.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(Date.parse(input.dueDate)) || new Date(`${input.dueDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.dueDate)) fail('截止日期无效。');
        const goal = createGoal(input);
        state.goals.unshift(goal);
        activity(state, 'goal', `开始目标「${goal.title}」`);
        return save(state);
      }
      case 'goals.advance': {
        const index = findGoal(state, payload.id);
        if (index === -1) fail('这个目标已不存在，请刷新后重试。');
        const delta = Number(payload.delta ?? 1);
        if (!Number.isInteger(delta) || delta <= 0 || delta > 100000) fail('进度增量需为 1 至 100000 的整数。');
        const wasComplete = state.goals[index].status === 'completed';
        state.goals[index] = advanceGoal(state.goals[index], delta);
        if (!wasComplete && state.goals[index].status === 'completed') activity(state, 'goal', `完成目标「${state.goals[index].title}」`);
        return save(state);
      }
      case 'goals.delete': {
        const index = findGoal(state, payload.id);
        if (index === -1) fail('这个目标已不存在。');
        state.goals.splice(index, 1);
        return save(state);
      }
      case 'chat.send': {
        const apiKey = await keyValue();
        const rawText = String(payload.text ?? '');
        const text = cleanText(apiKey ? rawText.split(apiKey).join('[已隐藏密钥]') : rawText, 6000);
        if (!text) fail('先写一点想聊的内容吧。');
        let answer;
        const historyCache = new Map();
        if (state.settings.ai.enabled) {
          if (!apiKey) fail('当前浏览器会话中没有 API 密钥。请在设置中重新填写，或关闭云端 AI 使用本地助理。');
          await checkProvider(state.settings.ai.baseUrl);
          const requestId = sanitizeText(payload.requestId, 120);
          const onStep = async (step) => {
            const publicStep = normalizeAgentStep(Object.fromEntries(Object.entries(requireObject(step)).map(([key, value]) => [key, typeof value === 'string' ? value.split(apiKey).join('[已隐藏]') : value])));
            if (!requestId || !publicStep || typeof api.runtime.sendMessage !== 'function') return;
            try { await api.runtime.sendMessage({ type: 'agent.progress', requestId, step: publicStep }); } catch { /* Closing a view must not abort the agent. */ }
          };
          try { answer = await cloud(text, state, { apiKey, executeTool: (name, args) => browserTool(name, args, state, historyCache), onStep }); }
          catch (error) { fail(`云端回答未完成：${cleanText(error?.message || '连接失败，请稍后重试。', 400)}`); }
        } else {
          const temporal = temporalHistoryRequest(text);
          answer = temporal ? historyLocalAnswer(await browserTool('query_history', temporal, state, historyCache)) : local(text, state);
        }
        if (apiKey) answer = JSON.parse(JSON.stringify(answer, (_key, value) => typeof value === 'string' ? value.split(apiKey).join('[已隐藏密钥]') : value));
        const actions = (Array.isArray(answer.actions) ? answer.actions : []).slice(0, 8).map(normalizeAgentAction).filter(Boolean).map(action => action.status === 'failed' ? action : {
          ...action, status: 'pending', createdAt: timestamp(), expiresAt: new Date(now().getTime() + 30 * 60000).toISOString(),
        });
        state.messages.push({ id: crypto.randomUUID(), role: 'user', content: text, createdAt: timestamp(), sources: [], mode: answer.mode });
        state.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: answer.content, sources: answer.sources, mode: answer.mode, steps: answer.steps, actions, createdAt: timestamp() });
        state.messages = state.messages.slice(-200);
        return save(state);
      }
      case 'chat.confirm': {
        if (!['approve', 'reject'].includes(payload.decision)) fail('确认决定无效。');
        const message = state.messages.find(item => item.id === payload.messageId && item.role === 'assistant');
        const action = message?.actions.find(item => item.id === payload.actionId);
        if (!action) fail('这项待确认操作已不存在，请重新提出请求。');
        // Terminal actions are idempotent: retried clicks cannot create or advance twice.
        if (action.status !== 'pending') return exposed(state);
        if (Date.parse(action.createdAt) > now().getTime()) {
          action.status = 'failed';
          receipt(state, '这项操作的确认时间无效，未执行。请重新提出请求。');
          return save(state);
        }
        const expired = Date.parse(action.expiresAt) <= now().getTime();
        if (expired) {
          action.status = 'expired';
          receipt(state, '这项操作已超过 30 分钟的确认期限，未执行。请重新提出请求。');
          return save(state);
        }
        if (payload.decision === 'reject') {
          action.status = 'rejected';
          receipt(state, `已取消「${action.title}」，没有修改任何目标。`);
          return save(state);
        }
        let args;
        try {
          args = validateToolArgs(action.name, action.args);
          if (action.name === 'advance_goal' && findGoal(state, args.id) === -1) fail('这个目标已不存在。');
          if (!['create_goal', 'advance_goal'].includes(action.name)) fail('不允许执行这项操作。');
        } catch {
          action.status = 'failed';
          receipt(state, '这项操作的参数无效或目标已不存在，没有修改任何目标。请重新提出请求。');
          return save(state);
        }
        let content;
        if (action.name === 'create_goal') {
          const goal = createGoal(args);
          state.goals.unshift(goal);
          content = `已按你的确认创建目标「${goal.title}」：${goal.progress} / ${goal.target} ${goal.unit}。`;
        } else {
          const index = findGoal(state, args.id);
          const previous = state.goals[index];
          const goal = advanceGoal(previous, args.delta);
          state.goals[index] = goal;
          content = `已按你的确认更新「${goal.title}」：${previous.progress} → ${goal.progress} / ${goal.target} ${goal.unit}${goal.status === 'completed' ? '，目标已完成' : ''}。`;
        }
        action.status = 'approved';
        receipt(state, content);
        activity(state, 'agent_action', content);
        // Goal mutation, terminal status, and receipt share one storage commit.
        return save(state);
      }
      case 'chat.clear': state.messages = []; return save(state);
      case 'ai.test': {
        const requested = requireObject(payload);
        const baseUrl = normalizeBaseUrl(requested.baseUrl ?? state.settings.ai.baseUrl);
        const originChanged = new URL(baseUrl).origin !== new URL(state.settings.ai.baseUrl).origin;
        const suppliedKey = 'apiKey' in requested ? cleanText(requested.apiKey, 4096) : '';
        if (originChanged && !suppliedKey) fail('测试不同的 AI 服务时，请明确填写该服务使用的 API 密钥。');
        await checkProvider(baseUrl);
        const model = cleanText(requested.model ?? state.settings.ai.model, 120);
        const apiKey = 'apiKey' in requested ? suppliedKey : await keyValue();
        if (!apiKey) fail('请先填写 API 密钥。');
        if (!model) fail('请先填写模型名称。');
        return test({ baseUrl, model, apiKey });
      }
      default: fail('这个操作暂不受支持，请刷新 Avatara 后重试。');
    }
  }

  return {
    handle(message, sender) {
      return serial(async () => {
        try {
          if (sender?.id !== api.runtime.id) fail('请求来源不被允许。');
          if (!message || typeof message.type !== 'string') fail('请求格式无效。');
          return { ok: true, data: await execute(message.type, requireObject(message.payload)) };
        } catch (error) {
          // Provider errors must never echo a supplied credential into the UI.
          let errorText = cleanText(error?.message || '操作失败，请稍后重试。', 500);
          const suppliedKey = message?.payload?.apiKey || message?.payload?.ai?.apiKey;
          const storedKey = await keyValue().catch(() => '');
          for (const secret of [suppliedKey, storedKey]) if (typeof secret === 'string' && secret) errorText = errorText.split(secret).join('[已隐藏]');
          return { ok: false, error: errorText };
        }
      });
    },
    observeHistory(entry) {
      return serial(async () => {
        const state = await readState();
        if (!state.settings.captureEnabled || !await permission({ permissions: ['history'] })) return;
        const memory = normalizeMemory({ url: entry.url, title: entry.title, visitedAt: new Date(entry.lastVisitTime || now().getTime()).toISOString(), visitCount: entry.visitCount || 1, source: 'history' });
        if (!memory || matchesDomain(new URL(memory.url).hostname, state.settings.excludedDomains)) return;
        state.memories = mergeMemories(state.memories, [memory]);
        await save(state);
      });
    },
    revokeHistory() {
      return serial(async () => {
        const state = await readState();
        state.settings.captureEnabled = false;
        await save(state);
      });
    }
  };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const runtime = createRuntime(chrome);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'agent.progress') return false;
    runtime.handle(message, sender).then(respond);
    return true;
  });
  let historyListening = false;
  const watchHistory = () => {
    if (historyListening || !chrome.history?.onVisited) return;
    try {
      chrome.history.onVisited.addListener((entry) => { runtime.observeHistory(entry).catch(() => {}); });
      historyListening = true;
    } catch { /* Permission may not be available until the user opts in. */ }
  };
  watchHistory();
  chrome.permissions.onAdded.addListener((added) => {
    if (added.permissions?.includes('history')) watchHistory();
  });
  chrome.permissions.onRemoved.addListener((removed) => {
    if (removed.permissions?.includes('history')) runtime.revokeHistory().catch(() => {});
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  });
}
