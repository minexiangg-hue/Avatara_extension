// ============================================================
// Avatara — <insight-card> Web Component
// ============================================================
// Usage: <insight-card type="stats|trend|alert" title="Today">
//          Content here
//        </insight-card>
// ============================================================

class InsightCard extends HTMLElement {
  static get observedAttributes() { return ['type', 'title']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const type = this.getAttribute('type') || 'stats';
    const title = this.getAttribute('title') || '';

    const icons = { stats: '📊', trend: '📈', alert: '🔔' };
    const colors = { stats: 'var(--color-accent)', trend: 'var(--color-warning)', alert: 'var(--color-danger)' };

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .card {
          background: var(--color-surface, #1c1c2a);
          border: 1px solid var(--color-border, #2a2a3c);
          border-radius: var(--radius-lg, 12px);
          padding: var(--space-lg, 16px);
          animation: slideUp var(--transition-normal, 250ms) var(--ease-out, ease);
        }
        .header {
          display: flex;
          align-items: center;
          gap: var(--space-sm, 8px);
          margin-bottom: var(--space-md, 12px);
          font-size: var(--text-xs, 11px);
          font-weight: var(--font-weight-semibold, 600);
          color: var(--color-text-muted, #6b6b80);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .header-dot {
          width: 6px; height: 6px;
          border-radius: var(--radius-full, 50%);
          background: ${colors[type] || colors.stats};
        }
        .content {
          color: var(--color-text-primary, #e4e4ec);
        }
      </style>
      <div class="card">
        <div class="header">
          <span class="header-dot"></span>
          ${title}
        </div>
        <div class="content">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

customElements.define('insight-card', InsightCard);
