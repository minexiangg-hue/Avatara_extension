// ============================================================
// Avatara — Chat View
// ============================================================

import { i18n } from '../../../shared/i18n.js';
import { sendToBackground } from '../app.js';
import * as MT from '../../../shared/message-types.js';

let messages = [];
let mounted = false;

export function mount(container) {
  if (mounted) return;
  mounted = true;
  setupSuggestions();
  setupInput();
}

function setupSuggestions() {
  const el = document.getElementById('chatSuggestions');
  if (!el) return;
  const examples = ['chatExample1', 'chatExample2', 'chatExample3', 'chatExample4'];
  el.innerHTML = examples.map(key =>
    `<button class="tag chat-suggestion" data-query-key="${key}">${i18n.t(key)}</button>`
  ).join('');

  el.querySelectorAll('.chat-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('chatInput');
      if (input) {
        input.value = i18n.t(btn.dataset.queryKey);
        sendMessage();
      }
    });
  });
}

function setupInput() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  if (!input || !sendBtn) return;

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';

  // Add user message
  addMessage('user', text);

  // Show loading
  const loadingId = addMessage('assistant', '…', true);

  try {
    // Determine intent: search or command
    const isCommand = /group|archive|close|remind|goal|set|分组|归档|提醒|目标|设定/i.test(text);
    const msgType = isCommand ? MT.BUTLER.NL_COMMAND : MT.BUTLER.NL_SEARCH;

    const response = await sendToBackground(msgType, { query: text });

    // Remove loading
    removeMessage(loadingId);

    // Format response
    if (response.error) {
      addMessage('assistant', `❌ ${response.error}`);
    } else if (response.results && response.results.length > 0) {
      const resultList = response.results.slice(0, 5).map((r, i) =>
        `${i + 1}. **[${r.title || 'Untitled'}](${r.url})** — ${r.snippet || ''}`
      ).join('\n');
      addMessage('assistant', `Found ${response.results.length} results:\n\n${resultList}`);
    } else if (response.result?.ok) {
      addMessage('assistant', `✓ Done. ${response.result.message || ''}`);
    } else {
      addMessage('assistant', 'I couldn\'t find anything matching that. Try a different query?');
    }
  } catch (err) {
    removeMessage(loadingId);
    addMessage('assistant', `❌ ${i18n.t('error')}`);
  }
}

function addMessage(role, content, isLoading = false) {
  const container = document.getElementById('chatMessages');
  if (!container) return null;

  // Remove empty state
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const el = document.createElement('chat-message');
  el.setAttribute('id', id);
  el.setAttribute('role', role);
  el.setAttribute('timestamp', new Date().toISOString());
  if (isLoading) el.setAttribute('loading', '');
  el.innerHTML = content;
  container.appendChild(el);

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;

  messages.push({ id, role, content });
  if (messages.length > 100) messages.shift();

  return id;
}

function removeMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}
