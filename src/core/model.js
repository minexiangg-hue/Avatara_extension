const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const SOURCES = new Set(['history', 'page', 'manual']);
const SECRET_PARAM = /(?:^|[_-])(?:access|refresh|auth|authorization|token|secret|password|passwd|pwd|key|apikey|api_key|session|sessionid|sid|jwt|code|credential|signature|sig|ticket|email)(?:$|[_-])/i;
const TRACKING_PARAM = /^(?:utm_.+|fbclid|gclid|msclkid)$/i;
const TOPIC_CUES = [
  ['浏览器扩展', /浏览器(?:扩展|插件)|(?:chrome|firefox|browser)\s+extensions?\b|\bchrome\.(?:storage|tabs|runtime|history)\b|\bmanifest\s+v3\b|\bchrome\s+side\s*panel\b/i],
  ['机器学习', /机器学习|深度学习|神经网络|\b(?:machine\s+learning|deep\s+learning|neural\s+networks?)\b/i],
  ['AI 助理', /(?:AI|人工智能|智能)\s*(?:助理|助手)|\b(?:AI\s+(?:assistants?|agents?)|agentic\s+AI)\b/i],
  ['大语言模型', /大语言模型|大型语言模型|大模型|\b(?:large\s+language\s+models?|LLMs?)\b/i],
  ['记忆检索', /检索增强|向量检索|语义搜索|信息检索|\b(?:retrieval[-\s]augmented\s+generation|vector\s+search|semantic\s+search|RAG)\b/i],
  ['产品设计', /产品设计|用户体验|交互设计|用户研究|\b(?:product\s+design|user\s+experience|user\s+research|UX\s+design|UI\s+design|usability)\b/i],
  ['前端开发', /前端(?:开发|框架|工程)?|\b(?:JavaScript|TypeScript|HTML|CSS|React\.js|ReactJS|Vue\.js)\b|\bReact\s+(?:hooks?|components?|state|框架|组件)\b/i],
  ['数据存储', /数据库|本地存储|浏览器存储|\b(?:IndexedDB|SQLite|PostgreSQL|MySQL|SQL|storage\s+API|database)\b/i],
  ['本地优先', /本地优先|离线优先|\b(?:local[-\s]first|offline[-\s]first)\b/i],
  ['隐私', /隐私|数据保护|\b(?:privacy|data\s+protection)\b/i],
  ['可访问性', /可访问性|无障碍|\b(?:accessibility|screen\s+readers?|WAI[-\s]ARIA)\b/i],
  ['学习方法', /学习方法|学习如何学习|间隔重复|费曼学习法|\b(?:spaced\s+repetition|learning\s+how\s+to\s+learn|study\s+methods?)\b/i],
  ['目标管理', /目标管理|目标设定|习惯养成|\b(?:goal\s+(?:setting|tracking)|habit\s+formation)\b/i],
  ['学术研究', /学术研究|科研论文|研究论文|\b(?:research\s+papers?|scientific\s+research)\b/i],
];

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function finiteInt(value, fallback, minimum = 0, maximum = 1000000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}
function timestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}
function id(prefix, value = '') {
  if (value) {
    let hash = 2166136261;
    for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    return `${prefix}_${(hash >>> 0).toString(36)}`;
  }
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}

/** Deliberately retain only ordinary web URLs, with credentials and tracking removed. */
export function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(name) || TRACKING_PARAM.test(name) || /(?:token|secret|password|session|apikey|api[-_]?key|authorization|credential)/i.test(name)) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return ''; }
}

