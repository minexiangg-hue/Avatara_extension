// ============================================================
// Avatara — Page Content Extractor
// ============================================================
// Lightweight page metadata extraction.  Injects a small script
// into the target tab to read title, description, h1s, Open Graph
// tags, article tags, and canonical URL.
//
// IMPORTANT: chrome.scripting.executeScript *requires* host
// permissions or activeTab for the target tab.  If the permission
// is absent the call will fail silently (error is logged).
// ============================================================

import { logger } from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract metadata from a tab's current page.
 *
 * Uses chrome.scripting.executeScript to inject a self-contained function
 * that reads DOM values and returns a plain object.
 *
 * @param {number} tabId
 * @returns {Promise<object|null>} extracted metadata or null on failure
 */
export async function extractPageMetadata(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: _extractFromDOM,
      // We don't need the result back in a specific frame; the main frame
      // (frameIds: [0] by default) is sufficient.
    });

    const metadata = results?.[0]?.result;
    if (metadata) {
      logger.debug('ContentExtractor', `Extracted metadata for tab ${tabId}`, {
        title: metadata.title,
      });
    }
    return metadata || null;
  } catch (err) {
    // This will throw if we don't have scripting access to the tab.
    // That's expected for most pages without host permissions.
    logger.debug(
      'ContentExtractor',
      `Cannot extract from tab ${tabId}: ${err.message}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Injected function — runs in the page context, cannot access closures
// ---------------------------------------------------------------------------

/**
 * Self-contained function executed in the page via scripting.executeScript.
 * Returns a plain object (no DOM nodes — must be structured-clone safe).
 * @returns {object}
 */
function _extractFromDOM() {
  const meta = {};

  // Title
  meta.title = document.title || '';

  // Meta description
  const descEl = document.querySelector('meta[name="description"]');
  if (descEl) {
    meta.description = descEl.getAttribute('content') || '';
  }

  // First few H1s (cap at 5 to avoid huge payloads)
  const h1s = document.querySelectorAll('h1');
  meta.h1s = [];
  for (let i = 0; i < Math.min(h1s.length, 5); i++) {
    const text = (h1s[i].textContent || '').trim();
    if (text) meta.h1s.push(text);
  }

  // Open Graph tags
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    meta.ogTitle = ogTitle.getAttribute('content') || '';
  }

  const ogDescription = document.querySelector(
    'meta[property="og:description"]',
  );
  if (ogDescription) {
    meta.ogDescription = ogDescription.getAttribute('content') || '';
  }

  // Article tags
  const tagElements = document.querySelectorAll('meta[property="article:tag"]');
  meta.tags = [];
  for (let i = 0; i < tagElements.length; i++) {
    const tag = (tagElements[i].getAttribute('content') || '').trim();
    if (tag) meta.tags.push(tag);
  }

  // Canonical URL
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    meta.canonicalUrl = canonical.getAttribute('href') || '';
  }

  return meta;
}
