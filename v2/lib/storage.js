const DB_NAME = "qdii-vault-db";
const DB_VERSION = 1;
const STORE_VAULT = "vault";
const STORE_EVENTS = "events";
const STORE_DAILY_NAV = "daily_nav";
const STORE_CONFIG = "config";
const VAULT_KEY = "current";

let dbPromise = null;
let bundleCache = null;
const configCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

function ensureIndexedDbSupport() {
  if (!("indexedDB" in globalThis)) {
    throw new Error("当前浏览器不支持 IndexedDB");
  }
}

function ensureStore(database, transaction, storeName, options) {
  if (database.objectStoreNames.contains(storeName)) {
    return transaction.objectStore(storeName);
  }
  return database.createObjectStore(storeName, options);
}

function openDatabase() {
  if (dbPromise) return dbPromise;

  ensureIndexedDbSupport();
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;

      ensureStore(database, transaction, STORE_VAULT);
      ensureStore(database, transaction, STORE_CONFIG);

      const eventsStore = ensureStore(database, transaction, STORE_EVENTS, { keyPath: "id", autoIncrement: true });
      if (!eventsStore.indexNames.contains("accountId")) {
        eventsStore.createIndex("accountId", "accountId", { unique: false });
      }
      if (!eventsStore.indexNames.contains("date")) {
        eventsStore.createIndex("date", "date", { unique: false });
      }
      if (!eventsStore.indexNames.contains("accountDate")) {
        eventsStore.createIndex("accountDate", "accountDate", { unique: false });
      }
      if (!eventsStore.indexNames.contains("typeAccount")) {
        eventsStore.createIndex("typeAccount", "typeAccount", { unique: false });
      }
      if (!eventsStore.indexNames.contains("accountTypeDate")) {
        eventsStore.createIndex("accountTypeDate", "accountTypeDate", { unique: false });
      }

      const dailyNavStore = ensureStore(database, transaction, STORE_DAILY_NAV, { keyPath: "id", autoIncrement: true });
      if (!dailyNavStore.indexNames.contains("accountDate")) {
        dailyNavStore.createIndex("accountDate", "accountDate", { unique: true });
      }
      if (!dailyNavStore.indexNames.contains("date")) {
        dailyNavStore.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });

  return dbPromise;
}

async function getDatabase() {
  return openDatabase();
}

async function idbGet(storeName, key) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const result = await requestToPromise(transaction.objectStore(storeName).get(key));
  await transactionDone(transaction);
  return result;
}

async function idbGetAll(storeName) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const result = await requestToPromise(transaction.objectStore(storeName).getAll());
  await transactionDone(transaction);
  return result;
}

async function idbPut(storeName, value, key) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  if (key === undefined) {
    store.put(value);
  } else {
    store.put(value, key);
  }
  await transactionDone(transaction);
}

async function idbDelete(storeName, key) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

async function idbClear(storeName) {
  const database = await getDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).clear();
  await transactionDone(transaction);
}

async function loadBundleCache() {
  const record = await idbGet(STORE_VAULT, VAULT_KEY);
  bundleCache = record?.bundle ? cloneValue(record.bundle) : null;
  return bundleCache;
}

async function loadConfigCache() {
  const items = await idbGetAll(STORE_CONFIG);
  configCache.clear();
  items.forEach((item) => {
    if (!item || typeof item.key !== "string") return;
    configCache.set(item.key, cloneValue(item.value));
  });
}

async function migrateLegacyBundle(legacyBundleKey) {
  if (!legacyBundleKey) return;
  const existing = await idbGet(STORE_VAULT, VAULT_KEY);
  if (existing?.bundle) return;

  const text = localStorage.getItem(legacyBundleKey);
  if (!text) return;

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return;
    await idbPut(
      STORE_VAULT,
      {
        bundle: parsed,
        updatedAt: nowIso(),
      },
      VAULT_KEY,
    );
  } catch {
    // Ignore broken legacy bundle and let the app continue.
  }
}

async function migrateLegacyConfig(configMigrations = []) {
  for (const migration of configMigrations) {
    if (!migration?.key || !migration.legacyKey || configCache.has(migration.key)) {
      continue;
    }

    const raw = localStorage.getItem(migration.legacyKey);
    if (raw === null || raw === undefined) continue;

    try {
      const parsed = typeof migration.parse === "function" ? migration.parse(raw) : raw;
      if (parsed === undefined) continue;
      await setConfigValue(migration.key, parsed);
    } catch {
      // Keep going even if one migration entry cannot be parsed.
    }
  }
}

