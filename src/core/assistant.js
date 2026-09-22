import { normalizeBaseUrl, sanitizeState, sanitizeText } from './model.js';
import { searchMemories, buildInsights, queryTokens } from './search.js';
import { runAgent } from './agent.js';

const DEFAULT_TIMEOUT = 25000;
const MAX_INPUT = 4000;
const MAX_OUTPUT = 12000;
class CloudError extends Error {}

function inputText(value) {
  const text = sanitizeText(value, MAX_INPUT);
  if (!text) throw new Error('先写下你想聊的内容。');
  return text;
}

function selectedMemories(text, state) {
  const found = searchMemories(state.memories, text, { limit: 6 });
  if (found.length) return found;
  const broad = /^(?:帮我|请|给我|可以)?(?:总结|回顾|整理|看看)?(?:一下)?(?:我)?(?:最近|近期|今天|本周)(?:的|都|在)?(?:关注|浏览|看过|读过|阅读|记忆|主题|兴趣|内容|页面|文章|记录|了|什么|哪些|什么内容|哪些内容|哪些主题|主要关注什么|主要关注哪些主题|\s|[？?。！!])*$/u.test(text);
  return broad ? searchMemories(state.memories, '', { limit: 6 }) : [];
}

function sourceOf(memory) { return { id: memory.id, title: memory.title, url: memory.url, excerpt: memory.excerpt.slice(0, 800) }; }

function isGoalQuestion(text) {
  return /(?:我的目标|目标进度|目标计划|目标的下一步|进行中的目标|已完成的目标|当前目标|my goals?)/i.test(text) || /^(?:看看|回顾|整理|更新|查看)?(?:目标|计划|进度)[？?。!！\s]*$/u.test(text);
}

function isMemoryQuestion(text) {
  return /(?:找|搜|检索|回顾|总结).*(?:记忆|历史|看过|浏览|读过|阅读|文章|内容|资料|论文)|(?:我|我的|之前|最近|近期|今天|本周).*(?:浏览|看过|读过|关注|主题)|(?:记忆|历史|收藏).*(?:找|搜|回顾|什么)|^(?:找一下|搜一下|查找|检索).+/u.test(text) || /(?:find|search|recall).*(?:history|memories|read|articles)|my browsing|recently read/i.test(text);
}

function selectedGoals(text, state) {
  if (!isGoalQuestion(text)) return [];
  const questionWords = new Set(['目标', '计划', '进度', '下一步', '当前', '进行', '完成', '查看', '怎么', '如何', '可以', '我的', 'goal', 'goals', 'progress', 'next', 'step', 'steps']);
  const tokens = queryTokens(text).filter(token => token.length > 1 && !questionWords.has(token));
  const specificallyNamed = state.goals.filter(goal => tokens.some(token => goal.title.toLowerCase().includes(token)));
  const candidates = specificallyNamed.length ? specificallyNamed : state.goals.filter(goal => /(?:已完成|完成了哪些|completed)/i.test(text) ? goal.status === 'completed' : goal.status === 'active');
  return candidates.slice(0, 5).map(goal => ({
    title: goal.title, why: goal.why.slice(0, 240), target: goal.target,
    progress: goal.progress, unit: goal.unit, dueDate: goal.dueDate, status: goal.status,
  }));
}

