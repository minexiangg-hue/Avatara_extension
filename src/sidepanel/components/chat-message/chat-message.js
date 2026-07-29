// ============================================================
// Avatara — <chat-message> Web Component
// ============================================================
// Usage: <chat-message role="user|assistant" timestamp="ISO">
//          Message content (markdown-ish text)
//        </chat-message>
// ============================================================

class ChatMessage extends HTMLElement {
  static get observedAttributes() { return ['role', 'timestamp', 'loading']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const role = this.getAttribute('role') || 'assistant';
    const timestamp = this.getAttribute('timestamp') || '';
    const loading = this.hasAttribute('loading');
    const isUser = role === 'user';

    const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          padding: var(--space-sm) var(--space-lg);
          animation: fadeIn var(--transition-normal, 250ms) var(--ease-out, ease);
        }
        :host([role="user"]) { align-items: flex-end; }
        :host([role="assistant"]) { align-items: flex-start; }

        .bubble {
          max-width: 85%;
          padding: var(--space-sm) var(--space-md);
          border-radius: var(--radius-lg, 12px);
          font-size: var(--text-sm, 13px);
          line-height: var(--leading-normal, 1.5);
          word-wrap: break-word;
          white-space: pre-wrap;
        }

        :host([role="user"]) .bubble {
          background: var(--color-accent, #c4a35a);
          color: var(--color-accent-text, #0f0f14);
          border-bottom-right-radius: var(--radius-sm, 4px);
        }

        :host([role="assistant"]) .bubble {
          background: var(--color-surface, #1c1c2a);
          color: var(--color-text-primary, #e4e4ec);
          border: 1px solid var(--color-border, #2a2a3c);
          border-bottom-left-radius: var(--radius-sm, 4px);
        }

        :host([loading]) .bubble {
          opacity: 0.6;
          animation: pulse 1.5s infinite;
        }

        .time {
          font-size: var(--text-xs, 11px);
          color: var(--color-text-muted, #6b6b80);
          margin-top: 2px;
          padding: 0 var(--space-xs, 4px);
        }

        /* Simple markdown rendering */
        .bubble a { color: inherit; text-decoration: underline; }
        .bubble strong, .bubble b { font-weight: var(--font-weight-semibold, 600); }
        .bubble em, .bubble i { font-style: italic; }
        .bubble code {
          font-family: var(--font-mono, monospace);
          font-size: var(--text-xs, 11px);
          background: rgba(0,0,0,0.2);
          padding: 1px 4px;
          border-radius: 2px;
        }
      </style>
      <div class="bubble">
        <slot>${loading ? '…' : this._formatContent(this.innerHTML)}</slot>
      </div>
      ${time ? `<div class="time">${time}</div>` : ''}
    `;
  }

  /** Simple inline markdown rendering for links, bold, italic, code */
  _formatContent(html) {
    // The slot handles inner HTML, but we want to sanitize just a bit
    return html;
  }
}

customElements.define('chat-message', ChatMessage);
