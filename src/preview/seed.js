import { createInitialState, normalizeMemory } from '../core/model.js';

const DAY = 86_400_000;

export function createDemoState(now = new Date()) {
  const state = createInitialState();
  const timestamp = now.getTime();
  const records = [
    ['human-ai', 'https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/', '让 AI 更懂人：人机交互的 18 条准则', '这条演示记忆记录了一个设计方向：让用户知道助理能做什么、为什么给出建议，以及如何纠正它。真正的个性化应该让人保有选择权。', ['AI 助理', '产品设计'], 0, 5, true],
    ['memory-design', 'https://www.nngroup.com/articles/recognition-and-recall/', '比记住更多更重要的，是在对的时刻想起来', '回忆需要线索。浏览器记忆不只是收藏夹，而应保留当时的问题、阅读上下文与下一步想做的事。设计时优先呈现能够被辨认的标题和来源。', ['记忆检索', '产品设计'], 0, 3, true],
    ['extension-panel', 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel', 'Chrome Side Panel：一个不会打断阅读的助理入口', '侧边栏适合与当前网页并行使用。窄屏保持一件事的专注，完整工作台则承担回顾、检索和规划。', ['浏览器扩展', 'AI 助理'], 1, 4, false],
    ['retrieval', 'https://arxiv.org/abs/2005.11401', 'Retrieval-Augmented Generation：让回答有据可循', '检索增强生成将外部文档作为回答依据。在个人知识助理中，选取少量相关记忆，并给出可追溯引用，通常比一次传入全部历史更有价值。', ['记忆检索', 'AI 助理'], 1, 2, true],
    ['local-first', 'https://www.inkandswitch.com/local-first/', 'Local-first：让数据始终属于使用它的人', '本地优先强调离线可用与数据所有权。浏览记录先留在设备内，需要云端帮助时，再明确说明要发送的上下文。', ['本地优先', '隐私'], 2, 4, true],
    ['permissions', 'https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions', '扩展权限应该在真正需要的时候申请', '历史导入与当前页摘录需要不同的权限。先让用户看到价值，再在具体动作发生时解释并申请权限。默认不持续采集。', ['浏览器扩展', '隐私'], 2, 2, false],
    ['learning', 'https://www.coursera.org/learn/learning-how-to-learn', '学习如何学习：把输入变成可持续的练习', '演示学习笔记：为每次阅读留下一句话总结，再用间隔回顾检查自己能否复述。目标应该是可执行的小动作。', ['学习方法', '阅读'], 3, 3, true],
    ['attention', 'https://www.humanetech.com/', '从争夺注意力，到尊重注意力', '助理不必靠更多提醒证明自己。首页应帮助用户找到今天值得关注的少数事情，也允许轻松地忽略和关闭建议。', ['产品设计', '注意力'], 3, 2, false],
    ['accessibility', 'https://www.w3.org/WAI/ARIA/apg/', '可访问性不是最后的检查清单', '键盘焦点、表单标签、清晰的状态反馈和足够的对比度，决定界面是否真的好用。所有图标按钮都应该能被读懂。', ['产品设计', '可访问性'], 4, 2, false],
    ['indexeddb', 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API', '为浏览器里的长期记忆选择存储方式', '结构化网页摘录可以放在本地数据库。原始资料、用户标注与派生洞察应保持可区分，支持导出与清除。', ['浏览器扩展', '本地优先'], 5, 2, false],
    ['goals', 'https://jamesclear.com/implementation-intentions', '把“多阅读”变成一个具体的行动', '演示行动笔记：给目标写下时间、场景和一个足够小的动作。每次完成后记录进度，回顾目标为什么值得继续。', ['目标管理', '学习方法'], 6, 2, true],
    ['privacy', 'https://www.w3.org/TR/privacy-principles/', '个人助理的信任，始于可理解的数据边界', '收集必要的数据、说明目的、提供控制。对历史和行为的推断应表达不确定性，而不把用户定义为固定的画像。', ['隐私', 'AI 助理'], 7, 1, false],
  ];
  state.profile = { name: 'Alex', focus: '做一个真正懂我的浏览器助理' };
  state.memories = records.map(([id, url, title, excerpt, tags, days, visitCount, saved]) => normalizeMemory({
    id: `demo-${id}`, url, title, excerpt, tags, visitCount, saved,
    visitedAt: new Date(timestamp - days * DAY - 35 * 60_000).toISOString(),
    source: 'manual',
  }));
  state.goals = [
    { id: 'demo-goal-product', title: '把助理的核心体验想清楚', why: '从用户真正想完成的事出发，找到最小而有价值的闭环。', target: 5, progress: 2, unit: '次思考', dueDate: dateAfter(now, 7), status: 'active', createdAt: new Date(timestamp - 5 * DAY).toISOString() },
    { id: 'demo-goal-read', title: '每周精读 5 篇好文章', why: '少一点信息堆积，多一点自己的理解。', target: 5, progress: 3, unit: '篇', dueDate: dateAfter(now, 4), status: 'active', createdAt: new Date(timestamp - 3 * DAY).toISOString() },
    { id: 'demo-goal-recall', title: '完成一次个人记忆回顾', why: '让读过的内容，成为下一步行动的线索。', target: 1, progress: 1, unit: '次', dueDate: dateAfter(now, -1), status: 'completed', createdAt: new Date(timestamp - 8 * DAY).toISOString() },
  ];
  state.messages = [];
  state.activity = [
    { id: 'demo-activity-read', type: 'memory', label: '回顾了关于「记忆检索」的演示资料', createdAt: new Date(timestamp - 45 * 60_000).toISOString() },
    { id: 'demo-activity-goal', type: 'goal', label: '「每周精读 5 篇好文章」完成了第 3 篇', createdAt: new Date(timestamp - 3 * 3_600_000).toISOString() },
  ];
  state.importedAt = new Date(timestamp - 7 * DAY).toISOString();
  return state;
}

export function createImportedMemories(now = new Date()) {
  return [
    ['chrome-history', 'https://developer.chrome.com/docs/extensions/reference/api/history', '从浏览历史中找到值得保留的线索', '演示导入：历史记录可以帮助重新发现读过的资料，但访问次数并不等同于兴趣。用户主动保存的内容应该获得更高的关注。', ['浏览器扩展', '记忆检索']],
    ['progressive', 'https://www.nngroup.com/articles/progressive-disclosure/', '渐进呈现：让复杂能力安静地待在合适的位置', '演示导入：把常用动作放在眼前，把高级选项放进设置。首页先回答“我现在可以做什么”。', ['产品设计', '注意力']],
    ['semantic-html', 'https://developer.mozilla.org/en-US/docs/Glossary/Semantics', '从语义化 HTML 开始，让界面可靠可用', '演示导入：为按钮、导航和输入赋予正确的语义，让屏幕阅读器与键盘用户都能理解页面。', ['可访问性', '产品设计']],
  ].map(([id, url, title, excerpt, tags], index) => normalizeMemory({
    id: `demo-import-${id}`, url, title, excerpt, tags, visitCount: 1, saved: false,
    source: 'history', visitedAt: new Date(now.getTime() - index * DAY).toISOString(),
  }));
}

export function createCapturedMemory(now = new Date()) {
  return normalizeMemory({
    id: 'demo-captured-page', url: 'https://developer.chrome.com/docs/extensions/develop',
    title: '搭建一个以用户为中心的浏览器扩展',
    excerpt: '这是一条模拟当前页面摘录。真实扩展会在你明确点击后读取当前网页；演示沙盒只添加这条合成资料。设计重点：本地记忆、可追溯回答、清楚的权限说明，以及不会打断阅读的侧边栏。',
    domain: 'developer.chrome.com', tags: ['浏览器扩展', '产品设计'],
    visitedAt: now.toISOString(), visitCount: 1, source: 'page', saved: true,
  });
}

function dateAfter(now, days) {
  const date = new Date(now.getTime() + days * DAY);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