function sortByTimestampAsc(items) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left?.timestamp || left?.updatedAt || 0).getTime();
    const rightTime = new Date(right?.timestamp || right?.updatedAt || 0).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return Number(left?.id || 0) - Number(right?.id || 0);
  });
}

function sortByDateAsc(items) {
  return [...items].sort((left, right) => {
    const leftKey = `${left?.date || ""}::${left?.timestamp || ""}`;
    const rightKey = `${right?.date || ""}::${right?.timestamp || ""}`;
    return leftKey.localeCompare(rightKey);
  });
}

export async function initStorage({ legacyBundleKey = null, configMigrations = [] } = {}) {
  await getDatabase();
  await migrateLegacyBundle(legacyBundleKey);
  await loadConfigCache();
  await migrateLegacyConfig(configMigrations);
  await loadConfigCache();
  await loadBundleCache();

  return {
    bundle: cloneValue(bundleCache),
    config: Object.fromEntries([...configCache.entries()].map(([key, value]) => [key, cloneValue(value)])),
  };
}

export function getBundle() {
  return cloneValue(bundleCache);
}

export async function setBundle(bundle) {
  bundleCache = bundle ? cloneValue(bundle) : null;
  await idbPut(
    STORE_VAULT,
    {
      bundle: bundleCache,
      updatedAt: nowIso(),
    },
    VAULT_KEY,
  );
}

export function getConfigValue(key, fallback = undefined) {
  if (!configCache.has(key)) return cloneValue(fallback);
  return cloneValue(configCache.get(key));
}

export async function setConfigValue(key, value) {
  configCache.set(key, cloneValue(value));
  await idbPut(STORE_CONFIG, { key, value: cloneValue(value), updatedAt: nowIso() }, key);
}

export async function deleteConfigValue(key) {
  configCache.delete(key);
  await idbDelete(STORE_CONFIG, key);
}

function enrichEventRecord(record) {
  const accountId = String(record?.accountId || "").trim();
  const type = String(record?.type || "").trim();
  const date = String(record?.date || "").trim();

  return {
    ...cloneValue(record),
    accountId,
    type,
    date,
    timestamp: String(record?.timestamp || nowIso()),
    accountDate: `${accountId}::${date}`,
    typeAccount: `${type}::${accountId}`,
    accountTypeDate: `${accountId}::${type}::${date}`,
  };
}

export async function appendHistoryEvent(record) {
  const database = await getDatabase();
  const transaction = database.transaction(STORE_EVENTS, "readwrite");
  transaction.objectStore(STORE_EVENTS).add(enrichEventRecord(record));
  await transactionDone(transaction);
}

export async function replaceDailyPriceSnapshot(record) {
  const normalized = enrichEventRecord({
    ...record,
    type: "PRICE_SNAPSHOT",
  });
  const database = await getDatabase();
  const transaction = database.transaction(STORE_EVENTS, "readwrite");
  const store = transaction.objectStore(STORE_EVENTS);
  const index = store.index("accountTypeDate");
  const existing = await requestToPromise(index.getAll(normalized.accountTypeDate));
  existing.forEach((item) => {
    if (item?.id !== undefined) {
      store.delete(item.id);
    }
  });
  store.add(normalized);
  await transactionDone(transaction);
}

export async function getAllEvents(accountId = null) {
  const events = await idbGetAll(STORE_EVENTS);
  const filtered = accountId ? events.filter((item) => item?.accountId === accountId) : events;
  return sortByTimestampAsc(filtered);
}

