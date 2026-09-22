import { icon, brandMark } from './icons.js';
import { buildInsights, searchMemories } from '../core/search.js';
import { toolTraceView, actionCardsView } from './agent-view.js';

const isExtension = location.protocol === 'chrome-extension:' && Boolean(globalThis.chrome?.runtime?.id);
let state;
let route = ['today', 'memory', 'goals', 'chat', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let query = '';
let memoryFilter = 'all';
let memoryLimit = 30;
let busy = false;
let chatPending = false;
let chatDraft = '';
let pendingText = '';
let pendingSteps = [];
let chatRequestId = '';
let composingSearch = false;
let settingsDirty = false;
let refreshPending = false;
let refreshRunning = false;
let toastTimer;
let returnFocus;
let demoRequest;
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const e = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };
const shortDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleDateString('zh-CN', {month:'short',day:'numeric'}); };
const pct = goal => Math.min(100, Math.max(0, Math.round((Number(goal.progress) || 0) / Math.max(1, Number(goal.target) || 1) * 100)));
const welcome = () => { const h = new Date().getHours(); return h < 11 ? '早上好' : h < 14 ? '中午好' : h < 19 ? '下午好' : '晚上好'; };
const navItems = [['today','today','今日'],['memory','memory','记忆'],['goals','goals','目标'],['chat','chat','对话']];

async function request(type, payload = {}) {
  if (!isExtension) {
    if (!demoRequest) ({ demoRequest } = await import('../preview/demo.js'));
    return demoRequest(type, payload);
  }
  const response = await chrome.runtime.sendMessage({type, payload});
  if (!response?.ok) throw new Error(response?.error || '暂时无法连接 Avatara，请重新加载扩展。');
  return response.data;
}

function toast(message, error = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 4500);
}

async function mutate(type, payload, success) {
  if (busy) return false;
  busy = true;
  document.body.classList.add('is-busy');
  try {
    state = await request(type, payload);
    render();
    if (success) toast(success);
    return true;
  } catch (err) { toast(err.message || '操作未完成，请再试一次。', true); return false; }
  finally { busy = false; document.body.classList.remove('is-busy'); if(refreshPending)void refreshState(); }
}

function navigate(next) {
  if(route==='settings'&&next!=='settings')settingsDirty=false;
  route = next;
  history.replaceState(null, '', `#${next}`);
  render();
  document.querySelector('.main-scroll')?.scrollTo(0, 0);
  if(refreshPending)void refreshState();
}

async function refreshState() {
  if(!state)return;
  if(busy||chatPending||refreshRunning||modalRoot.firstChild||composingSearch||(route==='settings'&&settingsDirty)){refreshPending=true;return;}
  refreshPending=false;
  refreshRunning=true;
  const before=JSON.stringify(state);
  try {
    const latest=await request('state.get');
    if(busy||chatPending||modalRoot.firstChild||(route==='settings'&&settingsDirty)){refreshPending=true;return;}
    if(before!==JSON.stringify(state)){refreshPending=true;return;}
    if(before!==JSON.stringify(latest)) {
      const searchFocused=document.activeElement?.id==='memory-search';
      const position=searchFocused?document.activeElement.selectionStart:0;
      state=latest;render();
      if(searchFocused){const input=document.getElementById('memory-search');input?.focus();input?.setSelectionRange(position,position);}
    }
  } catch { /* Keep the last readable state; explicit user actions surface service errors. */ }
  finally { refreshRunning=false; }
}

