// ============================================================
// Avatara — Tabs View
// ============================================================

import { sendToBackground } from '../app.js';
import * as MT from '../../../shared/message-types.js';

export async function mount(container) {
  container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Loading tabs…</div></div>';

  try {
    const tabs = await chrome.tabs.query({});
    const windows = {};
    for (const tab of tabs) {
      const wid = tab.windowId;
      if (!windows[wid]) windows[wid] = [];
      windows[wid].push(tab);
    }

    if (tabs.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">📑</div><div class="empty-state__text">No open tabs</div></div>';
      return;
    }

    let html = `<div style="padding:var(--space-md);display:flex;flex-direction:column;gap:var(--space-md);">
      <div class="flex items-center justify-between">
        <span class="text-sm text-muted">${tabs.length} tabs in ${Object.keys(windows).length} window(s)</span>
        <button class="btn btn-ghost btn-sm" id="btnArchiveStale">Archive stale</button>
      </div>`;

    for (const [wid, winTabs] of Object.entries(windows)) {
      html += `<div class="card" style="padding:var(--space-sm);">
        <div class="text-xs text-muted" style="padding:var(--space-xs) var(--space-sm);">Window ${wid} · ${winTabs.length} tabs</div>`;

      for (const tab of winTabs) {
        const domain = getDomain(tab.url);
        html += `
          <div class="list-item" style="justify-content:space-between;">
            <div class="flex items-center gap-sm flex-1" style="min-width:0;">
              <span style="font-size:14px;">${tab.favIconUrl ? `<img src="${tab.favIconUrl}" width="16" height="16" style="border-radius:2px;">` : '📄'}</span>
              <span class="truncate text-sm">${tab.title || domain}</span>
              ${tab.audible ? '<span class="text-xs text-muted">🔊</span>' : ''}
            </div>
            <span class="text-xs text-muted" style="flex-shrink:0;">${domain}</span>
          </div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Archive stale button
    document.getElementById('btnArchiveStale')?.addEventListener('click', async () => {
      await sendToBackground(MT.BUTLER.NL_COMMAND, { query: 'archive stale tabs' });
      mount(container); // refresh
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state__text">Failed to load tabs</div></div>`;
  }
}

function getDomain(url) {
  try { return new URL(url || '').hostname.replace('www.', ''); } catch { return ''; }
}
