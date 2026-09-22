import { icon } from './icons.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const labels = {
  query_history: '按日期查询浏览记录',
  search_memories: '搜索记忆', read_memory: '阅读记忆正文', list_goals: '查看目标',
  get_profile: '了解当前关注', get_activity_summary: '回顾浏览概况',
  read_current_page: '阅读当前页面', list_tabs: '查看可访问的标签页',
  create_goal: '拟定新目标', advance_goal: '拟定进度更新',
};

/** Execution receipts only. Never render a model's private reasoning or raw arguments. */
export function toolTraceView(steps = [], { live = false } = {}) {
  const safe = steps.filter(step => step && ['completed', 'error', 'pending'].includes(step.status)).slice(0, 10);
  if (!safe.length) return '';
  return `<details class="tool-trace" ${live ? 'open' : ''}><summary>${icon('spark', 13)}<span>${live ? '正在处理' : '工具执行记录'} · ${safe.length} 步</span>${icon('arrow', 12)}</summary><ol>${safe.map(step => `<li class="tool-step tool-step-${step.status}"><span class="tool-step-mark">${icon(step.status === 'completed' ? 'check' : step.status === 'error' ? 'close' : 'goals', 12)}</span><div><strong>${escape(labels[step.name] || '工具调用')}</strong><span>${escape(String(step.summary || ({ completed: '已读取', error: '未能完成', pending: '等待你确认' }[step.status])).slice(0, 300))}</span></div><small>${{ completed: '完成', error: '未完成', pending: '待确认' }[step.status]}</small></li>`).join('')}</ol></details>`;
}

export function actionCardsView(message, goals = [], { disabled = false, now = Date.now() } = {}) {
  return (message.actions || []).filter(action => action && ['create_goal', 'advance_goal'].includes(action.name)).slice(0, 10).map(action => {
    const args = action.args || {};
    const goal = goals.find(item => item.id === args.id);
    const title = action.name === 'create_goal' ? String(args.title || '新目标') : (goal?.title || '已不可用的目标');
    const validExpiry = Number.isFinite(Date.parse(action.expiresAt)) && Date.parse(action.expiresAt) > now;
    const status = action.status === 'pending' && !validExpiry ? 'expired' : action.status;
    const statusLabel = { pending: '需要你确认', approved: '已执行', rejected: '已取消', expired: '已过期', failed: '未执行' }[status] || '不可执行';
    const change = action.name === 'create_goal'
      ? `创建目标 · ${Number(args.target) || 0} ${String(args.unit || '次')}${args.dueDate ? ` · 截止 ${args.dueDate}` : ''}`
      : `记录进度 · +${Number(args.delta) || 0} ${String(goal?.unit || '次')}`;
    return `<section class="agent-action agent-action-${escape(status)}" aria-label="${escape(statusLabel)}：${escape(title)}"><div class="agent-action-heading">${icon('goals', 15)}<span>${escape(statusLabel)}</span><small>${action.name === 'create_goal' ? 'CREATE GOAL' : 'UPDATE PROGRESS'}</small></div><h4>${escape(title)}</h4><p>${escape(change)}</p>${action.name === 'create_goal' && args.why ? `<p class="agent-action-why">${escape(args.why)}</p>` : ''}${status === 'pending' ? `<div class="agent-action-buttons"><button class="button button-small button-primary" data-action="approve-agent-action" data-message-id="${escape(message.id)}" data-id="${escape(action.id)}" aria-label="确认执行：${escape(title)}" ${disabled ? 'disabled' : ''}>${icon('check', 14)}确认执行</button><button class="text-button" data-action="reject-agent-action" data-message-id="${escape(message.id)}" data-id="${escape(action.id)}" aria-label="取消操作：${escape(title)}" ${disabled ? 'disabled' : ''}>暂不执行</button></div><small class="agent-action-note">确认前不会修改数据 · 提案 30 分钟内有效</small>` : `<small class="agent-action-note">${status === 'approved' ? '操作结果已保存在本机。' : status === 'rejected' ? '这项操作没有执行。' : '这项操作没有执行，可以重新告诉我你的需求。'}</small>`}</section>`;
  }).join('');
}
