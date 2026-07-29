// ============================================================
// Avatara — Insights View
// ============================================================

import { i18n } from '../../../shared/i18n.js';
import { sendToBackground } from '../app.js';
import * as MT from '../../../shared/message-types.js';

export async function mount(container) {
  container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Loading…</div></div>';

  try {
    const data = await sendToBackground(MT.BUTLER.GET_INSIGHTS);

    if (data.error || (!data.recentPages && !data.trending?.length)) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__text">${i18n.t('insightsNoData')}</div>
      </div>`;
      return;
    }

    container.innerHTML = `
      <div class="insights-grid" style="display:flex;flex-direction:column;gap:var(--space-lg);padding:var(--space-lg);">
        <insight-card type="stats" title="${i18n.t('insightsToday')}">
          <div style="font-size:var(--text-2xl);font-weight:var(--font-weight-semibold);">
            ${data.recentPages || 0} <span style="font-size:var(--text-sm);color:var(--color-text-muted);">${i18n.t('pages')} ${i18n.t('today')}</span>
          </div>
        </insight-card>

        ${data.trending?.length ? `
        <insight-card type="trend" title="${i18n.t('insightsTrending')}">
          <div style="display:flex;flex-wrap:wrap;gap:var(--space-sm);">
            ${data.trending.slice(0, 8).map(t =>
              `<span class="tag active">${t.name} <span class="text-muted">(${t.recentCount})</span></span>`
            ).join('')}
          </div>
        </insight-card>` : ''}

        ${data.interestGraph?.domains?.length ? `
        <insight-card type="stats" title="${i18n.t('insightsTopSites')}">
          <div style="display:flex;flex-direction:column;gap:var(--space-sm);">
            ${data.interestGraph.domains.slice(0, 5).map(d => `
              <div class="flex items-center justify-between text-sm">
                <span class="truncate" style="max-width:200px;">${d.domain}</span>
                <span class="text-muted">${d.visitCount} ${i18n.t('times')}</span>
              </div>
            `).join('')}
          </div>
        </insight-card>` : ''}

        <button class="btn btn-ghost btn-sm" style="align-self:center;" onclick="this.closest('.view').dispatchEvent(new Event('refresh'))">
          ↻ Refresh
        </button>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state__text">${i18n.t('error')}</div></div>`;
  }
}
