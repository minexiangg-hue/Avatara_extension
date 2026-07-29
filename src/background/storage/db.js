// ============================================================
// Avatara — IndexedDB Wrapper
// ============================================================
// All persistent data flows through here. IndexedDB is the only
// storage engine that works reliably in a service-worker context
// for larger-than-sync datasets.
// ============================================================

import { STORAGE } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';

const DB_NAME = STORAGE.DB_NAME;
const DB_VERSION = STORAGE.DB_VERSION;

// ---------------------------------------------------------------------------
// Connection cache — service workers can be terminated at any time so we
// must be prepared to reconnect.  A cached promise handles re-entrant opens.
// ---------------------------------------------------------------------------

/** @type {Promise<IDBDatabase>|null} */
let _dbPromise = null;

/**
 * Open (or return a cached) IndexedDB connection.
 * Object stores and indexes are created during the upgrade callback.
 * @returns {Promise<IDBDatabase>}
 */
function _getDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = /** @type {IDBDatabase} */ (event.target.result);
      logger.info('DB', `Upgrading database to v${DB_VERSION}…`);

      // --- experience_stream (source of truth for every browser event) ---
      if (!db.objectStoreNames.contains('experience_stream')) {
        const store = db.createObjectStore('experience_stream', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('idx_timestamp', 'timestamp', { unique: false });
        store.createIndex('idx_eventType', 'eventType', { unique: false });
      }

      // --- content_index (indexed pages: url is the natural key) ---
      if (!db.objectStoreNames.contains('content_index')) {
        const store = db.createObjectStore('content_index', {
          keyPath: 'url',
        });
        store.createIndex('idx_title', 'title', { unique: false });
        store.createIndex('idx_tags', 'tags', {
          unique: false,
          multiEntry: true,
        });
        store.createIndex('idx_timestamp', 'timestamp', { unique: false });
      }

      // --- knowledge (keyed structured data: interest_graph, patterns…) ---
      if (!db.objectStoreNames.contains('knowledge')) {
        db.createObjectStore('knowledge', { keyPath: 'key' });
      }

      // --- goals (user-defined goals) ---
      if (!db.objectStoreNames.contains('goals')) {
        db.createObjectStore('goals', { keyPath: 'id', autoIncrement: true });
      }

      // --- alerts (proactive notifications) ---
      if (!db.objectStoreNames.contains('alerts')) {
        const store = db.createObjectStore('alerts', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('idx_timestamp', 'timestamp', { unique: false });
        store.createIndex('idx_dismissed', 'dismissed', { unique: false });
      }

      // --- commands_log (NL queries audit trail) ---
      if (!db.objectStoreNames.contains('commands_log')) {
        const store = db.createObjectStore('commands_log', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('idx_timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = /** @type {IDBDatabase} */ (event.target.result);

      // If the connection is lost (e.g. another tab triggers an upgrade)
      // clear the cache so the next call re-opens.
      db.onclose = () => {
        _dbPromise = null;
        logger.debug('DB', 'Connection closed');
      };
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
        logger.debug('DB', 'Version change — connection closed');
      };

      resolve(db);
    };

    request.onerror = (event) => {
      logger.error('DB', 'Failed to open database', event.target.error);
      _dbPromise = null;
      reject(event.target.error);
    };
  });

  return _dbPromise;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a single IDBRequest in a promise.
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function _promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Open a readwrite transaction on a named store.
 * @param {IDBDatabase} db
 * @param {string} name
 * @returns {IDBObjectStore}
 */
function _rw(db, name) {
  return db.transaction(name, 'readwrite').objectStore(name);
}

/**
 * Open a readonly transaction on a named store.
 * @param {IDBDatabase} db
 * @param {string} name
 * @returns {IDBObjectStore}
 */
function _ro(db, name) {
  return db.transaction(name, 'readonly').objectStore(name);
}

// ---------------------------------------------------------------------------
// Experience stream
// ---------------------------------------------------------------------------

/**
 * Insert a single experience stream entry.
 * @param {{ timestamp: string, eventType: string, data: object }} entry
 * @returns {Promise<number>} the auto-generated id
 */
export async function addExperience(entry) {
  const db = await _getDB();
  return _promisify(_rw(db, 'experience_stream').add(entry));
}

/**
 * Insert multiple experience entries in a single transaction.
 * @param {Array<{ timestamp: string, eventType: string, data: object }>} entries
 * @returns {Promise<number>} number of entries inserted
 */
export async function batchAddExperiences(entries) {
  if (!entries.length) return 0;
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('experience_stream', 'readwrite');
    const store = tx.objectStore('experience_stream');
    let count = 0;
    for (const entry of entries) {
      store.add(entry);
      count++;
    }
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Query experience stream entries.
 * Pass `hours` to get recent entries; `eventType` to filter by type; both together.
 * @param {{ hours?: number, eventType?: string, limit?: number, since?: string }} [opts]
 * @returns {Promise<Array<{ id: number, timestamp: string, eventType: string, data: object }>>}
 */
export async function queryExperiences(opts = {}) {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('experience_stream', 'readonly');
    const store = tx.objectStore('experience_stream');
    const results = [];

    // Determine which cursor to open
    let cursorRequest;

    if (opts.since) {
      // Query by timestamp lower bound (ISO strings sort lexicographically)
      const index = store.index('idx_timestamp');
      const range = IDBKeyRange.lowerBound(opts.since);
      cursorRequest = index.openCursor(range, 'prev');
    } else if (opts.hours && opts.eventType) {
      // Both filters — iterate timestamp index and check eventType manually
      // (IndexedDB doesn't support compound filtering natively)
      const since = new Date(Date.now() - opts.hours * 3_600_000).toISOString();
      const index = store.index('idx_timestamp');
      const range = IDBKeyRange.lowerBound(since);
      cursorRequest = index.openCursor(range, 'prev');
    } else if (opts.hours) {
      const since = new Date(Date.now() - opts.hours * 3_600_000).toISOString();
      const index = store.index('idx_timestamp');
      cursorRequest = index.openCursor(IDBKeyRange.lowerBound(since), 'prev');
    } else if (opts.eventType) {
      const index = store.index('idx_eventType');
      cursorRequest = index.openCursor(IDBKeyRange.only(opts.eventType), 'prev');
    } else {
      cursorRequest = store.openCursor(null, 'prev');
    }

    cursorRequest.onsuccess = (event) => {
      const cursor = /** @type {IDBCursorWithValue} */ (event.target.result);
      if (!cursor) {
        resolve(results);
        return;
      }

      const entry = cursor.value;

      // If both filters are set, double-check the eventType match
      if (opts.eventType && opts.hours) {
        if (entry.eventType === opts.eventType) {
          results.push(entry);
        }
      } else {
        results.push(entry);
      }

      if (opts.limit && results.length >= opts.limit) {
        resolve(results);
      } else {
        cursor.continue();
      }
    };

    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

/**
 * Delete all experience entries older than the given ISO timestamp.
 * @param {string} olderThan - ISO timestamp
 * @returns {Promise<number>} number of entries deleted
 */
export async function deleteExperiencesOlderThan(olderThan) {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('experience_stream', 'readwrite');
    const store = tx.objectStore('experience_stream');
    const index = store.index('idx_timestamp');
    const range = IDBKeyRange.upperBound(olderThan, true); // exclusive
    let deleted = 0;

    const cursorRequest = index.openCursor(range);
    cursorRequest.onsuccess = (event) => {
      const cursor = /** @type {IDBCursorWithValue} */ (event.target.result);
      if (!cursor) {
        resolve(deleted);
        return;
      }
      cursor.delete();
      deleted++;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

// ---------------------------------------------------------------------------
// Content index
// ---------------------------------------------------------------------------

/**
 * Add or update a page in the content index.  Uses `put` so it upserts by URL.
 * @param {{ url: string, title: string, tags?: string[], timestamp: string,
 *           description?: string, domain?: string }} entry
 * @returns {Promise<string>} the url key
 */
export async function addToContentIndex(entry) {
  const db = await _getDB();
  return _promisify(_rw(db, 'content_index').put(entry));
}

/**
 * Query the content index.  If `query` is provided, does a simple substring
 * match against title and tags (case-insensitive).
 * @param {{ query?: string, limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function queryContentIndex(opts = {}) {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('content_index', 'readonly');
    const store = tx.objectStore('content_index');
    const results = [];
    const q = opts.query ? opts.query.toLowerCase() : '';

    const cursorRequest = store.openCursor(null, 'prev');
    cursorRequest.onsuccess = (event) => {
      const cursor = /** @type {IDBCursorWithValue} */ (event.target.result);
      if (!cursor) {
        resolve(results);
        return;
      }

      if (q) {
        const value = cursor.value;
        const titleMatch =
          value.title && value.title.toLowerCase().includes(q);
        const tagsMatch =
          value.tags &&
          value.tags.some((/** @type {string} */ t) =>
            t.toLowerCase().includes(q),
          );
        if (titleMatch || tagsMatch) {
          results.push(value);
        }
      } else {
        results.push(cursor.value);
      }

      if (opts.limit && results.length >= opts.limit) {
        resolve(results);
      } else {
        cursor.continue();
      }
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

// ---------------------------------------------------------------------------
// Knowledge (key-value with structured values)
// ---------------------------------------------------------------------------

/**
 * Retrieve a knowledge object by key.
 * @param {string} key - e.g. "interest_graph", "behavior_patterns"
 * @returns {Promise<object|undefined>}
 */
export async function getKnowledge(key) {
  const db = await _getDB();
  const result = await _promisify(_ro(db, 'knowledge').get(key));
  return result ? result.value : undefined;
}

/**
 * Store a knowledge object (upsert).
 * @param {string} key
 * @param {*} data - serialisable value stored under `value`
 * @returns {Promise<string>} the key
 */
export async function setKnowledge(key, data) {
  const db = await _getDB();
  return _promisify(_rw(db, 'knowledge').put({ key, value: data }));
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

/**
 * Add a new goal.
 * @param {{ description: string, target: number, unit: string,
 *           progress?: number, created: string, active?: boolean }} goal
 * @returns {Promise<number>} auto-generated id
 */
export async function addGoal(goal) {
  const db = await _getDB();
  return _promisify(_rw(db, 'goals').add(goal));
}

/**
 * Update fields on an existing goal.
 * @param {number} id
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateGoal(id, updates) {
  const db = await _getDB();
  const tx = db.transaction('goals', 'readwrite');
  const store = tx.objectStore('goals');
  const existing = await _promisify(store.get(id));
  if (!existing) {
    tx.abort();
    throw new Error(`Goal ${id} not found`);
  }
  Object.assign(existing, updates);
  store.put(existing);
  return _promisify(tx);
}

/**
 * Delete a goal by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteGoal(id) {
  const db = await _getDB();
  return _promisify(_rw(db, 'goals').delete(id));
}

/**
 * Return every goal (active and inactive).
 * @returns {Promise<object[]>}
 */
export async function getAllGoals() {
  const db = await _getDB();
  return _promisify(_ro(db, 'goals').getAll());
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Add an alert to the queue.
 * @param {{ type: string, title: string, body: string,
 *           data?: object, timestamp?: string, dismissed?: boolean }} alertCfg
 * @returns {Promise<number>} auto-generated id
 */
export async function addAlert(alertCfg) {
  const entry = {
    timestamp: new Date().toISOString(),
    dismissed: false,
    ...alertCfg,
  };
  const db = await _getDB();
  return _promisify(_rw(db, 'alerts').add(entry));
}

/**
 * Get all non-dismissed alerts.
 * @returns {Promise<object[]>}
 */
export async function getPendingAlerts() {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('alerts', 'readonly');
    const index = tx.objectStore('alerts').index('idx_dismissed');
    const range = IDBKeyRange.only(false);
    const request = index.getAll(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Mark an alert as dismissed.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function dismissAlert(id) {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('alerts', 'readwrite');
    const store = tx.objectStore('alerts');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const alert = getReq.result;
      if (!alert) {
        tx.abort();
        reject(new Error(`Alert ${id} not found`));
        return;
      }
      alert.dismissed = true;
      store.put(alert);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Utility — clear all data (for "Clear Data" setting)
// ---------------------------------------------------------------------------

/**
 * Delete all data from every object store.  Use with caution.
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  const db = await _getDB();
  const storeNames = Array.from(db.objectStoreNames);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
