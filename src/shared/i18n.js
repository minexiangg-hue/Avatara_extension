// ============================================================
// Avatara — Internationalization
// ============================================================
// All user-facing strings. To add a language:
//   1. Copy the `en` block
//   2. Translate every value
//   3. Add code → name entry to LANGUAGES
// Usage: i18n.t('key', { param: 'value' })
// ============================================================

const STRINGS = {
  en: {
    appName: 'Avatara',
    appTagline: 'Your browser, understood.',
    onboardingWelcome: 'Welcome to Avatara',
    onboardingTagline: 'I\'m your browser butler. I\'ll learn your browsing world so I can help you find anything, notice patterns, and keep you on track.',
    onboardingImporting: 'Importing your history and bookmarks…',
    onboardingImportDone: 'Done! Indexed {count} pages and {bookmarkCount} bookmarks.',
    onboardingReady: 'All set! Try: "find that article about AI from last week."',
    chatPlaceholder: 'Ask me anything about your browsing…',
    chatExample1: 'Find that article about AI from last week',
    chatExample2: 'Summarize what I read today',
    chatExample3: 'Group my AI-related tabs',
    chatExample4: 'How much time on YouTube this week?',
    insightsTitle: 'Insights',
    insightsToday: 'Today',
    insightsThisWeek: 'This Week',
    insightsTopSites: 'Top Sites',
    insightsScreenTime: 'Screen Time',
    insightsTrending: 'Trending Topics',
    insightsNoData: 'Not enough data yet. Keep browsing and I\'ll start noticing patterns.',
    goalsTitle: 'Goals',
    goalsCreate: 'Set a Goal',
    goalsEmpty: 'No active goals. Set one to get started!',
    goalsProgress: '{current} / {target} {unit}',
    goalsReminder: 'Reminder: you wanted to {description}',
    alertHaventVisited: 'You haven\'t visited {site} in {days} days. Catch up?',
    alertTrendingTopic: 'You\'ve been into {topic} lately ({count} pages in {days} days).',
    alertGoalBehind: 'Behind on your goal: {description}',
    alertTabStale: '{count} tabs untouched for a week. Archive them?',
    settingsTitle: 'Settings',
    settingsLanguage: 'Language',
    settingsTheme: 'Theme',
    settingsThemeLight: 'Light',
    settingsThemeDark: 'Dark',
    settingsThemeSystem: 'System',
    settingsAlertsFrequency: 'Alert Frequency',
    settingsAlertsLow: 'Low',
    settingsAlertsMedium: 'Medium',
    settingsAlertsHigh: 'High',
    settingsClearData: 'Clear All Data',
    settingsClearDataConfirm: 'Delete all indexed data? Avatara will start fresh.',
    settingsExportData: 'Export My Data',
    settingsPrivacy: 'Privacy Dashboard',
    tierFree: 'Free',
    tierPro: 'Pro',
    tierTeam: 'Team',
    upgradeToPro: 'Upgrade to Pro',
    upgradePrompt: 'Want me to auto-summarize pages and spot trends for you?',
    loading: 'Loading…',
    error: 'Something went wrong.',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    close: 'Close',
    search: 'Search',
    noResults: 'No results found.',
    minutes: 'min',
    hours: 'hrs',
    pages: 'pages',
    times: 'times',
    today: 'today',
    yesterday: 'yesterday',
    thisWeek: 'this week',
    lastWeek: 'last week',
  },
  zh: {
    appName: 'Avatara',
    appTagline: '懂你的浏览器',
    onboardingWelcome: '欢迎使用 Avatara',
    onboardingTagline: '我是你的浏览器管家。让我了解你的浏览世界，帮你找到任何东西、发现规律、保持节奏。',
    onboardingImporting: '正在导入历史和书签…',
    onboardingImportDone: '完成！已索引 {count} 个页面和 {bookmarkCount} 个书签。',
    onboardingReady: '准备好了！试试："帮我找上周那篇讲 AI 的文章"',
    chatPlaceholder: '问我任何关于你浏览的内容…',
    chatExample1: '帮我找上周那篇讲 AI 的文章',
    chatExample2: '总结我今天看了什么',
    chatExample3: '把 AI 相关的标签分个组',
    chatExample4: '我这周在 B 站花了多少时间？',
    insightsTitle: '洞察',
    insightsToday: '今天',
    insightsThisWeek: '本周',
    insightsTopSites: '常用网站',
    insightsScreenTime: '屏幕时间',
    insightsTrending: '热门话题',
    insightsNoData: '数据还不够多。继续浏览，我会开始发现规律。',
    goalsTitle: '目标',
    goalsCreate: '设定目标',
    goalsEmpty: '暂无活跃目标。设定一个开始吧！',
    goalsProgress: '已完成 {current} / {target} {unit}',
    goalsReminder: '提醒：你之前想 {description}',
    alertHaventVisited: '你已经 {days} 天没去过 {site} 了。回去看看？',
    alertTrendingTopic: '你最近对 {topic} 特别感兴趣（{days} 天内看了 {count} 页）。',
    alertGoalBehind: '目标进度落后了：{description}',
    alertTabStale: '{count} 个标签超过一周没碰了。要归档吗？',
    settingsTitle: '设置',
    settingsLanguage: '语言',
    settingsTheme: '主题',
    settingsThemeLight: '浅色',
    settingsThemeDark: '深色',
    settingsThemeSystem: '跟随系统',
    settingsAlertsFrequency: '提醒频率',
    settingsAlertsLow: '低',
    settingsAlertsMedium: '中',
    settingsAlertsHigh: '高',
    settingsClearData: '清除所有数据',
    settingsClearDataConfirm: '删除所有已索引的数据？Avatara 将重新开始。',
    settingsExportData: '导出我的数据',
    settingsPrivacy: '隐私仪表盘',
    tierFree: '免费版',
    tierPro: '专业版',
    tierTeam: '团队版',
    upgradeToPro: '升级到 Pro',
    upgradePrompt: '想要我自动摘要页面并发现趋势吗？',
    loading: '加载中…',
    error: '出了点问题。',
    cancel: '取消',
    confirm: '确认',
    save: '保存',
    delete: '删除',
    close: '关闭',
    search: '搜索',
    noResults: '没有找到结果。',
    minutes: '分钟',
    hours: '小时',
    pages: '页',
    times: '次',
    today: '今天',
    yesterday: '昨天',
    thisWeek: '本周',
    lastWeek: '上周',
  },
};

const LANGUAGES = { en: 'English', zh: '中文' };
let currentLang = 'en';

function detectLang() {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

export const i18n = {
  init(lang) {
    currentLang = lang || detectLang();
    if (typeof document !== 'undefined') document.documentElement.lang = currentLang;
  },

  t(key, params = {}) {
    const strings = STRINGS[currentLang] || STRINGS.en;
    let value = strings[key];
    if (value === undefined) {
      console.warn(`[i18n] missing key: ${key}`);
      value = STRINGS.en[key] || key;
    }
    return value.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  },

  getLang() { return currentLang; },

  async setLang(lang) {
    if (!STRINGS[lang]) throw new Error(`Unsupported: ${lang}`);
    currentLang = lang;
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    await chrome.storage.local.set({ avatara_lang: lang });
    chrome.runtime.sendMessage({ type: 'ui:languageChanged', lang }).catch(() => {});
  },

  getAvailableLanguages() {
    return Object.entries(LANGUAGES).map(([code, name]) => ({ code, name }));
  },
};
