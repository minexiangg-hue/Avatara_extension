const status = document.querySelector('#status');
const capture = document.querySelector('#capture');
const panel = document.querySelector('#panel');
let currentWindowId;

function report(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  currentWindowId = tab?.windowId;
}).catch(() => {});

capture.addEventListener('click', async () => {
  capture.disabled = true;
  report('正在记住这一页…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'memory.capture', payload: {} });
    if (!response?.ok) throw new Error(response?.error || '暂时无法保存，请重试。');
    report('已保存到你的记忆，并加入收藏。下次可以直接问 Avatara。');
    capture.querySelector('span').textContent = '已记住这一页';
  } catch (error) { report(error.message, true); }
  finally { capture.disabled = false; }
});

document.querySelector('#workspace').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }); window.close(); }
  catch { report('工作台暂时未能打开，请重试。', true); }
});

panel.addEventListener('click', () => {
  if (currentWindowId === undefined) { report('窗口仍在准备中，请再点击一次。', true); return; }
  // Keep open() directly inside the click handler to preserve the user gesture.
  chrome.sidePanel.open({ windowId: currentWindowId }).then(() => window.close()).catch(() => {
    report('侧边栏暂时未能打开，你可以先使用工作台。', true);
  });
});