function render() {
  const counts = buildInsights(state.memories, state.goals);
  app.innerHTML = `<div class="workspace">
    <aside class="sidebar">
      <a class="brand" href="#today" data-nav="today"><span class="brand-mark">${brandMark}</span><span>avatara<span class="brand-period">.</span></span></a>
      <div class="sidebar-kicker">YOUR PERSONAL COMPANION</div>
      <nav aria-label="主导航">${navItems.map(([id, glyph, label]) => `<button class="nav-item ${route === id ? 'active' : ''}" data-nav="${id}" ${route===id?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span>${id==='memory'?`<span class="nav-count">${state.memories.length}</span>`:''}${id==='chat'?'<span class="nav-star">✧</span>':''}</button>`).join('')}</nav>
      <div class="sidebar-note"><span class="little-sun">${icon(sparkName(),24)}</span><p>每一次探索，<br>都不必从头开始。</p><div class="tiny-line"></div><span>LESS NOISE. MORE YOU.</span></div>
      <div class="sidebar-bottom"><div class="local-state"><span class="status-dot"></span>${state.settings.ai.enabled ? '云端 Agent 已开启' : '记忆保存在本机'}${icon(state.settings.ai.enabled?'cloud':'lock',13)}</div><button class="nav-item ${route==='settings'?'active':''}" data-nav="settings">${icon('settings')}<span>偏好设置</span></button><button class="profile" data-action="edit-profile"><span class="avatar">${e((state.profile.name || '我').slice(0,1).toUpperCase())}</span><span><strong>${e(state.profile.name || '我的空间')}</strong><small>留一点空间，给自己</small></span>${icon('more',18)}</button></div>
    </aside>
    <section class="main-shell">
      <header class="topbar"><div class="breadcrumb"><span class="mobile-brand">${brandMark}</span><span>我的空间</span><span class="slash">/</span><strong>${e(navItems.find(x=>x[0]===route)?.[2] || '偏好设置')}</strong></div><div class="topbar-actions">${!isExtension?'<span class="demo-badge">独立演示 · 示例数据</span>':`<span class="subtle-label">${icon('lock',13)} 私人空间</span>`}<button class="button button-small button-outline" data-action="capture">${icon('plus',16)}<span>记住这一页</span></button></div></header>
      <main class="main-scroll" id="main-content"><div class="page page-${route}">${route==='today'?todayView(counts):route==='memory'?memoryView():route==='goals'?goalsView():route==='chat'?chatView():settingsView()}</div><footer class="page-footer"><span>AVATARA</span><span>留住思路，继续向前。</span><span>0.3 / AGENT</span></footer></main>
      <nav class="mobile-nav" aria-label="移动导航">${navItems.map(([id,glyph,label])=>`<button data-nav="${id}" class="${route===id?'active':''}" aria-label="${label}">${icon(glyph,19)}<span>${label}</span></button>`).join('')}<button data-nav="settings" aria-label="设置" class="${route==='settings'?'active':''}">${icon('settings',19)}<span>设置</span></button></nav>
    </section>
  </div>`;
  if (route === 'chat') {
    document.querySelectorAll('.message-text[data-message-id]').forEach(el => {
      el.textContent = state.messages.find(m => m.id === el.dataset.messageId)?.content || '';
    });
    const composer = document.querySelector('#chat-form textarea');
    if (composer) composer.value = chatDraft;
    const historyEl = document.getElementById('chat-history');
    if (chatPending && pendingText && historyEl) {
      const question = document.createElement('div');
      question.className = 'pending-question';
      question.textContent = pendingText;
      historyEl.querySelector('.agent-pending')?.before(question);
    }
    historyEl?.scrollTo(0, 100000);
  }
}

function sparkName() { return 'sun'; }

function todayView(insights) {
  const date = new Date();
  const recent = [...state.memories].sort((a,b)=>new Date(b.visitedAt)-new Date(a.visitedAt)).slice(0,4);
  const goals = state.goals.filter(g=>g.status!=='completed').slice(0,2);
  const topics = insights.topics.slice(0,4);
  return `<div class="greeting"><div><div class="eyebrow">${date.toLocaleDateString('en-US',{month:'long',day:'2-digit',year:'numeric'}).toUpperCase()} <span>·</span> ${date.toLocaleDateString('zh-CN',{weekday:'long'})}</div><h1>${welcome()}${state.profile.name?`，${e(state.profile.name)}`:''}<span class="greeting-dot">。</span></h1><p>思路有迹可循，今天也可以从容一点。</p></div><div class="day-emblem" aria-hidden="true">${icon('sun',42)}</div></div>
  <section class="focus-card"><div class="focus-copy"><span class="label-dot">此刻，聚焦自己</span><h2>把注意力，<br>留给重要的事<span>。</span></h2><p>${e(state.profile.focus || '找回那些让你停留的想法，接着往前走。')}</p><button class="focus-link" data-nav="chat">从一个想法开始 ${icon('arrow',19)}</button></div><div class="orbit-art" aria-hidden="true"><div class="orbit-ring ring-one"></div><div class="orbit-ring ring-two"></div><div class="orbit-ring ring-three"></div><div class="orbit-ring ring-four"></div><div class="orbit-core">${brandMark}</div><i class="orbit-dot dot-one"></i><i class="orbit-dot dot-two"></i><i class="orbit-dot dot-three"></i><div class="orbit-label label-one">记忆</div><div class="orbit-label label-two">当下</div><div class="orbit-label label-three">方向</div><span class="orbit-caption">CONNECTED, NOT SCATTERED.</span></div></section>
  <form class="quick-ask" id="quick-ask"><span class="ask-symbol">${icon('spark',23)}</span><input name="text" aria-label="问问 Avatara" placeholder="找回一篇文章，或聊聊下一步…" autocomplete="off" maxlength="4000" required><button type="submit" class="send-button" aria-label="发送">${icon('arrow',20)}</button></form>
  <div class="today-grid"><section class="recent-section"><div class="section-heading"><div><span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>最近的思路</h2></div><button class="text-button" data-nav="memory">全部记忆 ${icon('arrow',16)}</button></div><div class="recent-list">${recent.length?recent.map((m,i)=>memoryRow(m,i)).join(''):emptyState('memory','还没有留下记忆','从当前页面开始，或者导入一段浏览历史。','导入浏览历史','import-dialog')}</div>${recent.length?`<div class="trail-footer"><span class="trail-dot"></span>${state.memories.length} 条记忆，组成你自己的知识轨迹</div>`:''}</section>
  <aside class="today-aside"><section class="intent-card"><div class="section-heading"><h2>${icon('goals',18)} 正在靠近</h2><button class="icon-button" data-action="new-goal" aria-label="新建目标">${icon('plus',18)}</button></div>${goals.length?goals.map(g=>smallGoal(g)).join(''):`<p class="muted small-text">把一个模糊的愿望，变成可以迈出的一小步。</p><button class="text-button" data-action="new-goal">写下第一个目标 ${icon('arrow',16)}</button>`}<button class="text-button goal-all" data-nav="goals">看看我的目标 ${icon('arrow',16)}</button></section><section class="insight-note"><div class="eyebrow">A LITTLE REFLECTION ${icon('leaf',17)}</div><h3>${state.memories.length?'你的好奇心，有自己的方向。':'你的好奇心，值得被记住。'}</h3><p>${topics.length?'最近的记忆里，这些主题常常出现。也许可以把它们连成一条线。':'随着记忆积累，这里会呈现你反复关注的主题。'}</p><div class="topic-pills">${topics.map(t=>`<button data-action="topic" data-topic="${e(t.name)}">${e(t.name)}</button>`).join('')}</div>${state.memories.length?`<div class="insight-bottom">基于 ${state.memories.length} 条本机记忆 ${icon('arrow',15)}</div>`:''}</section></aside></div>`;
}

function memoryRow(m,i=0,full=false) {
  return `<article class="memory-row ${full?'memory-row-full':''}"><div class="site-mark tone-${i%4}">${e((m.domain||'A').replace(/^www\./,'').slice(0,1).toUpperCase())}</div><div class="memory-copy"><div class="memory-meta"><span>${e(m.domain || '已保存页面')}</span><span class="meta-dot">·</span><time>${shortDate(m.visitedAt)}</time>${m.source==='manual'||m.source==='page'?'<span class="source-tag">页面记忆</span>':''}</div><a class="memory-title" href="${e(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">${e(m.title || m.domain)}${icon('external',13)}</a>${full?`<p class="memory-excerpt">${e(m.excerpt || '这条历史记录只保留标题和链接。打开页面后，可以主动保存正文。')}</p>`:''}<div class="memory-tags">${(m.tags||[]).slice(0,3).map(t=>`<span>${e(t)}</span>`).join('')}${!m.tags?.length?'<span>等待新的联想</span>':''}</div></div><button class="icon-button save-button ${m.saved?'is-saved':''}" data-action="save-memory" data-id="${e(m.id)}" aria-label="${m.saved?'取消收藏':'收藏'}：${e(m.title)}" aria-pressed="${Boolean(m.saved)}">${icon('bookmark',18)}</button></article>`;
}

function smallGoal(g) {
  return `<div class="small-goal"><div class="small-goal-title"><span>${e(g.title)}</span><span>${pct(g)}<small>%</small></span></div><div class="progress-track"><span style="width:${pct(g)}%"></span></div><div class="small-goal-meta"><span>${Number(g.progress)||0} / ${Number(g.target)||1} ${e(g.unit)}</span><button class="text-button" data-action="advance-goal" data-id="${e(g.id)}" aria-label="为 ${e(g.title)} 记录一步">${icon('plus',12)} 记录一步</button></div></div>`;
}

function emptyState(glyph,title,body,label,action) { return `<div class="empty-state"><div class="empty-icon">${icon(glyph,30)}</div><h3>${e(title)}</h3><p>${e(body)}</p>${label?`<button class="button button-primary" data-action="${action}">${icon('plus',16)}${e(label)}</button>`:''}</div>`; }

function pageHeading(kicker,title,description,button='') { return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${button}</div>`; }

function memoryView() {
  const filtered = searchMemories(state.memories, query, {filter:memoryFilter}).filter(m=>memoryFilter!=='saved'||m.saved);
  return `${pageHeading('YOUR PERSONAL ARCHIVE','记忆有迹可循<span class="greeting-dot">。</span>','看过的、想过的、值得再回来的，都在这里。',`<button class="button button-primary" data-action="import-dialog">${icon('download',17)}导入历史</button>`)}<div class="memory-toolbar"><div class="segmented" role="group" aria-label="记忆筛选"><button data-filter="all" class="${memoryFilter==='all'?'active':''}" aria-pressed="${memoryFilter==='all'}">全部 <span>${state.memories.length}</span></button><button data-filter="saved" class="${memoryFilter==='saved'?'active':''}" aria-pressed="${memoryFilter==='saved'}">${icon('bookmark',14)}已收藏 <span>${state.memories.filter(m=>m.saved).length}</span></button></div><label class="search-field">${icon('search',18)}<input id="memory-search" aria-label="搜索记忆" placeholder="用关键词找回一段思路…" value="${e(query)}" maxlength="500">${query?'<button class="icon-button" data-action="clear-search" aria-label="清除搜索">'+icon('close',15)+'</button>':''}</label></div><div class="results-caption"><span>${query?`与「${e(query)}」相关的记忆`:'按最近访问排序'}</span><span>${filtered.length} 条</span></div><section class="memory-archive" id="memory-results">${filtered.length?filtered.slice(0,memoryLimit).map((m,i)=>memoryRow(m,i,true)).join(''):emptyState('search',query?'暂时没有找到':'这里还很安静',query?'换一个更短的关键词，或者试试页面标题中的词。':'记住一页有用的内容，让下一次探索更轻松。',query?'清除搜索':'导入浏览历史',query?'clear-search':'import-dialog')}</section>${filtered.length>memoryLimit?`<div class="load-more"><button class="button button-outline" data-action="more-memories">再看 30 条记忆 ${icon('arrow',15)}</button><span>已展示 ${Math.min(memoryLimit,filtered.length)} / ${filtered.length} 条</span></div>`:''}<div class="privacy-footnote">${icon('lock',14)}本机检索不会把你的记忆发送到云端。</div>`;
}

function goalsView() {
  const active = state.goals.filter(g=>g.status!=='completed');
  const completed = state.goals.filter(g=>g.status==='completed');
  return `${pageHeading('SMALL STEPS, YOUR DIRECTION','离想成为的自己，再近一点<span class="greeting-dot">。</span>','目标不必宏大。重要的是，知道今天可以做什么。',`<button class="button button-primary" data-action="new-goal">${icon('plus',17)}写下目标</button>`)}<div class="goals-summary"><span><b>${active.length}</b> 个进行中</span><span><b>${completed.length}</b> 个已抵达</span><span class="goals-mantra">持续，比完美更重要。</span></div><div class="goal-grid">${state.goals.length?state.goals.map((g,i)=>`<article class="goal-card ${g.status==='completed'?'goal-complete':''}"><div class="goal-card-top"><span class="goal-index">${String(i+1).padStart(2,'0')}</span><span class="tag ${g.status==='completed'?'tag-green':''}">${g.status==='completed'?'已完成':'慢慢向前'}</span><button class="icon-button" data-action="delete-goal" data-id="${e(g.id)}" aria-label="删除目标：${e(g.title)}">${icon('trash',16)}</button></div><h2>${e(g.title)}</h2><p>${e(g.why || '为自己留下一点向前的动力。')}</p><div class="goal-progress-value">${pct(g)}<span>%</span></div><div class="progress-track"><span style="width:${pct(g)}%"></span></div><div class="goal-progress-label"><span>${Number(g.progress)||0} / ${Number(g.target)||1} ${e(g.unit)}</span><span>${g.dueDate?'希望在 '+shortDate(g.dueDate)+' 前':'按照自己的节奏'}</span></div><button class="button ${g.status==='completed'?'button-outline':'button-soft'} goal-step" data-action="advance-goal" data-id="${e(g.id)}" ${g.status==='completed'?'disabled':''}>${icon(g.status==='completed'?'check':'plus',16)}${g.status==='completed'?'这一程，你做到了':'记录一次进展'}</button></article>`).join(''):emptyState('goals','先定一个小方向','可以是每周读三篇文章，也可以是完成一个一直想做的项目。','写下第一个目标','new-goal')}<button class="new-goal-card" data-action="new-goal"><span>${icon('plus',25)}</span><strong>给新的可能，留个位置</strong><small>写下一个目标</small></button></div>`;
}

function chatView() {
  const cloud = isExtension && state.settings.ai.enabled;
  const ready = cloud && state.settings.ai.hasKey;
  const subtitle = ready ? '云端 Agent · 按需调用工具，读取结果，再继续处理' : cloud ? '会话密钥已失效 · 重新连接模型后可使用 Agent' : '本机基础模式 · 支持明确的记忆检索与目标回顾，尚未连接大模型';
  const starters = ready
    ? [['一起思考','帮我想三个让学习更有趣的方法','spark'],['连接线索','找出我读过的 AI 助理资料，再结合当前目标给我一个建议','memory'],['付诸行动','帮我创建一个目标：本周读完 3 篇文章','goals']]
    : [['找回阅读','帮我找关于 AI 助理的内容','memory'],['回顾关注','我最近在关注什么？','leaf'],['查看目标','我的目标下一步可以做什么？','goals']];
  const notice = ready ? '' : `<div class="agent-mode-notice">${icon('cloud',17)}<div><strong>${!isExtension ? '当前是独立演示，不会连接模型' : cloud ? '需要重新输入本次会话的密钥' : '想让它理解意图、自己调用工具？'}</strong><p>${!isExtension ? '这里可体验界面与本机基础功能。真正的 Agent 请在已安装扩展中连接云端模型。' : '在偏好设置连接支持工具调用的模型。普通讨论、按需检索和多步处理都由模型决策。'}</p></div><button class="text-button" data-nav="settings">${cloud ? '重新连接' : '连接模型'}${icon('arrow',14)}</button></div>`;
  return `${pageHeading('THINK. CONNECT. ACT.','有些想法，聊着就清楚了<span class="greeting-dot">。</span>',subtitle,`<button class="button button-small button-outline" data-action="clear-chat" ${!state.messages.length || chatPending ? 'disabled' : ''}>${icon('plus',16)}新对话</button>`)}<div class="chat-layout"><div class="conversation">${notice}<div id="chat-history" class="chat-history" aria-live="polite">${state.messages.length ? state.messages.map(messageView).join('') : `<div class="chat-welcome"><span class="chat-avatar">${brandMark}</span><h2>不只是找回，也一起向前。</h2><p>${ready ? '告诉我你想做什么。需要时，我会自己查找线索，<br>连接你的目标，并把可执行的下一步交给你。' : '先找回一段记忆，或回顾一个目标。<br>连接云端模型后，我们还能一起思考和行动。'}</p><div class="starter-grid">${starters.map(([label,prompt,glyph])=>`<button data-action="prompt" data-prompt="${e(prompt)}">${icon(glyph,18)}<span>${label}<small>${e(prompt)}</small></span>${icon('arrow',16)}</button>`).join('')}</div></div>`}${chatPending ? `<div class="agent-pending"><div id="agent-live-steps">${toolTraceView(pendingSteps,{live:true})}</div><div class="thinking"><span></span><span></span><span></span><span class="thinking-text">${pendingSteps.length ? '正在根据工具结果继续处理…' : ready ? '正在理解你的请求…' : '正在处理…'}</span></div></div>` : ''}</div><form id="chat-form" class="chat-composer"><textarea name="text" aria-label="发送消息" placeholder="说说你的想法，或直接告诉我想做什么…" rows="2" maxlength="4000" required ${chatPending?'disabled':''}></textarea><div class="composer-bottom"><span>${icon(ready?'cloud':'lock',13)} ${ready ? 'Agent · 工具按需调用' : cloud ? '等待重新连接' : '本机基础模式'}</span><button class="send-button" type="submit" aria-label="发送消息" ${chatPending?'disabled':''}>${icon('up',19)}</button></div></form><div class="composer-hint">Enter 发送 · Shift + Enter 换行 · 读取自动执行，修改目标由你确认</div></div><aside class="context-card"><div class="eyebrow">CONTEXT, ON DEMAND</div><h3>需要时，才寻找线索</h3><div class="context-stat">${icon('memory',18)}<span>已有记忆</span><b>${state.memories.length}</b></div><div class="context-stat">${icon('goals',18)}<span>进行中的目标</span><b>${state.goals.filter(g=>g.status!=='completed').length}</b></div><div class="context-divider"></div><p>普通聊天不预先检索历史。连接模型后，它可以按需查找记忆、按日期核对已授权的浏览历史、阅读当前页、查看目标，再继续处理。</p><p class="context-boundary">工具读到的相关数据会发送到你配置的服务。修改目标前，会先展示具体内容供你确认。</p><button class="text-button" data-nav="settings">管理连接与隐私 ${icon('arrow',15)}</button></aside></div>`;
}

function messageView(m) {
  const assistant = m.role !== 'user';
  return `<article class="message message-${assistant?'assistant':'user'}"><span class="message-avatar">${assistant?brandMark:e((state.profile.name||'我').slice(0,1))}</span><div class="message-body"><div class="message-label">${assistant?'Avatara':'你'}${assistant?`<span>${m.mode==='cloud'?'云端 Agent':'本机'}</span>`:''}</div>${assistant?toolTraceView(m.steps):''}<div class="message-text" data-message-id="${e(m.id)}"></div>${assistant?actionCardsView(m,state.goals,{disabled:chatPending || busy}):''}${m.sources?.length?`<div class="source-list"><div class="sources-label">引用来源</div>${m.sources.map((s,i)=>`<a href="${e(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer"><span>${i+1}</span>${e(s.title)}${icon('external',13)}</a>`).join('')}</div>`:''}</div></article>`;
}

function settingsView() {
  const ai = state.settings.ai;
  return `${pageHeading('MAKE THIS SPACE YOURS','按你的方式，相处<span class="greeting-dot">。</span>','哪些内容被记住、连接什么模型，由你决定。')}<div class="settings-layout"><section class="settings-card"><div class="settings-card-heading">${icon('spark',23)}<div><h2>思考伙伴</h2><p>本机提供基础检索；连接支持工具调用的模型后，由 Agent 理解意图并按需执行。</p></div><span class="tag ${ai.enabled?'tag-green':''}">${ai.enabled?'云端 Agent':'本机模式'}</span></div>${!isExtension?'<div class="inline-note">这里是独立演示环境。连接云端与保存密钥，请在已安装的扩展内完成。</div>':''}<form id="ai-settings"><label class="field"><span>服务地址</span><input name="baseUrl" type="url" value="${e(ai.baseUrl||'https://api.deepseek.com')}" placeholder="https://api.deepseek.com" required><small>支持原生 tools / tool_calls 的 Chat Completions 接口，可包含 /v1。</small></label><div class="field-row"><label class="field"><span>模型名称</span><input name="model" value="${e(ai.model||'deepseek-v4-flash')}" required maxlength="100"></label><label class="field"><span>API 密钥 ${ai.hasKey?'<span class="inline-status">本次浏览器会话已保存</span>':''}</span><input name="apiKey" type="password" autocomplete="off" placeholder="${ai.hasKey?'留空保留本次密钥':'输入你的 API Key'}" ${!isExtension?'disabled':''}><small>密钥只保留到浏览器关闭，不进入导出文件。</small></label></div><label class="consent-row"><input name="enabled" type="checkbox" ${ai.enabled?'checked':''} ${!isExtension?'disabled':''}><span><strong>启用云端 Agent</strong><small>提问与近期对话会发送给上方服务。模型可按需读取并发送记忆正文、目标、个人关注、浏览概况、已授权的按日期浏览记录、可访问的标签页与已授权当前页；日期结果按页发送，不自动发送全部历史。修改目标需单独确认，关闭后恢复本机基础模式。</small></span></label><div class="form-actions"><button class="button button-outline" type="button" data-action="test-ai" ${!isExtension?'disabled':''}>测试连接</button><button class="button button-primary" type="submit" ${!isExtension?'disabled':''}>保存连接 ${icon('check',16)}</button></div><div id="connection-status" role="status" class="connection-status"></div></form></section><section class="settings-card"><div class="settings-card-heading">${icon('memory',23)}<div><h2>记忆的边界</h2><p>主动保存页面，也可以选择记录之后的浏览标题与链接。</p></div></div><form id="privacy-settings"><label class="consent-row"><input name="captureEnabled" type="checkbox" ${state.settings.captureEnabled?'checked':''}><span><strong>自动记住新的浏览记录</strong><small>开启后需授权历史记录权限。记录标题与链接，不自动抓取页面正文。</small></span></label><div class="field-row"><label class="field"><span>未收藏记忆保留</span><select name="retentionDays">${[30,90,180,365].map(n=>`<option value="${n}" ${Number(state.settings.retentionDays)===n?'selected':''}>${n} 天</option>`).join('')}</select><small>已收藏内容不随保留期清理。</small></label><label class="field"><span>排除的网站</span><textarea name="excludedDomains" placeholder="bank.example.com&#10;private.example.com" rows="3">${e((state.settings.excludedDomains||[]).join('\n'))}</textarea><small>每行一个域名。影响后续采集、导入和按日期查询，不删除已有记忆。</small></label></div><div class="form-actions"><button class="button button-primary" type="submit">保存偏好 ${icon('check',16)}</button></div></form></section><section class="settings-card"><div class="settings-card-heading">${icon('lock',23)}<div><h2>你的数据，始终由你掌握</h2><p>导出可读的 JSON 文件，或从这里重新开始。</p></div></div><div class="data-actions"><button class="button button-outline" data-action="import-dialog">${icon('download',16)}导入历史</button><button class="button button-outline" data-action="export">${icon('download',16)}导出我的数据</button><button class="text-button danger" data-action="clear-data">清空所有本机数据</button></div><p class="muted small-text">${state.importedAt?'上次导入：'+shortDate(state.importedAt):'尚未导入浏览历史'} · ${state.memories.length} 条记忆 · ${state.goals.length} 个目标</p></section></div>`;
}

function openModal(title, body, formId, submitLabel, danger=false) {
  returnFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><h2 id="modal-title">${e(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close',21)}</button></div><form id="${formId}">${body}<div class="modal-actions"><button type="button" class="button button-outline" data-action="close-modal">取消</button><button type="submit" class="button ${danger?'button-danger':'button-primary'}">${e(submitLabel)}</button></div></form></section></div>`;
  app.inert = true;
  document.body.classList.add('modal-open');
  modalRoot.querySelector('input:not([type=hidden]),select,textarea,[type=submit]')?.focus();
}

function closeModal() { modalRoot.innerHTML=''; app.inert=false; document.body.classList.remove('modal-open'); if(returnFocus?.isConnected)returnFocus.focus(); if(refreshPending)void refreshState(); }

function goalDialog() { openModal('写下一个想靠近的目标',`<p class="modal-description">从一件具体的小事开始。每一次进展，都值得被看见。</p><label class="field"><span>我想要…</span><input name="title" placeholder="每周读完三篇值得思考的文章" maxlength="120" required></label><label class="field"><span>为什么这件事对我重要？<small>选填</small></span><textarea name="why" placeholder="把好奇心变成自己的理解。" rows="2" maxlength="500"></textarea></label><div class="field-row"><label class="field"><span>目标数量</span><input name="target" type="number" min="1" max="100000" value="3" required></label><label class="field"><span>单位</span><input name="unit" value="篇" maxlength="12" required></label></div><label class="field"><span>希望完成的日期<small>选填</small></span><input name="dueDate" type="date"></label>`,'new-goal-form','开始这一程'); }

function importDialog() { openModal('让过去的探索，成为现在的线索',`<p class="modal-description">导入 Chrome 历史中的标题、链接和访问时间，建立可检索的记忆。不会自动下载历史页面的正文。</p>${!isExtension?'<div class="inline-note">演示环境会导入一小组示例记录，不读取你的浏览器历史。</div>':''}<label class="field"><span>导入范围</span><select name="days"><option value="7">最近 7 天</option><option value="30" selected>最近 30 天</option><option value="90">最近 90 天</option></select></label><p class="privacy-footnote">${icon('lock',15)}导入和检索均在本机完成；现有收藏与正文会保留。</p>`,'import-form','导入记忆'); }

async function ensureHistoryPermission() { if (isExtension && !await chrome.permissions.request({permissions:['history']})) throw new Error('没有获得历史记录权限，未读取浏览历史。'); }
async function ensureCloudPermission(baseUrl) { if (!isExtension) return; const url=new URL(baseUrl); if (!await chrome.permissions.request({origins:[`${url.protocol}//${url.hostname}/*`]})) throw new Error('没有获得此服务的连接权限，未发送请求。'); }

async function sendChat(text) {
  if (!text.trim() || chatPending || busy) return;
  navigate('chat');
  pendingText=text.trim();
  chatDraft='';
  chatPending=true;
  pendingSteps=[];
  chatRequestId=crypto.randomUUID();
  render();
  try { state=await request('chat.send',{text:text.trim(),requestId:chatRequestId}); }
  catch(err) { chatDraft=text; toast(err.message,true); }
  finally { chatPending=false; pendingText=''; pendingSteps=[];chatRequestId='';render(); document.querySelector('#chat-form textarea')?.focus(); if(refreshPending)void refreshState(); }
}

document.addEventListener('click', async event => {
  const nav=event.target.closest('[data-nav]');
  if(nav){event.preventDefault();navigate(nav.dataset.nav);return;}
  const filter=event.target.closest('[data-filter]');
  if(filter){memoryFilter=filter.dataset.filter;memoryLimit=30;render();return;}
  const target=event.target.closest('[data-action]');
  if(!target || target.disabled)return;
  const action=target.dataset.action;
  if(action==='close-modal'){closeModal();return;}
  if(busy)return;
  try {
    if(action==='approve-agent-action'||action==='reject-agent-action') {
      if(chatPending)return;
      target.disabled=true;
      try { await mutate('chat.confirm',{messageId:target.dataset.messageId,actionId:target.dataset.id,decision:action==='approve-agent-action'?'approve':'reject'}); }
      finally { render(); }
    }
    else if(action==='capture') { await mutate('memory.capture',{},'这一页，已经记住了。'); }
    else if(action==='save-memory') { const was=state.memories.find(m=>m.id===target.dataset.id)?.saved; await mutate('memory.toggleSaved',{id:target.dataset.id},was?'已取消收藏':'已收藏，值得再回来。'); }
    else if(action==='new-goal')goalDialog();
    else if(action==='more-memories'){const scroll=document.querySelector('.main-scroll')?.scrollTop||0;memoryLimit+=30;render();document.querySelector('.main-scroll')?.scrollTo(0,scroll);}
    else if(action==='advance-goal')await mutate('goals.advance',{id:target.dataset.id,delta:1},'又向前走了一步。');
    else if(action==='delete-goal'){const g=state.goals.find(g=>g.id===target.dataset.id);openModal('放下这个目标？',`<p class="modal-description">「${e(g?.title)}」及其进度将从本机删除。</p><input type="hidden" name="id" value="${e(target.dataset.id)}">`,'delete-goal-form','删除目标',true);}
    else if(action==='import-dialog')importDialog();
    else if(action==='topic'){query=target.dataset.topic;memoryFilter='all';navigate('memory');}
    else if(action==='clear-search'){query='';render();document.getElementById('memory-search')?.focus();}
    else if(action==='prompt')await sendChat(target.dataset.prompt);
    else if(action==='clear-chat')openModal('开始一段新对话', '<p class="modal-description">当前对话记录将被清空，你的记忆和目标会保留。</p>','clear-chat-form','开始新对话',true);
    else if(action==='edit-profile')openModal('让这里更像你',`<label class="field"><span>怎么称呼你？</span><input name="name" value="${e(state.profile.name)}" placeholder="你的名字" maxlength="40"></label><label class="field"><span>最近最想专注的事</span><textarea name="focus" rows="3" maxlength="200" placeholder="写下一个正在关心的方向…">${e(state.profile.focus)}</textarea></label>`,'profile-form','保存');
    else if(action==='clear-data')openModal('从一张白纸重新开始？','<p class="modal-description">这会删除 Avatara 的记忆、目标、对话、设置与会话密钥，不影响 Chrome 自身的历史记录。此操作无法撤销，建议先导出备份。</p><label class="field"><span>输入「清空」确认</span><input name="confirmation" autocomplete="off" required pattern="清空" placeholder="清空"></label>','clear-data-form','清空本机数据',true);
    else if(action==='export'){const data=await request('data.export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`avatara-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('已导出你的数据，不包含密钥。');}
    else if(action==='test-ai'){
      const form=document.getElementById('ai-settings');if(!form.reportValidity())return;const payload=Object.fromEntries(new FormData(form));if(!payload.apiKey?.trim())delete payload.apiKey;await ensureCloudPermission(payload.baseUrl);target.disabled=true;document.getElementById('connection-status').textContent='正在发送不含记忆的连接测试…';
      const statusElement=document.getElementById('connection-status');
      try{const result=await request('ai.test',payload);const message=`连接成功 · ${result.model || payload.model} · ${result.message}`;if(statusElement?.isConnected)statusElement.textContent=message;else toast(message);}catch(err){if(statusElement?.isConnected)statusElement.textContent=err.message;else toast(err.message,true);}finally{target.disabled=false;}
    }
  }catch(err){toast(err.message,true);}
});

document.addEventListener('submit', async event => {
  const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();
  const values=Object.fromEntries(new FormData(form));
  if(busy)return;
  try {
    if(form.id==='quick-ask'||form.id==='chat-form'){await sendChat(values.text);return;}
    if(form.id==='new-goal-form'){if(await mutate('goals.create',{...values,target:Number(values.target)},'新的方向，已经记下。'))closeModal();}
    else if(form.id==='import-form'){await ensureHistoryPermission();const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='正在整理历史…';if(await mutate('history.import',{days:Number(values.days)},'历史已整理成可检索的记忆。'))closeModal();else{button.disabled=false;button.textContent='重新导入';}}
    else if(form.id==='profile-form'){if(await mutate('profile.update',values,'已更新你的空间。'))closeModal();}
    else if(form.id==='delete-goal-form'){if(await mutate('goals.delete',{id:values.id},'已删除这个目标及其进度。'))closeModal();}
    else if(form.id==='clear-chat-form'){if(await mutate('chat.clear',{},'开始一段新对话。'))closeModal();}
    else if(form.id==='clear-data-form'){if(values.confirmation!=='清空')return;if(await mutate('data.clear',{},'Avatara 的本机数据已清空，无法撤销。'))closeModal();}
    else if(form.id==='privacy-settings'){if(values.captureEnabled==='on')await ensureHistoryPermission();await mutate('settings.update',{captureEnabled:values.captureEnabled==='on',retentionDays:Number(values.retentionDays),excludedDomains:values.excludedDomains.split(/[\n,，]/).map(x=>x.trim()).filter(Boolean)},'记忆偏好已保存。');}
    else if(form.id==='ai-settings'){if(!isExtension)return;if(values.enabled==='on')await ensureCloudPermission(values.baseUrl);const ai={baseUrl:values.baseUrl.trim(),model:values.model.trim(),enabled:values.enabled==='on'};if(values.apiKey?.trim())ai.apiKey=values.apiKey.trim();await mutate('settings.update',{ai},'连接设置已保存。');}
  } catch(err){toast(err.message,true);}
});

document.addEventListener('input', event => {
  if(event.target.closest('#ai-settings,#privacy-settings'))settingsDirty=true;
  if(event.target.matches('#chat-form textarea')){chatDraft=event.target.value;return;}
  if(event.target.id!=='memory-search')return;
  if(composingSearch)return;
  const selection=event.target.selectionStart;query=event.target.value;memoryLimit=30;render();const input=document.getElementById('memory-search');input?.focus();input?.setSelectionRange(selection,selection);
});
document.addEventListener('compositionstart',event=>{if(event.target.id==='memory-search')composingSearch=true;});
document.addEventListener('compositionend',event=>{if(event.target.id==='memory-search'){composingSearch=false;query=event.target.value;render();const input=document.getElementById('memory-search');input?.focus();input?.setSelectionRange(query.length,query.length);}});
document.addEventListener('keydown', event => {
  if(modalRoot.firstChild){if(event.key==='Escape'){closeModal();return;}if(event.key==='Tab'){const focusable=[...modalRoot.querySelectorAll('button:not([disabled]),input:not([type=hidden]),select,textarea,a[href]')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}
  if(event.target.matches('#chat-form textarea')&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();event.target.form.requestSubmit();}
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(['today','memory','goals','chat','settings'].includes(next))navigate(next);});
window.addEventListener('focus',()=>void refreshState());
window.addEventListener('storage',event=>{if(event.key==='avatara_demo_state_v1')void refreshState();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshState();});
if(isExtension)chrome.storage.onChanged.addListener((changes,area)=>{if((area==='local'&&changes.avatara_state)||(area==='session'&&changes.avatara_api_key))void refreshState();});
if(isExtension)chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender?.id!==chrome.runtime.id || message?.type!=='agent.progress' || !chatPending || message.requestId!==chatRequestId)return;
  const step=message.step;
  if(!step || typeof step.id!=='string' || !['completed','error','pending'].includes(step.status))return;
  const index=pendingSteps.findIndex(item=>item.id===step.id);
  if(index>=0)pendingSteps[index]=step;else if(pendingSteps.length<10)pendingSteps.push(step);
  const region=document.getElementById('agent-live-steps');
  if(region)region.innerHTML=toolTraceView(pendingSteps,{live:true});
  const thinking=document.querySelector('.thinking-text');
  if(thinking)thinking.textContent='正在根据工具结果继续处理…';
  document.getElementById('chat-history')?.scrollTo(0,100000);
});

try {state=await request('state.get');render();}catch(err){app.innerHTML=`<div class="startup-error">${brandMark}<h1>暂时没有连接上</h1><p>${e(err.message)}</p><button class="button button-primary" id="retry-load">重新连接</button></div>`;document.getElementById('retry-load').addEventListener('click',()=>location.reload());}