/** Redact common credential forms before text enters durable state or an AI prompt. */
export function sanitizeText(value, maxLength = 12000) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    // Treat prose/Markdown punctuation as boundaries, not URL path characters.
    // Percent-encoded delimiters remain inside URLs; IPv6 authority brackets do too.
    .replace(/https?:\/\/(?:\[[\da-f.]*:[\da-f:.]*\]|[^\s<>"'`()\[\]{}（）。，！？；：、【】《》“”‘’「」『』])+/gi, match => {
      const punctuation = match.match(/[.,!?;:]+$/)?.[0] || '';
      const url = punctuation ? match.slice(0, -punctuation.length) : match;
      return `${normalizeUrl(url) || '[已移除链接]'}${punctuation}`;
    })
    .replace(/\b(?:sk|pk|rk)[-_][a-z0-9_-]{12,}\b/gi, '[已隐藏密钥]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret|authorization)\s*[:=]\s*["']?[^\s,;"']+["']?/gi, '[已隐藏凭据]')
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[已隐藏凭据]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim().slice(0, maxLength);
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请输入 API 服务地址。');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('API 地址格式不正确。'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('云端 API 必须使用 HTTPS；本机服务可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含凭据、查询参数或锚点。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function createInitialState() {
  return {
    schemaVersion: 1,
    profile: { name: '', focus: '' },
    settings: {
      captureEnabled: false, retentionDays: 90, excludedDomains: [],
      ai: { enabled: false, baseUrl: DEFAULT_BASE_URL, model: 'deepseek-v4-flash', hasKey: false },
    },
    memories: [], goals: [], messages: [], activity: [], importedAt: null,
  };
}

/** Local keyword clusters describe saved content, never inferred user traits. */
export function deriveTags(value) {
  const input = object(value);
  const withoutLinks = text => sanitizeText(text, 12000).normalize('NFKC').replace(/https?:\/\/\S+/gi, ' ');
  const title = withoutLinks(input.title).slice(0, 240);
  const excerpt = withoutLinks(input.excerpt);
  return TOPIC_CUES.map(([name, cue], order) => ({
    name, order, score: (cue.test(title) ? 2 : 0) + (cue.test(excerpt) ? 1 : 0),
  })).filter(topic => topic.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 4).map(topic => topic.name);
}

export function normalizeMemory(value) {
  const input = object(value);
  const url = normalizeUrl(input.url);
  if (!url) return null;
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const suppliedTitle = sanitizeText(input.title, 240);
  const title = suppliedTitle || domain;
  const excerpt = sanitizeText(input.excerpt, 12000);
  const suppliedTags = [...new Set(array(input.tags).map(tag => sanitizeText(tag, 40)).filter(Boolean))].slice(0, 12);
  return {
    id: sanitizeText(input.id, 120) || id('memory', url),
    url, title, excerpt, domain,
    visitedAt: timestamp(input.visitedAt ?? input.lastVisitTime),
    visitCount: finiteInt(input.visitCount, 1, 1),
    tags: suppliedTags.length ? suppliedTags : deriveTags({ title: suppliedTitle === domain ? '' : suppliedTitle, excerpt }),
    source: SOURCES.has(input.source) ? input.source : 'history', saved: input.saved === true,
  };
}

export function mergeMemories(existing, incoming) {
  const memories = new Map();
  for (const raw of [...array(existing), ...array(incoming)]) {
    const memory = normalizeMemory(raw);
    if (!memory) continue;
    const previous = memories.get(memory.url);
    if (!previous) { memories.set(memory.url, memory); continue; }
    const betterExcerpt = memory.excerpt.length > previous.excerpt.length;
    const newer = memory.visitedAt > previous.visitedAt;
    memories.set(memory.url, {
      ...previous,
      title: memory.title !== memory.domain && (newer || previous.title === previous.domain) ? memory.title : previous.title,
      excerpt: betterExcerpt ? memory.excerpt : previous.excerpt,
      visitedAt: newer ? memory.visitedAt : previous.visitedAt,
      visitCount: Math.max(previous.visitCount, memory.visitCount),
      tags: [...new Set([...previous.tags, ...memory.tags])].slice(0, 12),
      source: betterExcerpt ? memory.source : previous.source,
      saved: previous.saved || memory.saved,
    });
  }
  return [...memories.values()].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt) || a.id.localeCompare(b.id));
}

