import { createInitialState, createGoal, normalizeMemory, sanitizeState } from '../core/model.js';
import { validateToolArgs } from '../core/agent-tools.js';
import { DEMO_STORAGE_KEY } from './demo.js';

const button = document.getElementById('load-fixture');
const storageNote = document.getElementById('fixture-storage');
const status = document.getElementById('fixture-status');

function updateButton() {
  const existing = localStorage.getItem(DEMO_STORAGE_KEY) !== null;
  button.textContent = existing ? '重置本端口已有演示数据并载入测试夹具' : '载入合成确认测试夹具';
  storageNote.textContent = existing
    ? '此端口已有演示数据。点击重置按钮将替换这些演示记忆、目标、对话与偏好；不影响其他端口或扩展数据。'
    : '此端口没有演示数据。点击载入按钮后才会创建合成测试状态。';
}

function fixtureState() {
  const state = createInitialState();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 30 * 60_000).toISOString();
  state.profile = { name: '合成测试用户', focus: '验证待确认操作的界面与事务' };
  state.memories = [normalizeMemory({
    id: 'qa-memory', url: 'https://example.com/avatara-confirmation-fixture', title: '合成资料：确认卡片组件测试',
    excerpt: '此记录仅用于界面验收。没有读取真实网页，没有调用模型，也没有导入用户历史。',
    source: 'manual', saved: true, visitCount: 1, tags: ['组件测试'], visitedAt: createdAt,
  })];
  const goal = { ...createGoal({ title: '合成目标：阅读测试材料', target: 4, unit: '篇', why: '验证推进目标的确认行为' }), id: 'qa-existing-goal', progress: 1 };
  state.goals = [goal];
  const makeProposal = (id, name, args, title, description) => ({ id, name, args: validateToolArgs(name, args), title, description, status: 'pending', createdAt, expiresAt });
  const create = makeProposal('qa-create', 'create_goal', { title: '合成目标：完成三次设计练习', target: 3, unit: '次', why: '验证创建目标确认卡片' }, '合成卡片：创建目标', '创建「合成目标：完成三次设计练习」，目标为 3 次。只修改本端口的演示数据。');
  const advance = makeProposal('qa-advance', 'advance_goal', { id: goal.id, delta: 1 }, '合成卡片：推进目标', '把「合成目标：阅读测试材料」从 1 / 4 推进到 2 / 4。只修改本端口的演示数据。');
  state.messages = [
    {
      id: 'qa-message-create', role: 'assistant', mode: 'local', createdAt,
      content: '【合成组件测试】这是一张手工构造的创建目标卡片。没有调用云端模型，目标尚未创建。确认后应出现一条新的演示目标；拒绝则保持原样。',
      sources: [],
      steps: [{ id: 'qa-step-create', name: 'create_goal', label: '合成摘要：拟定新目标', status: 'pending', summary: '测试夹具提供的展示数据，未执行模型或浏览器工具。' }],
      actions: [create],
    },
    {
      id: 'qa-message-advance', role: 'assistant', mode: 'local', createdAt,
      content: '【合成组件测试】这是一张手工构造的推进目标卡片。已有合成目标当前为 1 / 4，尚未推进。可以用此卡片验收确认、拒绝与终态展示。',
      sources: [{ id: state.memories[0].id, title: state.memories[0].title, url: state.memories[0].url, excerpt: state.memories[0].excerpt }],
      steps: [{ id: 'qa-step-read', name: 'list_goals', label: '合成摘要：查看目标', status: 'completed', summary: '仅展示预设的 1 个测试目标，未读取真实浏览器数据。' }, { id: 'qa-step-advance', name: 'advance_goal', label: '合成摘要：拟定进度', status: 'pending', summary: '待用户确认，尚未写入演示进度。' }],
      actions: [advance],
    },
  ];
  return sanitizeState(state);
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const save = () => localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(fixtureState()));
    if (navigator.locks?.request) await navigator.locks.request(DEMO_STORAGE_KEY, save);
    else save();
    status.dataset.error = 'false';
    status.textContent = '已载入明确标记的合成夹具：1 条记忆、1 个目标、2 张待确认卡片。请打开对话验收。卡片将在 30 分钟后过期。';
    updateButton();
  } catch {
    status.dataset.error = 'true';
    status.textContent = '测试夹具未能保存，请检查本地存储是否可用。';
  } finally { button.disabled = false; }
});

window.addEventListener('storage', event => { if (event.key === DEMO_STORAGE_KEY) updateButton(); });
try { updateButton(); }
catch { button.disabled = true; status.dataset.error = 'true'; status.textContent = '此页面的本地存储不可用，尚未写入任何数据。'; }