export function answerLocal(value, rawState) {
  const text = inputText(value);
  if (/^(?:你好|您好|hi|hello|hey|你能做什么|你是谁)[！!。？?\s]*$/i.test(text)) return { content: '我是 Avatara。当前处于本机模式，可以帮你检索明确指定的浏览记忆、查看目标进度。连接云端模型后，可以自然聊天、写作，并按需要调用工具。', sources: [], mode: 'local' };
  if (!isGoalQuestion(text) && !isMemoryQuestion(text)) return { content: '当前是本机模式，只提供明确的记忆检索和目标回顾，还不能自由生成回答。\n\n可以说「找一下我看过的 AI 文章」或「看看我的目标」；如需聊天、写作或讨论这个问题，请在设置中连接云端模型。', sources: [], mode: 'local' };
  const state = sanitizeState(rawState);
  if (isGoalQuestion(text)) {
    const goals = selectedGoals(text, state);
    if (!goals.length) return { content: /(?:已完成|完成了哪些|completed)/i.test(text) ? '目前没有已完成的目标记录。你可以在「目标」里查看进行中的目标，每完成一小步就记录一次进度。' : '这里还没有匹配的进行中目标。可以先写下一个具体方向，再把它拆成能记录的小步，例如「本周阅读 5 篇有关 AI 产品的文章」。在「目标」里添加后，我能帮你回顾进度。', sources: [], mode: 'local' };
    const lines = goals.map(goal => `• ${goal.title}：${goal.progress} / ${goal.target} ${goal.unit}${goal.dueDate ? `，计划在 ${goal.dueDate} 前完成` : ''}。${goal.why ? `\n  你的初衷：${goal.why}` : ''}`);
    const next = goals.find(goal => goal.status === 'active');
    const suggestion = next ? `可以先为「${next.title}」留出一小段时间，完成 1 ${next.unit}后记录进度。这里的建议依据你写下的目标，尚未推断实际完成情况。` : '这些目标已经达到你设定的数量。可以回顾一下收获，再决定是否开始下一程。';
    return { content: `选出 ${goals.length} 个与这次问题相关的目标：\n\n${lines.join('\n\n')}\n\n${suggestion}`, sources: [], mode: 'local' };
  }
  if (!state.memories.length) return { content: '这里还没有你的浏览记忆。先在「记忆」中导入历史，或保存一篇正在阅读的页面，再来问我。\n\n只导入历史时，我能检索标题和网址；保存页面正文后，才能提供更具体的内容摘录。', sources: [], mode: 'local' };
  const memories = selectedMemories(text, state);
  if (!memories.length) return { content: `我没有在已保存的标题、标签和正文中找到与「${text.slice(0, 100)}」匹配的记录。\n\n可以换一个主题关键词或网站名称，也可以先保存相关页面。这并不代表你从未浏览过它，只是当前记忆里没有足够证据。`, sources: [], mode: 'local' };
  const broad = queryTokens(text).length === 0 || /(?:总结|回顾|关注|主题|兴趣)/.test(text);
  const insights = buildInsights(memories, state.goals);
  const lead = broad ? `从当前选出的 ${memories.length} 条记录看，${insights.topics.length ? `出现的标签有 ${insights.topics.slice(0, 3).map(topic => topic.name).join('、')}` : `主要来自 ${insights.topDomains.slice(0, 3).map(domain => domain.domain).join('、')}`}。这反映已保存的线索，不能代表全部兴趣。` : `找到 ${memories.length} 条可能相关的记忆：`;
  const lines = memories.map((memory, index) => `${index + 1}. ${memory.title} [${index + 1}]\n${memory.excerpt ? memory.excerpt.slice(0, 180).replace(/\s+/g, ' ') : '这条记录只有标题与网址，还没有保存正文。'}`);
  return { content: `${lead}\n\n${lines.join('\n\n')}\n\n以上是本地检索与原文摘录。你可以打开来源核对，或换一个更具体的关键词继续查找。`, sources: memories.map(sourceOf), mode: 'local' };
}

function aiConfig(state, overrides = {}) {
  const configured = state?.settings?.ai ?? {};
  const baseUrl = normalizeBaseUrl(overrides.baseUrl ?? configured.baseUrl ?? 'https://api.deepseek.com');
  const model = sanitizeText(overrides.model ?? configured.model ?? 'deepseek-v4-flash', 120);
  const apiKey = typeof overrides.apiKey === 'string' ? overrides.apiKey.trim() : '';
  if (!model) throw new Error('请填写模型名称。');
  if (!apiKey) throw new Error('请先填写本次浏览器会话使用的 API 密钥。');
  if (/[\r\n]/.test(apiKey)) throw new Error('API 密钥格式不正确。');
  return { baseUrl, model, apiKey };
}

