// ============================================================
// Avatara — Side Panel App Controller
// ============================================================

import { i18n } from '../../shared/i18n.js';
import * as MT from '../../shared/message-types.js';
import { bus } from './components/message-bus.js';
import * as ChatView from './views/chat.js';
import * as InsightsView from './views/insights.js';
import * as TabsView from './views/tabs.js';
import * as SettingsView from './views/settings.js';

let currentView = 'chat';

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n
  const { getSetting } = await import('../../background/storage/settings.js').catch(() => ({
    getSetting: async () => 'en',
  }));
  let lang = 'en';
  try {
    const stored = await chrome.storage.local.get('avatara_lang');
    lang = stored.avatara_lang || 'en';
  } catch {}
  i18n.init(lang);

  // Apply theme
  try {
    const stored = await chrome.storage.local.get('avatara_theme');
    const theme = stored.avatara_theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {}

  // Apply i18n to static elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n.t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = i18n.t(el.dataset.i18nPlaceholder);
  });

  // Render settings (always visible in DOM)
  try {
    SettingsView.render(document.getElementById('settingsContainer'));
  } catch (e) { console.error('Settings render failed:', e); }

  // Set up nav
  setupNav();

  // Set up message listener from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Load chat view (default)
  await switchView('chat');

  // Check for context intent from context menu / keyboard shortcut
  try {
    const session = await chrome.storage.session.get('avatara_context_intent');
    if (session.avatara_context_intent) {
      await chrome.storage.session.remove('avatara_context_intent');
      handleContextIntent(session.avatara_context_intent);
    }
  } catch {}

  // Load tier and page count
  loadStatusBar();
});

// --- Navigation ---
function setupNav() {
  document.querySelectorAll('.app-nav__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });
}

async function switchView(name) {
  currentView = name;

  // Update nav
  document.querySelectorAll('.app-nav__btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-view="${name}"]`);
  if (btn) btn.classList.add('active');

  // Update views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById(`view-${name}`);
  if (viewEl) viewEl.classList.add('active');

  // Lazy-load view content
  try {
    if (name === 'chat') ChatView.mount(document.getElementById('view-chat'));
    if (name === 'insights') await InsightsView.mount(document.getElementById('insightsContainer'));
    if (name === 'tabs') await TabsView.mount(document.getElementById('tabsContainer'));
  } catch (e) { console.error(`View ${name} mount failed:`, e); }

  bus.emit('viewChanged', name);
}

// --- Background Messages ---
function handleBackgroundMessage(msg, sender, sendResponse) {
  if (msg.type === MT.ALERTS.PROACTIVE_ALERT && msg.alert) {
    bus.emit('alert', msg.alert);
    showToast(msg.alert.message || msg.alert.title);
  }
  if (msg.type === 'ui:contextIntent' && msg.payload) {
    handleContextIntent(msg.payload);
  }
  // Import progress messages
  if (msg.type === 'ingestion:historyImportProgress') {
    updateImportProgress(msg.current, msg.total, msg.phase);
  }
  if (msg.type === MT.INGESTION.HISTORY_IMPORT_DONE) {
    onImportDone(msg.count || 0, msg.bookmarkCount || 0);
  }
  // Always respond to keep the message channel open
  sendResponse?.({ ok: true });
}

let _importInProgress = true;

function updateImportProgress(current, total, phase) {
  _importInProgress = true;
  const el = document.getElementById('pageCount');
  if (el) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const label = phase === 'history' ? 'history' : phase === 'bookmarks' ? 'bookmarks' : 'data';
    el.textContent = `Importing ${label}… ${current.toLocaleString()}/${total > 0 ? total.toLocaleString() : '?'} (${pct}%)`;
  }
}

function onImportDone(historyCount, bookmarkCount) {
  _importInProgress = false;
  const total = historyCount + bookmarkCount;

  // Update status bar
  const el = document.getElementById('pageCount');
  if (el) el.textContent = `${total.toLocaleString()} pages indexed`;

  // Show toast
  showToast(`Import complete: ${total.toLocaleString()} pages from your history`);

  // Refresh insights if that view is active
  loadStatusBar();
}

function handleContextIntent(payload) {
  if (payload.action === 'avatara-ask-page' || payload.action === 'quick-search') {
    switchView('chat');
    setTimeout(() => {
      const input = document.getElementById('chatInput');
      if (input) {
        if (payload.url) {
          input.value = `Summarize this page: ${payload.url}`;
        }
        input.focus();
      }
    }, 300);
  }
  if (payload.action === 'avatara-summarize-page' && payload.url) {
    switchView('chat');
    setTimeout(() => {
      const input = document.getElementById('chatInput');
      if (input) input.value = `Summarize: ${payload.url}`;
    }, 300);
  }
  if (payload.action === 'avatara-ask-selection' && payload.selection) {
    switchView('chat');
    setTimeout(() => {
      const input = document.getElementById('chatInput');
      if (input) input.value = payload.selection;
    }, 300);
  }
}

// --- Status Bar ---
async function loadStatusBar() {
  try {
    const resp = await sendToBackground(MT.LICENSE.CHECK_STATUS);
    const badge = document.getElementById('tierBadge');
    if (badge) {
      badge.textContent = i18n.t(resp.tier === 'pro' ? 'tierPro' : resp.tier === 'team' ? 'tierTeam' : 'tierFree');
    }
  } catch { /* bg not ready yet */ }

  try {
    const stats = await sendToBackground(MT.STORAGE.GET_STATS);
    const pageCount = document.getElementById('pageCount');
    if (pageCount && stats.totalIndexedPages != null) {
      pageCount.textContent = `${stats.totalIndexedPages.toLocaleString()} ${i18n.t('pages')}`;
    } else if (pageCount && !_importInProgress) {
      pageCount.textContent = '—';
    }
  } catch { /* will update later */ }
}

// --- Toast ---
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Helpers ---
export async function sendToBackground(type, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(`[app] sendToBackground ${type}:`, chrome.runtime.lastError.message);
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response || {});
      }
    });
  });
}

export function getCurrentView() { return currentView; }
export { bus, i18n, MT };
