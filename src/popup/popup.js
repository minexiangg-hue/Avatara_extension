// ============================================================
// Avatara — Popup Script
// ============================================================
// Lightweight. All deep interactions open the side panel.
// ============================================================

import * as MT from '../shared/message-types.js';

document.addEventListener('DOMContentLoaded', async () => {
  loadDailySummary();
  loadGoalCard();
  loadTier();
  setupButtons();
  setupSearch();
});

async function sendToBackground(type, data = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, ...data }, (resp) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(resp || {});
    });
  });
}

async function loadDailySummary() {
  const el = document.getElementById('dailySummary');
  if (!el) return;

  try {
    const data = await sendToBackground(MT.BUTLER.GET_DAILY_DIGEST);
    if (data.error) {
      el.innerHTML = '<div class="text-muted" style="font-size:12px;">Not enough data yet</div>';
      return;
    }
    const topDomain = data.topDomains?.[0]?.domain || '—';
    el.innerHTML = `
      <div style="font-size:13px;font-weight:500;">Today: ${data.pagesToday || 0} pages</div>
      <div class="text-muted" style="font-size:11px;margin-top:2px;">Mostly on ${topDomain}</div>
    `;
  } catch {
    el.innerHTML = '<div class="text-muted" style="font-size:12px;">Loading…</div>';
  }
}

async function loadGoalCard() {
  const el = document.getElementById('goalCard');
  if (!el) return;

  try {
    const data = await sendToBackground(MT.GOALS.LIST);
    const goals = data.goals || [];
    if (goals.length === 0) return;

    const goal = goals[0];
    const pct = Math.round((goal.current / Math.max(1, goal.target)) * 100);
    el.style.display = 'block';
    el.innerHTML = `
      <div class="text-muted" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Active Goal</div>
      <div style="font-size:12px;font-weight:500;">${goal.description}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <div style="flex:1;height:3px;background:var(--color-bg-tertiary);border-radius:9999px;overflow:hidden;">
          <div style="height:100%;background:var(--color-accent);width:${pct}%;border-radius:9999px;"></div>
        </div>
        <span style="font-size:11px;color:var(--color-text-muted);">${pct}%</span>
      </div>
    `;
  } catch { /* no goals */ }
}

async function loadTier() {
  try {
    const data = await sendToBackground(MT.LICENSE.CHECK_STATUS);
    const badge = document.getElementById('tierBadge');
    if (badge) badge.textContent = data.tier === 'pro' ? 'Pro' : data.tier === 'team' ? 'Team' : 'Free';
  } catch {}
}

function setupButtons() {
  document.getElementById('btnOpenPanel')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) chrome.sidePanel.open({ tabId: tab.id });
    });
    window.close();
  });

  document.getElementById('btnSettings')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) chrome.sidePanel.open({ tabId: tab.id });
    });
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'ui:openSidepanel' });
    }, 300);
    window.close();
  });
}

function setupSearch() {
  const input = document.getElementById('quickSearch');
  if (!input) return;

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const query = input.value.trim();
      if (!query) return;

      // Open side panel with search
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.sidePanel.open({ tabId: tab.id });
      });
      chrome.storage.session.set({ avatara_context_intent: { action: 'quick-search', query } });
      window.close();
    }
  });
}