async function completion(config, messages, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境无法发起网络请求。');
  const controller = new AbortController();
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 60000) : DEFAULT_TIMEOUT;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new CloudError('云端请求超时，请检查网络或稍后重试。')); }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const body = { model: config.model, messages, stream: false, temperature: 0.3, max_tokens: options.maxTokens ?? 1800 };
        if (options.tools) { body.tools = options.tools; body.tool_choice = options.toolChoice ?? 'auto'; }
        if (new URL(config.baseUrl).hostname === 'api.deepseek.com') body.thinking = { type: 'disabled' };
        const response = await fetchImpl(`${config.baseUrl}/v1/chat/completions`, {
          method: 'POST', signal: controller.signal, redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const status = Number(response.status);
          if (status === 401 || status === 403) throw new CloudError('云端验证失败，请检查 API 密钥与模型权限。');
          if (status === 429) throw new CloudError('云端请求额度或频率受限，请稍后重试。');
          throw new CloudError(`云端服务请求失败（HTTP ${Number.isFinite(status) ? status : '未知'}）。`);
        }
        let data;
        try { data = await response.json(); } catch { throw new CloudError('云端返回了无法读取的响应。'); }
        const source = data?.choices?.[0]?.message;
        if (!source || typeof source !== 'object') throw new CloudError('云端没有返回可显示的内容，请检查模型配置。');
        const content = source.content;
        if ((typeof content === 'string' && content.length > MAX_OUTPUT) || data?.choices?.[0]?.finish_reason === 'length') throw new CloudError('云端回复过长或被截断，请缩小问题后重试。');
        const calls = source.tool_calls ?? [];
        if (!Array.isArray(calls) || calls.length > 32) throw new CloudError('云端返回了无效的工具调用格式。');
        if (calls.length && !options.tools) throw new CloudError('云端连接测试返回了非文本响应。');
        if (!calls.length && (typeof content !== 'string' || !content.trim())) throw new CloudError('云端没有返回可显示的内容，请检查模型配置。');
        if (content !== undefined && content !== null && typeof content !== 'string') throw new CloudError('云端返回了无效的文本格式。');
        const assistant = { role: 'assistant', content: typeof content === 'string' ? sanitizeText(content.split(config.apiKey).join('[已隐藏密钥]'), MAX_OUTPUT) : null };
        if (calls.length) {
          const ids = new Set();
          assistant.tool_calls = calls.map(call => {
            if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id.trim() || call.id.length > 200 || ids.has(call.id) || typeof call.function?.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(call.function.name) || typeof call.function.arguments !== 'string' || call.function.arguments.length > 8000) throw new CloudError('云端返回了无效的工具调用格式。');
            ids.add(call.id);
            return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments.split(config.apiKey).join('[已隐藏密钥]') } };
          });
        }
        if (source.reasoning_content !== undefined && source.reasoning_content !== null) {
          if (typeof source.reasoning_content !== 'string' || source.reasoning_content.length > 40000) throw new CloudError('云端返回了无效的推理协议。');
          assistant.reasoning_content = source.reasoning_content.split(config.apiKey).join('[已隐藏密钥]');
        }
        return assistant;
      })(),
      timeout,
    ]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') throw new Error('云端请求超时，请检查网络或稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接云端服务，请检查网络与 API 地址。');
    // Do not forward provider response bodies or arbitrary fetch errors; either may echo secrets.
    if (error instanceof CloudError) throw error;
    throw new Error('云端请求失败，请检查网络与服务配置。');
  } finally { clearTimeout(timer); }
}

export async function answerCloud(value, rawState, options = {}) {
  const text = inputText(value);
  const config = aiConfig(rawState, options);
  return runAgent({
    text, state: rawState, apiKey: config.apiKey, executeTool: options.executeTool,
    onStep: options.onStep, turnTimeoutMs: options.turnTimeoutMs,
    request: (messages, requestOptions) => completion(config, messages, {
      ...options, ...requestOptions,
      timeoutMs: Math.min(Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT, requestOptions.timeoutMs),
    }),
  });
}

export async function testConnection(options = {}) {
  const config = aiConfig(null, options);
  await completion(config, [{ role: 'system', content: 'This is a connection check. Reply briefly with OK.' }, { role: 'user', content: 'Ping. No personal data is included.' }], { ...options, maxTokens: 256 });
  return { message: '连接成功，模型已返回有效响应。', model: config.model };
}