export function createGoal(value) {
  const input = object(value);
  const title = sanitizeText(input.title, 160);
  if (!title) throw new Error('请给目标起一个名字。');
  return {
    id: id('goal'), title, why: sanitizeText(input.why, 600),
    target: finiteInt(input.target ?? 5, 5, 1, 100000), progress: 0,
    unit: sanitizeText(input.unit, 20) || '次',
    dueDate: validDateOnly(input.dueDate), status: 'active', createdAt: new Date().toISOString(),
  };
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value) ? value : '';
}

function normalizeGoal(value) {
  const input = object(value);
  if (!sanitizeText(input.title, 160)) return null;
  const goal = createGoal(input);
  goal.id = sanitizeText(input.id, 120) || goal.id;
  goal.createdAt = timestamp(input.createdAt);
  goal.progress = finiteInt(input.progress, 0, 0, goal.target);
  goal.status = goal.progress >= goal.target ? 'completed' : 'active';
  return goal;
}

export function advanceGoal(value, delta = 1) {
  const goal = normalizeGoal(value);
  if (!goal) throw new Error('目标不存在。');
  const amount = Number(delta);
  if (!Number.isFinite(amount)) throw new Error('进度必须是有效数字。');
  goal.progress = Math.min(goal.target, Math.max(0, goal.progress + Math.trunc(amount)));
  goal.status = goal.progress >= goal.target ? 'completed' : 'active';
  return goal;
}

function normalizeSource(value) {
  const source = object(value);
  const url = normalizeUrl(source.url);
  if (!url) return null;
  return { id: sanitizeText(source.id, 120) || id('memory', url), title: sanitizeText(source.title, 240) || new URL(url).hostname, url, excerpt: sanitizeText(source.excerpt, 1200) };
}

const AGENT_NAMES = new Set(['search_memories', 'read_memory', 'list_goals', 'get_profile', 'get_activity_summary', 'read_current_page', 'list_tabs', 'create_goal', 'advance_goal', 'unknown_tool']);
const ACTION_STATUSES = new Set(['pending', 'approved', 'rejected', 'expired', 'failed']);

/** Public progress contains short summaries only, never raw tool payloads. */
export function normalizeAgentStep(value) {
  const step = object(value);
  if (!AGENT_NAMES.has(step.name) || !['completed', 'error', 'pending'].includes(step.status)) return null;
  if (step.name === 'unknown_tool' && step.status !== 'error') return null;
  const stepId = sanitizeText(step.id, 120);
  if (!stepId) return null;
  return { id: stepId, name: step.name, label: sanitizeText(step.label, 80), status: step.status, summary: sanitizeText(step.summary, 400) };
}

// This is a deliberately independent whitelist: agent-tools imports the model.
// Invalid argument fields must not be silently removed to create an executable action.
function actionArgs(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const keys = Object.keys(value);
  const text = (key, max, required = false) => {
    if (!(key in value)) return required ? null : undefined;
    if (typeof value[key] !== 'string' || value[key].length > max || (required && !value[key].trim())) return null;
    return sanitizeText(value[key], max);
  };
  if (name === 'create_goal') {
    if (keys.some(key => !['title', 'target', 'unit', 'why', 'dueDate'].includes(key))) return null;
    const title = text('title', 160, true);
    const unit = text('unit', 20), why = text('why', 600), dueDate = text('dueDate', 10);
    if (!title || [unit, why, dueDate].includes(null) || !Number.isInteger(value.target) || value.target < 1 || value.target > 100000) return null;
    if (unit !== undefined && !unit) return null;
    if (dueDate !== undefined && !validDateOnly(dueDate)) return null;
    return { title, target: value.target, ...(unit === undefined ? {} : { unit }), ...(why === undefined ? {} : { why }), ...(dueDate === undefined ? {} : { dueDate }) };
  }
  if (name === 'advance_goal') {
    if (keys.some(key => !['id', 'delta'].includes(key))) return null;
    const goalId = text('id', 120, true);
    if (!goalId || !Number.isInteger(value.delta) || value.delta < 1 || value.delta > 100000) return null;
    return { id: goalId, delta: value.delta };
  }
  return null;
}

