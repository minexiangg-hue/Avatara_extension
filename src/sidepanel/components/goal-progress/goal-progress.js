// ============================================================
// Avatara — <goal-progress> Web Component
// ============================================================
// Usage: <goal-progress current="15" target="30" unit="minutes" label="Read papers"></goal-progress>
// ============================================================

class GoalProgress extends HTMLElement {
  static get observedAttributes() { return ['current', 'target', 'unit', 'label']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const current = parseFloat(this.getAttribute('current')) || 0;
    const target = parseFloat(this.getAttribute('target')) || 1;
    const unit = this.getAttribute('unit') || 'minutes';
    const label = this.getAttribute('label') || '';
    const pct = Math.min(100, Math.round((current / target) * 100));

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: var(--space-md, 12px);
          background: var(--color-surface, #1c1c2a);
          border: 1px solid var(--color-border, #2a2a3c);
          border-radius: var(--radius-md, 8px);
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-sm, 8px);
        }
        .label { font-size: var(--text-sm, 13px); font-weight: var(--font-weight-medium, 500); }
        .stats { font-size: var(--text-xs, 11px); color: var(--color-text-muted, #6b6b80); }
        .bar {
          width: 100%; height: 4px;
          background: var(--color-bg-tertiary, #222233);
          border-radius: var(--radius-full, 9999px);
          overflow: hidden;
        }
        .fill {
          height: 100%;
          background: ${pct >= 100 ? 'var(--color-success, #5aab8a)' : 'var(--color-accent, #c4a35a)'};
          border-radius: var(--radius-full, 9999px);
          width: ${pct}%;
          transition: width var(--transition-slow, 400ms) var(--ease-out, ease);
        }
      </style>
      <div class="header">
        <span class="label">${label}</span>
        <span class="stats">${current} / ${target} ${unit} (${pct}%)</span>
      </div>
      <div class="bar"><div class="fill"></div></div>
    `;
  }
}

customElements.define('goal-progress', GoalProgress);
