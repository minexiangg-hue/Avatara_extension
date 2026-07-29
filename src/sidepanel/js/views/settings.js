// ============================================================
// Avatara — Settings View
// ============================================================

import { i18n } from '../../../shared/i18n.js';
import { sendToBackground } from '../app.js';
import * as MT from '../../../shared/message-types.js';

export async function render(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-xl);padding:var(--space-lg);">
      <h2 class="text-lg font-semibold">${i18n.t('settingsTitle')}</h2>

      <!-- Language -->
      <div class="card">
        <label class="text-sm font-medium" style="display:block;margin-bottom:var(--space-sm);">${i18n.t('settingsLanguage')}</label>
        <select class="input" id="settingLanguage">
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </div>

      <!-- Theme -->
      <div class="card">
        <label class="text-sm font-medium" style="display:block;margin-bottom:var(--space-sm);">${i18n.t('settingsTheme')}</label>
        <select class="input" id="settingTheme">
          <option value="dark">${i18n.t('settingsThemeDark')}</option>
          <option value="light">${i18n.t('settingsThemeLight')}</option>
          <option value="system">${i18n.t('settingsThemeSystem')}</option>
        </select>
      </div>

      <!-- Alert Frequency -->
      <div class="card">
        <label class="text-sm font-medium" style="display:block;margin-bottom:var(--space-sm);">${i18n.t('settingsAlertsFrequency')}</label>
        <select class="input" id="settingAlerts">
          <option value="medium">${i18n.t('settingsAlertsMedium')}</option>
          <option value="low">${i18n.t('settingsAlertsLow')}</option>
          <option value="high">${i18n.t('settingsAlertsHigh')}</option>
        </select>
      </div>

      <!-- Tier -->
      <div class="card">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm font-medium" id="tierLabel">Free</div>
            <div class="text-xs text-muted" id="upgradePrompt"></div>
          </div>
          <button class="btn btn-primary btn-sm" id="btnUpgrade">${i18n.t('upgradeToPro')}</button>
        </div>
      </div>

      <!-- Data Management -->
      <div class="card">
        <div class="text-sm font-medium" style="margin-bottom:var(--space-md);">${i18n.t('settingsPrivacy')}</div>
        <div style="display:flex;gap:var(--space-sm);">
          <button class="btn btn-sm" id="btnExport">${i18n.t('settingsExportData')}</button>
          <button class="btn btn-sm" id="btnClear" style="color:var(--color-danger);">${i18n.t('settingsClearData')}</button>
        </div>
      </div>

      <!-- About -->
      <div class="text-xs text-muted text-center">
        Avatara v0.1.0 · ${i18n.t('appTagline')}
      </div>
    </div>
  `;

  // Load current settings
  try {
    const stored = await chrome.storage.local.get(['avatara_lang', 'avatara_theme', 'avatara_alertFrequency']);
    const langSelect = document.getElementById('settingLanguage');
    const themeSelect = document.getElementById('settingTheme');
    const alertsSelect = document.getElementById('settingAlerts');
    if (langSelect) langSelect.value = stored.avatara_lang || 'en';
    if (themeSelect) themeSelect.value = stored.avatara_theme || 'dark';
    if (alertsSelect) alertsSelect.value = stored.avatara_alertFrequency || 'medium';

    // Tier
    try {
      const resp = await sendToBackground(MT.LICENSE.CHECK_STATUS);
      const tierLabel = document.getElementById('tierLabel');
      const upgradePrompt = document.getElementById('upgradePrompt');
      if (tierLabel) tierLabel.textContent = i18n.t(resp.tier === 'pro' ? 'tierPro' : resp.tier === 'team' ? 'tierTeam' : 'tierFree');
      if (upgradePrompt && resp.tier === 'free') upgradePrompt.textContent = i18n.t('upgradePrompt');
      const btnUpgrade = document.getElementById('btnUpgrade');
      if (btnUpgrade && resp.tier !== 'free') btnUpgrade.style.display = 'none';
    } catch {}
  } catch {}

  // Event listeners
  document.getElementById('settingLanguage')?.addEventListener('change', async (e) => {
    await i18n.setLang(e.target.value);
    await chrome.storage.local.set({ avatara_lang: e.target.value });
    render(container); // re-render for translated text
  });

  document.getElementById('settingTheme')?.addEventListener('change', async (e) => {
    document.documentElement.setAttribute('data-theme', e.target.value);
    await chrome.storage.local.set({ avatara_theme: e.target.value });
  });

  document.getElementById('settingAlerts')?.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ avatara_alertFrequency: e.target.value });
  });

  document.getElementById('btnExport')?.addEventListener('click', async () => {
    const data = await sendToBackground(MT.STORAGE.EXPORT_DATA);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `avatara-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btnClear')?.addEventListener('click', async () => {
    if (confirm(i18n.t('settingsClearDataConfirm'))) {
      await sendToBackground(MT.STORAGE.CLEAR_DATA);
      alert('Data cleared.');
    }
  });

  document.getElementById('btnUpgrade')?.addEventListener('click', () => {
    // Placeholder for Stripe checkout
    alert('Pro subscription coming soon!');
  });
}
