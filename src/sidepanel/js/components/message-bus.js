// ============================================================
// Avatara — Message Bus (UI-internal pub/sub)
// ============================================================
// Lightweight event system for communication between
// side panel views. Separate from chrome.runtime messages.
// ============================================================

const listeners = {};

export const bus = {
  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    // Return unsubscribe function
    return () => this.off(event, fn);
  },

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} fn
   */
  off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  },

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    if (!listeners[event]) return;
    for (const fn of listeners[event]) {
      try { fn(data); } catch (e) { console.error(`[bus] ${event} handler error:`, e); }
    }
  },
};
