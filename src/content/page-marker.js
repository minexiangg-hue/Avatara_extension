// ============================================================
// Avatara — Content Script (Page Marker)
// ============================================================
// Silent observer injected into every page.
// - Sends page metadata to background on load
// - Responds to "get selection" requests from background
// - Does NOT modify the DOM
// - Does NOT inject visible elements
// ============================================================

(function () {
  // Only run in top frame
  if (window.top !== window.self) return;

  // Debounce: wait for page to settle
  let sent = false;

  function extractAndSend() {
    if (sent) return;
    sent = true;

    const metadata = {
      url: window.location.href,
      title: document.title || '',
      description: getMeta('description'),
      h1s: getH1s(),
    };

    chrome.runtime.sendMessage({
      type: 'ingestion:pageVisited',
      data: metadata,
    }).catch(() => {
      // Background may not be ready — retry once
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'ingestion:pageVisited',
          data: metadata,
        }).catch(() => {});
      }, 2000);
    });
  }

  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
    return el?.getAttribute('content') || '';
  }

  function getH1s() {
    const h1s = document.querySelectorAll('h1');
    return Array.from(h1s).slice(0, 5).map(h => h.textContent?.trim()).filter(Boolean);
  }

  // Send after page is loaded
  if (document.readyState === 'complete') {
    setTimeout(extractAndSend, 1000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(extractAndSend, 1000);
    });
  }

  // Listen for background requests
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'content:getSelection') {
      sendResponse({ text: window.getSelection()?.toString() || '' });
      return true;
    }
  });
})();