export async function getLatestEventByType(accountId, type) {
  const events = await getAllEvents(accountId);
  const filtered = events.filter((item) => item?.type === type);
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

export async function upsertDailyNav(record) {
  const accountId = String(record?.accountId || "").trim();
  const date = String(record?.date || "").trim();
  const accountDate = `${accountId}::${date}`;
  const database = await getDatabase();
  const transaction = database.transaction(STORE_DAILY_NAV, "readwrite");
  const store = transaction.objectStore(STORE_DAILY_NAV);
  const index = store.index("accountDate");
  const existing = await requestToPromise(index.get(accountDate));

  const nextRecord = {
    ...cloneValue(record),
    accountId,
    date,
    accountDate,
    timestamp: String(record?.timestamp || nowIso()),
  };

  if (existing?.id !== undefined) {
    nextRecord.id = existing.id;
  }

  store.put(nextRecord);
  await transactionDone(transaction);
}

export async function getDailyNavRows() {
  const rows = await idbGetAll(STORE_DAILY_NAV);
  return sortByDateAsc(rows);
}

export async function clearHistoryData() {
  await Promise.all([idbClear(STORE_EVENTS), idbClear(STORE_DAILY_NAV)]);
}

export async function exportHistoryPayload() {
  const [events, dailyNav] = await Promise.all([getAllEvents(), getDailyNavRows()]);
  return {
    version: 1,
    exportedAt: nowIso(),
    events,
    dailyNav,
  };
}

export async function importHistoryPayload(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const dailyNav = Array.isArray(payload?.dailyNav) ? payload.dailyNav : [];
  await clearHistoryData();

  for (const event of events) {
    await appendHistoryEvent(event);
  }

  for (const row of dailyNav) {
    await upsertDailyNav(row);
  }
}

function applyHoldingPatch(baseHolding, before = {}, after = {}) {
  const patched = { ...baseHolding };
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach((key) => {
    if (key in after) {
      patched[key] = cloneValue(after[key]);
    }
  });
  return patched;
}

export async function reconstructHoldingsAtDate(accountId, targetDate) {
  const events = (await getAllEvents(accountId)).filter((item) => item?.date && item.date <= targetDate);
  const baseline = [...events].reverse().find((item) => item?.type === "FULL_SNAPSHOT");
  if (!baseline) {
    return null;
  }

  let holdings = Array.isArray(baseline?.payload?.holdings) ? cloneValue(baseline.payload.holdings) : [];
  let settings = cloneValue(baseline?.payload?.settings || {});
  let accountDeleted = false;

  const laterEvents = events.filter((item) => {
    if (!item?.timestamp || !baseline?.timestamp) return false;
    return item.timestamp > baseline.timestamp;
  });

  laterEvents.forEach((event) => {
    if (event.type !== "HOLDINGS_CHANGE") return;
    const action = String(event?.payload?.action || "").trim().toUpperCase();

    if (action === "ADD" || action === "RESTORE") {
      const fullHolding = cloneValue(event?.payload?.holding || event?.payload?.after || null);
      if (!fullHolding?.id) return;
      const index = holdings.findIndex((item) => item?.id === fullHolding.id);
      if (index >= 0) {
        holdings[index] = { ...holdings[index], ...fullHolding, deleted: false, deletedAt: null };
      } else {
        holdings.push({ ...fullHolding, deleted: false, deletedAt: null });
      }
      return;
    }

    if (action === "UPDATE") {
      const index = holdings.findIndex((item) => item?.id === event?.payload?.holdingId);
      if (index < 0) return;
      holdings[index] = applyHoldingPatch(holdings[index], event?.payload?.before, event?.payload?.after);
      return;
    }

    if (action === "DELETE") {
      const index = holdings.findIndex((item) => item?.id === event?.payload?.holdingId);
      if (index < 0) return;
      holdings[index] = {
        ...holdings[index],
        deleted: true,
        deletedAt: event.timestamp,
      };
      return;
    }

    if (action === "REORDER") {
      const orderMap = new Map(
        (Array.isArray(event?.payload?.orders) ? event.payload.orders : []).map((item) => [item.holdingId, item.sortOrder]),
      );
      holdings = holdings.map((item) => {
        if (!orderMap.has(item.id)) return item;
        return {
          ...item,
          sortOrder: orderMap.get(item.id),
        };
      });
      return;
    }

    if (action === "SETTINGS_CHANGE") {
      settings = {
        ...settings,
        ...(cloneValue(event?.payload?.after || {}) || {}),
      };
      return;
    }

    if (action === "ACCOUNT_DELETE") {
      accountDeleted = true;
      return;
    }

    if (action === "ACCOUNT_RESTORE" || action === "ACCOUNT_ADD") {
      accountDeleted = false;
    }
  });

  const priceSnapshot =
    [...events].reverse().find((item) => item?.type === "PRICE_SNAPSHOT" && item?.date === targetDate) || null;

  return {
    date: targetDate,
    accountId,
    deleted: accountDeleted,
    holdings: holdings
      .filter((item) => !item?.deleted)
      .sort((left, right) => Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0)),
    settings,
    prices: cloneValue(priceSnapshot?.payload?.prices || {}),
    fx: cloneValue(priceSnapshot?.payload?.fx || null),
    baselineDate: baseline.date,
  };
}