export function normalizeAgentAction(value) {
  const action = object(value);
  if (!['create_goal', 'advance_goal'].includes(action.name)) return null;
  const actionId = sanitizeText(action.id, 120);
  if (!actionId) return null;
  const args = actionArgs(action.name, action.args);
  const createdAt = timestamp(action.createdAt, null), expiresAt = timestamp(action.expiresAt, null);
  const lifetime = Date.parse(expiresAt) - Date.parse(createdAt);
  const valid = args && createdAt && expiresAt && lifetime > 0 && lifetime <= 30 * 60000 && ACTION_STATUSES.has(action.status);
  return {
    id: actionId, name: action.name, args: args || {},
    title: sanitizeText(action.title, 180) || (action.name === 'create_goal' ? '创建目标' : '记录目标进展'),
    description: valid ? sanitizeText(action.description, 600) : '操作参数无效，未执行。请重新提出请求。',
    status: valid ? action.status : 'failed',
    createdAt: createdAt || '1970-01-01T00:00:00.000Z', expiresAt: expiresAt || '1970-01-01T00:00:00.000Z',
  };
}

function distinctAgentItems(values, normalizer, limit) {
  const seen = new Set();
  return array(values).slice(0, limit).map(normalizer).filter(item => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function sanitizeState(value) {
  const input = object(value);
  const result = createInitialState();
  const profile = object(input.profile);
  result.profile = { name: sanitizeText(profile.name, 80), focus: sanitizeText(profile.focus, 600) };
  const settings = object(input.settings);
  const ai = object(settings.ai);
  let baseUrl = DEFAULT_BASE_URL;
  try { baseUrl = normalizeBaseUrl(ai.baseUrl ?? DEFAULT_BASE_URL); } catch { /* Invalid stored settings recover to the safe default. */ }
  result.settings = {
    captureEnabled: settings.captureEnabled === true,
    retentionDays: finiteInt(settings.retentionDays ?? 90, 90, 1, 3650),
    excludedDomains: [...new Set(array(settings.excludedDomains).map(value => {
      const domain = sanitizeText(value, 253).toLowerCase().replace(/^www\./, '').replace(/^\*\./, '').replace(/\.$/, '');
      return /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(domain) ? domain : '';
    }).filter(Boolean))].slice(0, 200),
    ai: { enabled: ai.enabled === true, baseUrl, model: sanitizeText(ai.model, 120) || 'deepseek-v4-flash', hasKey: ai.hasKey === true },
  };
  result.memories = mergeMemories([], input.memories);
  result.goals = array(input.goals).map(normalizeGoal).filter(Boolean);
  result.messages = array(input.messages).filter(message => message && ['user', 'assistant'].includes(message.role)).map(message => ({
    id: sanitizeText(message.id, 120) || id('message'), role: message.role,
    content: sanitizeText(message.content, 16000), createdAt: timestamp(message.createdAt),
    sources: array(message.sources).map(normalizeSource).filter(Boolean).slice(0, 6),
    steps: message.role === 'assistant' ? distinctAgentItems(message.steps, normalizeAgentStep, 24) : [],
    actions: message.role === 'assistant' ? distinctAgentItems(message.actions, normalizeAgentAction, 8) : [],
    mode: message.mode === 'cloud' ? 'cloud' : 'local',
  })).filter(message => message.content || message.actions.length).slice(-100);
  result.activity = array(input.activity).filter(item => item && typeof item === 'object').map(item => ({
    id: sanitizeText(item.id, 120) || id('activity'), type: sanitizeText(item.type, 40),
    label: sanitizeText(item.label, 240), createdAt: timestamp(item.createdAt),
  })).slice(-100);
  result.importedAt = input.importedAt ? timestamp(input.importedAt, null) : null;
  return result;
}
