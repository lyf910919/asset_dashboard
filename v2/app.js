import {
  appendHistoryEvent,
  deleteConfigValue,
  exportHistoryPayload,
  getAllEvents,
  getBundle,
  getConfigValue,
  getDailyNavRows,
  getLatestEventByType,
  importHistoryPayload,
  initStorage,
  reconstructHoldingsAtDate,
  replaceDailyPriceSnapshot,
  setBundle,
  setConfigValue,
  upsertDailyNav,
} from "./lib/storage.js?v=20260428-history-restore";
import { fetchDirectFxSnapshot, fetchFundSnapshots } from "./lib/market.js?v=20260428-history-restore";
import { readBackupGist, upsertBackupGist, verifyGistToken } from "./lib/gist.js?v=20260428-history-restore";
import { buildPerformanceScopeCatalog, computePerformanceReport } from "./lib/performance.js?v=20260428-history-restore";
const STORAGE_KEY = "qdii-vault-encrypted-v1";
const LEGACY_STORAGE_KEY = "qdii-dashboard-config-v1";
const REMEMBER_PASS_KEY = "qdii-remember-passphrase-v1";
const PASS_CACHE_KEY = "qdii-passphrase-cache-v1";
const QUOTE_SOURCE_HINTS_KEY = "qdii-quote-source-hints-v1";
const FUND_NAME_CACHE_KEY = "qdii-fund-name-cache-v1";
const GIST_TOKEN_KEY = "qdii-github-gist-token-v1";
const GIST_ID_KEY = "qdii-github-gist-id-v1";
const GIST_SYNCED_AT_KEY = "qdii-github-gist-synced-at-v1";
const GIST_URL_KEY = "qdii-github-gist-url-v1";
const KDF_ITERATIONS = 200000;
const SAVE_DEBOUNCE_MS = 800;
const SYNC_DEBOUNCE_MS = 30000;
const QUOTE_API_TIMEOUT_MS = 15000;
const QUOTE_BATCH_SIZE = 6;
const ALLOWED_INTERVALS = new Set([0, 30, 60, 180, 300]);
const DEFAULT_ACCOUNT_NAME = "默认账户";
const DEFAULT_GROUP_NAME = "未分组";
const ASSET_CLASS_ORDER = ["stock", "bond", "gold", "cash"];
const TREE_DEPTH_ORDER = ["fund", "group", "class"];
const PIE_LEVEL_ORDER = ["class", "group", "fund"];
const PERFORMANCE_PRESET_ORDER = ["3m", "6m", "ytd", "1y", "all", "custom"];
const PERFORMANCE_SCOPE_TYPES = ["portfolio", "class", "group", "holding"];
const PERFORMANCE_METRIC_MODES = ["nav", "return"];
const PERFORMANCE_PREVIEW_BACKUP_KEY = "qdii-performance-preview-history-backup-v1";
const PERFORMANCE_PREVIEW_META_KEY = "qdii-performance-preview-history-meta-v1";
const PERFORMANCE_PREVIEW_DAYS = 180;
const ASSET_CLASS_LABELS = {
  stock: "股票",
  bond: "债券",
  gold: "黄金",
  cash: "现金",
};
const PIE_COLORS = [
  "#2b8fb8",
  "#56b8d5",
  "#4d79bf",
  "#87a7d6",
  "#5ea8c2",
  "#7fc6d9",
  "#3f6fa3",
  "#90c9e6",
  "#6899b7",
  "#a1d1dd",
];
const DISPLAY_CURRENCY_LABELS = {
  cny: "人民币",
  usd: "美元",
};
const DISPLAY_CURRENCY_TO_CODE = {
  cny: "CNY",
  usd: "USD",
};
const SUPPORTED_CURRENCY_CODES = ["USD", "CNY", "HKD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD"];
const CURRENCY_SYMBOLS = {
  USD: "$",
  CNY: "¥",
  HKD: "HK$",
  EUR: "€",
  GBP: "£",
  JPY: "JP¥",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
};
const HOLDING_HISTORY_FIELDS = [
  "name",
  "code",
  "units",
  "cost",
  "manualAmount",
  "manualAmountCurrency",
  "manualPrice",
  "assetClass",
  "groupName",
  "sortOrder",
];
const SETTINGS_HISTORY_FIELDS = ["refreshInterval", "quotePreference", "displayCurrency", "groupTargets"];

const defaultHoldings = [
  {
    code: "018738",
    units: 1000,
    cost: null,
    assetClass: "stock",
    groupName: DEFAULT_GROUP_NAME,
  },
  {
    code: "012349",
    units: 3000,
    cost: null,
    assetClass: "stock",
    groupName: DEFAULT_GROUP_NAME,
  },
];

const el = {
  refreshBtn: document.querySelector("#refresh-btn"),
  status: document.querySelector("#status-text"),
  totalAsset: document.querySelector("#total-asset"),
  totalCost: document.querySelector("#total-cost"),
  totalPnl: document.querySelector("#total-pnl"),
  overviewDayChange: document.querySelector("#overview-day-change"),
  overviewDayChangePct: document.querySelector("#overview-day-change-pct"),
  lastRefresh: document.querySelector("#last-refresh"),
  interval: document.querySelector("#refresh-interval"),
  quotePreference: document.querySelector("#quote-preference"),
  exportBtn: document.querySelector("#export-btn"),
  importBtn: document.querySelector("#import-btn"),
  importFile: document.querySelector("#import-file"),
  exportHistoryBtn: document.querySelector("#export-history-btn"),
  importHistoryBtn: document.querySelector("#import-history-btn"),
  importHistoryFile: document.querySelector("#import-history-file"),
  exportDailyNavBtn: document.querySelector("#export-daily-nav-btn"),
  seedPreviewHistoryBtn: document.querySelector("#seed-preview-history-btn"),
  restorePreviewHistoryBtn: document.querySelector("#restore-preview-history-btn"),
  unlockOpenBtn: document.querySelector("#unlock-open-btn"),
  passphraseInput: document.querySelector("#passphrase-input"),
  unlockBtn: document.querySelector("#unlock-btn"),
  unlockCancelBtn: document.querySelector("#unlock-cancel-btn"),
  unlockModal: document.querySelector("#unlock-modal"),
  rememberPassphraseInput: document.querySelector("#remember-passphrase-input"),
  changePassBtn: document.querySelector("#change-pass-btn"),
  passwordModal: document.querySelector("#password-modal"),
  newPassphraseInput: document.querySelector("#new-passphrase-input"),
  confirmPassphraseInput: document.querySelector("#confirm-passphrase-input"),
  passwordSaveBtn: document.querySelector("#password-save-btn"),
  passwordCancelBtn: document.querySelector("#password-cancel-btn"),
  holdingModal: document.querySelector("#holding-modal"),
  holdingModalTitle: document.querySelector("#holding-modal-title"),
  holdingNameInput: document.querySelector("#holding-name-input"),
  holdingCodeInput: document.querySelector("#holding-code-input"),
  holdingManualAmountInput: document.querySelector("#holding-manual-amount-input"),
  holdingManualAmountCurrencyInput: document.querySelector("#holding-manual-amount-currency-input"),
  holdingUnitsInput: document.querySelector("#holding-units-input"),
  holdingClassInput: document.querySelector("#holding-class-input"),
  holdingGroupInput: document.querySelector("#holding-group-input"),
  holdingCostInput: document.querySelector("#holding-cost-input"),
  holdingManualPriceInput: document.querySelector("#holding-manual-price-input"),
  holdingSaveBtn: document.querySelector("#holding-save-btn"),
  holdingCancelBtn: document.querySelector("#holding-cancel-btn"),
  lockBtn: document.querySelector("#lock-btn"),
  syncBtn: document.querySelector("#sync-btn"),
  syncPullBtn: document.querySelector("#sync-pull-btn"),
  gistTokenInput: document.querySelector("#gist-token-input"),
  gistVerifyBtn: document.querySelector("#gist-verify-btn"),
  gistIdInput: document.querySelector("#gist-id-input"),
  vaultStatus: document.querySelector("#vault-status"),
  syncMeta: document.querySelector("#sync-meta"),
  gistLink: document.querySelector("#gist-link"),
  tabViewBtn: document.querySelector("#tab-view-btn"),
  tabPieBtn: document.querySelector("#tab-pie-btn"),
  tabPerformanceBtn: document.querySelector("#tab-performance-btn"),
  tabConfigBtn: document.querySelector("#tab-config-btn"),
  tabView: document.querySelector("#tab-view"),
  tabPie: document.querySelector("#tab-pie"),
  tabPerformance: document.querySelector("#tab-performance"),
  tabConfig: document.querySelector("#tab-config"),
  accountSelect: document.querySelector("#account-select"),
  displayCurrencyButtons: [...document.querySelectorAll("[data-display-currency]")],
  accountAddBtn: document.querySelector("#account-add-btn"),
  accountRenameBtn: document.querySelector("#account-rename-btn"),
  archiveOpenBtn: document.querySelector("#archive-open-btn"),
  accountDeleteBtn: document.querySelector("#account-delete-btn"),
  accountModal: document.querySelector("#account-modal"),
  accountModalTitle: document.querySelector("#account-modal-title"),
  accountNameInput: document.querySelector("#account-name-input"),
  accountSaveBtn: document.querySelector("#account-save-btn"),
  accountCancelBtn: document.querySelector("#account-cancel-btn"),
  viewSort: document.querySelector("#view-sort"),
  treeModeButtons: [...document.querySelectorAll("[data-tree-depth]")],
  pieLevel: document.querySelector("#pie-level"),
  pieModeButtons: [...document.querySelectorAll("[data-pie-level]")],
  pieDisplayButtons: [...document.querySelectorAll("[data-pie-display]")],
  viewTableBody: document.querySelector("#view-table-body"),
  pieCanvas: document.querySelector("#allocation-pie"),
  pieLegend: document.querySelector("#pie-legend"),
  pieSubtitle: document.querySelector("#pie-subtitle"),
  targetPieModeButtons: [...document.querySelectorAll("[data-target-pie-level]")],
  targetPieCanvas: document.querySelector("#target-allocation-pie"),
  targetPieLegend: document.querySelector("#target-pie-legend"),
  targetPieSubtitle: document.querySelector("#target-pie-subtitle"),
  groupTargetSummary: document.querySelector("#group-target-summary"),
  groupTargetList: document.querySelector("#group-target-list"),
  addRowBtn: document.querySelector("#add-row-btn"),
  quoteDebugSummary: document.querySelector("#quote-debug-summary"),
  quoteDebugChanges: document.querySelector("#quote-debug-changes"),
  quoteDebugCurrent: document.querySelector("#quote-debug-current"),
  quoteDebugClearBtn: document.querySelector("#quote-debug-clear-btn"),
  configList: document.querySelector("#config-list"),
  configTemplate: document.querySelector("#holding-config-template"),
  groupTargetModal: document.querySelector("#group-target-modal"),
  groupTargetModalTitle: document.querySelector("#group-target-modal-title"),
  groupTargetModalDesc: document.querySelector("#group-target-modal-desc"),
  groupTargetModalCurrent: document.querySelector("#group-target-modal-current"),
  groupTargetModalSummary: document.querySelector("#group-target-modal-summary"),
  groupTargetInput: document.querySelector("#group-target-input"),
  groupTargetSaveBtn: document.querySelector("#group-target-save-btn"),
  groupTargetClearBtn: document.querySelector("#group-target-clear-btn"),
  groupTargetCancelBtn: document.querySelector("#group-target-cancel-btn"),
  archiveModal: document.querySelector("#archive-modal"),
  archiveModalDesc: document.querySelector("#archive-modal-desc"),
  archiveAccountCount: document.querySelector("#archive-account-count"),
  archiveAccountList: document.querySelector("#archive-account-list"),
  archiveHoldingCount: document.querySelector("#archive-holding-count"),
  archiveHoldingList: document.querySelector("#archive-holding-list"),
  archiveCloseBtn: document.querySelector("#archive-close-btn"),
  deleteConfirmModal: document.querySelector("#delete-confirm-modal"),
  deleteConfirmTitle: document.querySelector("#delete-confirm-title"),
  deleteConfirmDesc: document.querySelector("#delete-confirm-desc"),
  deleteConfirmNote: document.querySelector("#delete-confirm-note"),
  deleteConfirmSubmitBtn: document.querySelector("#delete-confirm-submit-btn"),
  deleteConfirmCancelBtn: document.querySelector("#delete-confirm-cancel-btn"),
  historyReplayDateInput: document.querySelector("#history-replay-date-input"),
  historyReplayBtn: document.querySelector("#history-replay-btn"),
  historyReplayOutput: document.querySelector("#history-replay-output"),
  performancePresetButtons: [...document.querySelectorAll("[data-performance-preset]")],
  performanceStartDateInput: document.querySelector("#performance-start-date-input"),
  performanceEndDateInput: document.querySelector("#performance-end-date-input"),
  performanceScopeType: document.querySelector("#performance-scope-type"),
  performanceScopeTarget: document.querySelector("#performance-scope-target"),
  performanceMetricButtons: [...document.querySelectorAll("[data-performance-metric]")],
  performanceChart: document.querySelector("#performance-chart"),
  performancePointDetail: document.querySelector("#performance-point-detail"),
  performanceStatus: document.querySelector("#performance-status"),
  performanceTotalReturn: document.querySelector("#performance-total-return"),
  performanceXirr: document.querySelector("#performance-xirr"),
  performanceEndValue: document.querySelector("#performance-end-value"),
  performanceNetFlow: document.querySelector("#performance-net-flow"),
  performanceRangeMeta: document.querySelector("#performance-range-meta"),
  performanceFormulaMeta: document.querySelector("#performance-formula-meta"),
  performanceNotes: document.querySelector("#performance-notes"),
};

const state = {
  unlocked: false,
  passphrase: "",
  storageReady: false,
  vault: null,
  fxSnapshot: null,
  quoteMap: new Map(),
  collapsedClassKeys: new Set(),
  collapsedGroupKeys: new Set(),
  activeTab: "view",
  performancePreset: "3m",
  performanceStartDate: "",
  performanceEndDate: "",
  performanceScopeType: "portfolio",
  performanceScopeTarget: "",
  performanceMetricMode: "nav",
  performanceRenderToken: 0,
  performanceSelectedPointDate: "",
  performanceChartModel: null,
  autoTimer: null,
  persistTimer: null,
  syncTimer: null,
  syncInFlight: false,
  refreshInFlight: false,
  refreshQueued: false,
  resizeTimer: null,
  accountModalMode: "create",
  editingAccountId: null,
  holdingModalMode: "create",
  editingHoldingId: null,
  pieDisplayMode: "full",
  targetPieLevel: "group",
  editingGroupTargetKey: null,
  deleteConfirmContext: null,
  quoteDebugByAccount: {},
  pendingQuoteCodes: new Set(),
  gistUrl: "",
};

function nowIso() {
  return new Date().toISOString();
}

function parseIso(value) {
  const t = new Date(value || "").getTime();
  return Number.isFinite(t) ? t : 0;
}

function compareIso(a, b) {
  return parseIso(a) - parseIso(b);
}

function normalizeInterval(value) {
  const parsed = Number.parseInt(String(value), 10);
  return ALLOWED_INTERVALS.has(parsed) ? parsed : 60;
}

function normalizeQuotePreference(value) {
  return String(value || "").trim().toLowerCase() === "estimate" ? "estimate" : "nav";
}

function isLatestPriceMode(account = getActiveAccount()) {
  return normalizeQuotePreference(account?.settings?.quotePreference) === "estimate";
}

function normalizeDisplayCurrency(value) {
  return String(value || "").trim().toLowerCase() === "usd" ? "usd" : "cny";
}

function normalizeAssetClass(value) {
  const key = String(value || "").trim().toLowerCase();
  return ASSET_CLASS_ORDER.includes(key) ? key : "stock";
}

function normalizeGroupName(value) {
  const text = String(value || "").trim();
  return text || DEFAULT_GROUP_NAME;
}

function normalizeCurrencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return SUPPORTED_CURRENCY_CODES.includes(code) ? code : null;
}

function normalizeManualAmountCurrency(value) {
  const code = normalizeCurrencyCode(value);
  return code === "USD" || code === "CNY" ? code : null;
}

function inferCurrencyCodeFromText(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  if (/人民币|RMB|CNY/i.test(text)) return "CNY";
  if (/美元现汇|美元现钞|美元|USD/i.test(text)) return "USD";
  if (/港币|港元|HKD/i.test(text)) return "HKD";
  if (/欧元|EUR/i.test(text)) return "EUR";
  if (/英镑|GBP/i.test(text)) return "GBP";
  if (/日元|JPY/i.test(text)) return "JPY";
  if (/澳元|AUD/i.test(text)) return "AUD";
  if (/加元|CAD/i.test(text)) return "CAD";
  if (/新加坡元|SGD/i.test(text)) return "SGD";
  return null;
}

function isLikelyExchangeFundCode(code) {
  return /^(5\d{5}|15\d{4}|18\d{4})$/.test(String(code || "").trim());
}

function resolveManualAmountCurrency(holding) {
  return normalizeManualAmountCurrency(holding?.manualAmountCurrency) || "CNY";
}

function buildGroupCompositeKey(classKey, groupName) {
  return `${normalizeAssetClass(classKey)}::${normalizeGroupName(groupName)}`;
}

function parseGroupCompositeKey(value) {
  const text = String(value || "").trim();
  const separatorIndex = text.indexOf("::");
  if (separatorIndex < 0) {
    return {
      classKey: "stock",
      groupName: normalizeGroupName(text),
    };
  }

  return {
    classKey: normalizeAssetClass(text.slice(0, separatorIndex)),
    groupName: normalizeGroupName(text.slice(separatorIndex + 2)),
  };
}

function normalizeStoredTargetShare(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed <= 1) return parsed;
  if (parsed <= 100) return parsed / 100;
  return null;
}

function parseTargetShareFromPercentInput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return Number.NaN;
  if (parsed < 0 || parsed > 100) return Number.NaN;
  if (parsed === 0) return null;
  return parsed / 100;
}

function normalizeGroupTargets(input) {
  if (!input || typeof input !== "object") return {};

  const normalized = {};
  Object.entries(input).forEach(([rawKey, rawValue]) => {
    const { classKey, groupName } = parseGroupCompositeKey(rawKey);
    const targetShare = normalizeStoredTargetShare(rawValue);
    if (!(targetShare > 0)) return;
    normalized[buildGroupCompositeKey(classKey, groupName)] = targetShare;
  });

  return normalized;
}

function normalizeSortOrder(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getHoldingOrderValue(holding) {
  return normalizeSortOrder(holding?.sortOrder) ?? Number.MAX_SAFE_INTEGER;
}

function sortActiveHoldingsByDefaultOrder(holdings) {
  return [...holdings].sort((a, b) => {
    const orderDiff = getHoldingOrderValue(a) - getHoldingOrderValue(b);
    if (orderDiff !== 0) return orderDiff;
    return compareIso(a.updatedAt, b.updatedAt);
  });
}

function reindexHoldingSortOrders(holdings) {
  const activeSorted = sortActiveHoldingsByDefaultOrder(holdings.filter((item) => !item.deleted));
  activeSorted.forEach((item, index) => {
    item.sortOrder = index + 1;
  });
}

function getHoldingGroupName(holding) {
  return normalizeGroupName(holding?.groupName);
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeHolding(input) {
  const rawCost = input?.cost;
  const normalizedCost =
    rawCost === "" || rawCost === null || rawCost === undefined
      ? null
      : Number.isFinite(Number(rawCost))
        ? Number(rawCost)
        : null;
  const rawManualPrice = input?.manualPrice;
  const normalizedManualPrice =
    rawManualPrice === "" || rawManualPrice === null || rawManualPrice === undefined
      ? null
      : Number.isFinite(Number(rawManualPrice))
        ? Number(rawManualPrice)
        : null;
  const rawManualAmount = input?.manualAmount;
  const normalizedManualAmount =
    rawManualAmount === "" || rawManualAmount === null || rawManualAmount === undefined
      ? null
      : Number.isFinite(Number(rawManualAmount))
        ? Number(rawManualAmount)
        : null;
  const normalizedManualAmountCurrency = normalizeManualAmountCurrency(input?.manualAmountCurrency) || "CNY";

  const deleted = Boolean(input?.deleted);

  return {
    id: String(input?.id || randomId()),
    name: String(input?.name || "").trim(),
    code: String(input?.code || "").trim(),
    units: Number.isFinite(Number(input?.units)) ? Number(input.units) : 0,
    cost: normalizedCost,
    manualAmount: normalizedManualAmount,
    manualAmountCurrency: normalizedManualAmountCurrency,
    manualPrice: normalizedManualPrice,
    assetClass: normalizeAssetClass(input?.assetClass),
    groupName: normalizeGroupName(input?.groupName),
    sortOrder: normalizeSortOrder(input?.sortOrder),
    deleted,
    deletedAt: deleted ? input?.deletedAt || input?.updatedAt || nowIso() : null,
    updatedAt: input?.updatedAt || nowIso(),
  };
}

function createHolding(seed = {}) {
  return normalizeHolding({
    id: seed.id,
    name: seed.name || "",
    code: seed.code || "",
    units: seed.units ?? 0,
    cost: seed.cost ?? null,
    manualAmount: seed.manualAmount ?? null,
    manualAmountCurrency: seed.manualAmountCurrency ?? "CNY",
    manualPrice: seed.manualPrice ?? null,
    assetClass: seed.assetClass ?? "stock",
    groupName: seed.groupName ?? DEFAULT_GROUP_NAME,
    sortOrder: seed.sortOrder,
    deleted: false,
    updatedAt: nowIso(),
  });
}

function normalizeAccountName(value, fallback = DEFAULT_ACCOUNT_NAME) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeAccount(input, index = 0) {
  const holdings = Array.isArray(input?.holdings) ? input.holdings.map((item) => normalizeHolding(item)) : [];
  reindexHoldingSortOrders(holdings);
  const deleted = Boolean(input?.deleted);

  return {
    id: String(input?.id || randomId()),
    name: normalizeAccountName(input?.name, `${DEFAULT_ACCOUNT_NAME}${index > 0 ? ` ${index + 1}` : ""}`),
    holdings,
    deleted,
    deletedAt: deleted ? input?.deletedAt || input?.updatedAt || nowIso() : null,
    settings: {
      refreshInterval: normalizeInterval(input?.settings?.refreshInterval),
      quotePreference: normalizeQuotePreference(input?.settings?.quotePreference),
      displayCurrency: normalizeDisplayCurrency(input?.settings?.displayCurrency),
      groupTargets: normalizeGroupTargets(input?.settings?.groupTargets),
    },
    settingsUpdatedAt: input?.settingsUpdatedAt || nowIso(),
    updatedAt: input?.updatedAt || nowIso(),
  };
}

function createAccount(seed = {}) {
  return normalizeAccount({
    id: seed.id,
    name: seed.name,
    holdings: Array.isArray(seed.holdings) ? seed.holdings : [],
    deleted: false,
    settings: {
      refreshInterval: normalizeInterval(seed?.settings?.refreshInterval ?? 60),
      quotePreference: normalizeQuotePreference(seed?.settings?.quotePreference ?? "nav"),
      displayCurrency: normalizeDisplayCurrency(seed?.settings?.displayCurrency ?? "cny"),
      groupTargets: normalizeGroupTargets(seed?.settings?.groupTargets),
    },
    settingsUpdatedAt: seed.settingsUpdatedAt || nowIso(),
    updatedAt: seed.updatedAt || nowIso(),
  });
}

function createVaultFromHoldings(holdings) {
  const account = createAccount({
    name: DEFAULT_ACCOUNT_NAME,
    holdings: holdings.map((item) => normalizeHolding(item)),
    settings: { refreshInterval: 60, quotePreference: "nav", displayCurrency: "cny", groupTargets: {} },
  });
  return normalizeVault({
    version: 2,
    accounts: [account],
    activeAccountId: account.id,
    updatedAt: nowIso(),
  });
}

function normalizeVault(vault) {
  const accountsRaw = Array.isArray(vault?.accounts)
    ? vault.accounts
    : [
        {
          id: String(vault?.activeAccountId || "legacy-default"),
          name: DEFAULT_ACCOUNT_NAME,
          holdings: Array.isArray(vault?.holdings) ? vault.holdings : [],
          settings: vault?.settings || { refreshInterval: 60, quotePreference: "nav", displayCurrency: "cny", groupTargets: {} },
          settingsUpdatedAt: vault?.settingsUpdatedAt || nowIso(),
          updatedAt: vault?.updatedAt || nowIso(),
        },
      ];

  const accounts = accountsRaw.map((account, index) => normalizeAccount(account, index));
  if (accounts.length === 0 || !accounts.some((account) => !account.deleted)) {
    accounts.push(createAccount({ name: DEFAULT_ACCOUNT_NAME }));
  }

  let activeAccountId = String(vault?.activeAccountId || "").trim();
  const activeAccounts = accounts.filter((account) => !account.deleted);
  if (!activeAccounts.some((account) => account.id === activeAccountId)) {
    activeAccountId = activeAccounts[0]?.id || accounts[0]?.id || "";
  }

  const latestAccountUpdatedAt =
    accounts.length > 0 ? accounts.reduce((latest, account) => (compareIso(account.updatedAt, latest) > 0 ? account.updatedAt : latest), accounts[0].updatedAt) : nowIso();

  return {
    version: 2,
    accounts,
    activeAccountId,
    updatedAt: vault?.updatedAt || latestAccountUpdatedAt || nowIso(),
  };
}

function mergeAccounts(localAccount, remoteAccount) {
  const local = normalizeAccount(localAccount);
  const remote = normalizeAccount(remoteAccount);
  const remoteNewer = compareIso(remote.updatedAt, local.updatedAt) > 0;

  const map = new Map();
  const mergedSettings =
    compareIso(remote.settingsUpdatedAt, local.settingsUpdatedAt) > 0 ? remote.settings : local.settings;

  const upsert = (item) => {
    const normalized = normalizeHolding(item);
    const existing = map.get(normalized.id);
    if (!existing || compareIso(normalized.updatedAt, existing.updatedAt) > 0) {
      map.set(normalized.id, normalized);
    }
  };

  local.holdings.forEach(upsert);
  remote.holdings.forEach(upsert);

  return normalizeAccount({
    id: local.id,
    name: remoteNewer ? remote.name : local.name,
    holdings: [...map.values()],
    deleted: remoteNewer ? remote.deleted : local.deleted,
    deletedAt: remoteNewer ? remote.deletedAt : local.deletedAt,
    settings: mergedSettings,
    settingsUpdatedAt:
      compareIso(remote.settingsUpdatedAt, local.settingsUpdatedAt) > 0 ? remote.settingsUpdatedAt : local.settingsUpdatedAt,
    updatedAt: remoteNewer ? remote.updatedAt : local.updatedAt,
  });
}

function mergeVaults(localVault, remoteVault) {
  if (!localVault && !remoteVault) return null;
  if (!localVault) return normalizeVault(remoteVault);
  if (!remoteVault) return normalizeVault(localVault);

  const local = normalizeVault(localVault);
  const remote = normalizeVault(remoteVault);
  const byId = new Map();
  const localMap = new Map(local.accounts.map((item) => [item.id, item]));
  const remoteMap = new Map(remote.accounts.map((item) => [item.id, item]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  allIds.forEach((id) => {
    const localAccount = localMap.get(id);
    const remoteAccount = remoteMap.get(id);
    if (localAccount && remoteAccount) {
      byId.set(id, mergeAccounts(localAccount, remoteAccount));
    } else {
      byId.set(id, normalizeAccount(localAccount || remoteAccount));
    }
  });

  const accounts = [...byId.values()];
  const remoteNewer = compareIso(remote.updatedAt, local.updatedAt) > 0;
  const preferredActiveId = remoteNewer ? remote.activeAccountId : local.activeAccountId;
  const activeAccounts = accounts.filter((account) => !account.deleted);
  const activeAccountId = activeAccounts.some((account) => account.id === preferredActiveId)
    ? preferredActiveId
    : activeAccounts[0]?.id || accounts[0]?.id;

  return normalizeVault({
    version: 2,
    accounts,
    activeAccountId,
    updatedAt: compareIso(remote.updatedAt, local.updatedAt) > 0 ? remote.updatedAt : local.updatedAt,
  });
}

function ensureAtLeastOneAccount(vault = state.vault) {
  if (!vault) return;
  if (!Array.isArray(vault.accounts)) {
    vault.accounts = [];
  }
  if (vault.accounts.length === 0 || !vault.accounts.some((account) => !account.deleted)) {
    const account = createAccount({ name: DEFAULT_ACCOUNT_NAME });
    vault.accounts.push(account);
  }

  const activeAccounts = vault.accounts.filter((account) => !account.deleted);
  if (!activeAccounts.some((account) => account.id === vault.activeAccountId)) {
    vault.activeAccountId = activeAccounts[0]?.id || vault.accounts[0]?.id || "";
  }
}

function getVisibleAccounts(vault = state.vault) {
  if (!vault || !Array.isArray(vault.accounts)) return [];
  return vault.accounts.filter((account) => !account.deleted);
}

function getActiveAccount(vault = state.vault) {
  const activeAccounts = getVisibleAccounts(vault);
  return activeAccounts.find((account) => account.id === vault?.activeAccountId) || activeAccounts[0] || null;
}

function accountToActiveHoldings(account) {
  if (!account) return [];
  return account.holdings.filter((item) => !item.deleted);
}

function vaultToActiveHoldings(vault) {
  const account = getActiveAccount(vault);
  return accountToActiveHoldings(account);
}

function getNextSortOrder(vault = state.vault) {
  const account = getActiveAccount(vault);
  if (!account) return 1;
  const active = account.holdings.filter((item) => !item.deleted);
  if (active.length === 0) return 1;
  return Math.max(...active.map((item) => normalizeSortOrder(item.sortOrder) || 0)) + 1;
}

function applyActiveOrder(activeOrdered) {
  const account = getActiveAccount();
  if (!account) return;
  const activeMap = new Map(account.holdings.filter((item) => !item.deleted).map((item) => [item.id, item]));
  const deleted = account.holdings.filter((item) => item.deleted);

  const orderedActive = activeOrdered.map((item) => activeMap.get(item.id)).filter(Boolean);
  orderedActive.forEach((item, index) => {
    item.sortOrder = index + 1;
  });

  account.holdings = [...orderedActive, ...deleted];
}

function ensureAtLeastOneActiveHolding() {
  const account = getActiveAccount();
  if (!account || !state.vault) return;
  const active = accountToActiveHoldings(account);
  if (active.length > 0) return;

  const blank = createHolding({ sortOrder: getNextSortOrder(state.vault) });
  account.holdings.push(blank);
  reindexHoldingSortOrders(account.holdings);
  const stamp = nowIso();
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
}

function setPriceStatus(text, level = "normal") {
  el.status.textContent = text;
  el.status.classList.remove("is-good", "is-bad");
  if (level === "good") el.status.classList.add("is-good");
  if (level === "bad") el.status.classList.add("is-bad");
}

function setVaultStatus(text, level = "normal") {
  el.vaultStatus.textContent = text;
  el.vaultStatus.classList.remove("is-good", "is-bad");
  if (level === "good") el.vaultStatus.classList.add("is-good");
  if (level === "bad") el.vaultStatus.classList.add("is-bad");
}

function setSyncMeta(text) {
  el.syncMeta.textContent = text;
}

function formatLocalDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function syncGistInputsFromStorage() {
  if (el.gistTokenInput) {
    el.gistTokenInput.value = readGistToken();
  }
  if (el.gistIdInput) {
    el.gistIdInput.value = readGistId();
  }

  state.gistUrl = readGistUrl();
  if (el.gistLink) {
    if (state.gistUrl) {
      el.gistLink.href = state.gistUrl;
      el.gistLink.hidden = false;
    } else {
      el.gistLink.hidden = true;
      el.gistLink.removeAttribute("href");
    }
  }

  const syncedAt = readGistSyncedAt();
  setSyncMeta(syncedAt ? `Gist 备份：${formatLocalDateTime(syncedAt)}` : "Gist 备份：未完成");
}

function getCurrentDisplayCurrency() {
  const account = getActiveAccount();
  return normalizeDisplayCurrency(account?.settings?.displayCurrency);
}

function getDisplayCurrencyCode(displayCurrency = null) {
  return DISPLAY_CURRENCY_TO_CODE[normalizeDisplayCurrency(displayCurrency ?? getCurrentDisplayCurrency())] || "CNY";
}

function getDisplayCurrencyLabel(displayCurrency = null) {
  return DISPLAY_CURRENCY_LABELS[normalizeDisplayCurrency(displayCurrency ?? getCurrentDisplayCurrency())] || "人民币";
}

function getCurrencySymbol(currencyCode = "CNY") {
  return CURRENCY_SYMBOLS[normalizeCurrencyCode(currencyCode) || "CNY"] || `${currencyCode} `;
}

function getFxRateFromUsd(currencyCode) {
  const code = normalizeCurrencyCode(currencyCode);
  if (!code) return null;
  if (code === "USD") return 1;

  const rate = Number(state.fxSnapshot?.rates?.[code]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function convertMoneyAmount(value, fromCurrency = "CNY", toCurrency = getDisplayCurrencyCode()) {
  if (!Number.isFinite(value)) return null;

  const sourceCurrency = normalizeCurrencyCode(fromCurrency) || "CNY";
  const targetCurrency = normalizeCurrencyCode(toCurrency) || getDisplayCurrencyCode();
  if (sourceCurrency === targetCurrency) return value;

  let amountInUsd = null;
  if (sourceCurrency === "USD") {
    amountInUsd = value;
  } else {
    const usdToSource = getFxRateFromUsd(sourceCurrency);
    if (!Number.isFinite(usdToSource) || usdToSource <= 0) return null;
    amountInUsd = value / usdToSource;
  }

  if (targetCurrency === "USD") {
    return amountInUsd;
  }

  const usdToTarget = getFxRateFromUsd(targetCurrency);
  if (!Number.isFinite(usdToTarget) || usdToTarget <= 0) return null;
  return amountInUsd * usdToTarget;
}

function resolveHoldingCurrency(holding, quoteData = null) {
  return (
    normalizeCurrencyCode(quoteData?.currency) ||
    inferCurrencyCodeFromText(quoteData?.currencyLabel) ||
    inferCurrencyCodeFromText(holding?.name) ||
    inferCurrencyCodeFromText(quoteData?.name) ||
    "CNY"
  );
}

function buildFxSummaryText(snapshot = state.fxSnapshot) {
  const usdToCny = Number(snapshot?.rates?.CNY);
  if (!Number.isFinite(usdToCny) || usdToCny <= 0) return "";
  const dateText = snapshot?.date ? `，${snapshot.date}` : "";
  const staleText = snapshot?.stale ? "，使用缓存" : "";
  return `1 USD = ¥${usdToCny.toFixed(4)}${dateText}${staleText}`;
}

function formatMoney(value, currencyCode = getDisplayCurrencyCode()) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: normalizeCurrencyCode(currencyCode) || "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactMoney(value, currencyCode = getDisplayCurrencyCode()) {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const prefix = getCurrencySymbol(currencyCode);

  if (abs >= 100000000) {
    return `${prefix}${(abs / 100000000).toFixed(abs >= 1000000000 ? 1 : 2)}亿`;
  }

  if (abs >= 10000) {
    return `${prefix}${(abs / 10000).toFixed(abs >= 100000 ? 1 : 2)}万`;
  }

  return `${prefix}${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(abs)}`;
}

function formatSignedMoney(value, currencyCode = getDisplayCurrencyCode()) {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return formatMoney(0, currencyCode);
  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatMoney(Math.abs(value), currencyCode)}`;
}

function formatSignedCompactMoney(value, currencyCode = getDisplayCurrencyCode()) {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return formatCompactMoney(0, currencyCode);
  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatCompactMoney(Math.abs(value), currencyCode)}`;
}

function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits);
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}%`;
}

function formatReturnRatio(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return formatPercent(value * 100, digits);
}

function formatShareRatio(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatTargetShareDiff(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return formatPercent(value * 100, digits);
}

function formatTargetShareInput(value) {
  if (!Number.isFinite(value)) return "";
  return String(Number((value * 100).toFixed(2)));
}

function formatUnits(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatShare(amount, total) {
  if (!Number.isFinite(amount) || !Number.isFinite(total) || total <= 0) return "--";
  return `${((amount / total) * 100).toFixed(2)}%`;
}

function formatDebugDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "--";
  return text.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
}

function formatDebugPrice(value, currencyCode = "CNY") {
  const code = normalizeCurrencyCode(currencyCode) || "CNY";
  if (!Number.isFinite(value)) return "--";
  return `${code} ${formatNumber(value, 4)}`;
}

function sameDebugNumber(a, b, epsilon = 1e-8) {
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return Math.abs(a - b) <= epsilon;
  }
  return !Number.isFinite(a) && !Number.isFinite(b);
}

function sameDebugText(a, b) {
  return String(a || "") === String(b || "");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const part = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(passphrase, salt, usage) {
  if (!crypto?.subtle) {
    throw new Error("crypto.subtle 不可用，请使用 https 或 localhost 访问");
  }
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: KDF_ITERATIONS,
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    [usage],
  );
  return key;
}

async function encryptPayload(payload, passphrase) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, "encrypt");
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    v: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iter: KDF_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    enc: {
      alg: "AES-GCM",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    },
  };
}

async function decryptPayload(bundle, passphrase) {
  const decoder = new TextDecoder();
  const salt = base64ToBytes(bundle?.kdf?.salt || "");
  const iv = base64ToBytes(bundle?.enc?.iv || "");
  const ciphertext = base64ToBytes(bundle?.enc?.ciphertext || "");

  if (!salt.length || !iv.length || !ciphertext.length) {
    throw new Error("密文结构无效");
  }

  const key = await deriveKey(passphrase, salt, "decrypt");
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new Error("口令错误或密文损坏");
  }

  let parsed;
  try {
    parsed = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("解密后数据格式错误");
  }

  return parsed;
}

async function encryptVault(vault, passphrase) {
  return encryptPayload(normalizeVault(vault), passphrase);
}

async function decryptVault(bundle, passphrase) {
  const parsed = await decryptPayload(bundle, passphrase);
  return normalizeVault(parsed);
}

function readLocalBundle() {
  return getBundle();
}

async function writeLocalBundle(bundle) {
  await setBundle(bundle);
}

function readQuoteSourceHints() {
  const parsed = getConfigValue(QUOTE_SOURCE_HINTS_KEY, {});
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(Object.entries(parsed).filter(([code, source]) => /^[0-9]{6}$/.test(code) && typeof source === "string"));
}

function writeQuoteSourceHints(hints) {
  const entries = Object.entries(hints || {});
  if (entries.length === 0) {
    void deleteConfigValue(QUOTE_SOURCE_HINTS_KEY);
    return;
  }
  void setConfigValue(QUOTE_SOURCE_HINTS_KEY, Object.fromEntries(entries));
}

function readFundNameCache() {
  const parsed = getConfigValue(FUND_NAME_CACHE_KEY, {});
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([code, name]) => /^[0-9]{6}$/.test(code) && typeof name === "string" && name.trim()),
  );
}

function writeFundNameCache(cache) {
  const entries = Object.entries(cache || {});
  if (entries.length === 0) {
    void deleteConfigValue(FUND_NAME_CACHE_KEY);
    return;
  }
  void setConfigValue(FUND_NAME_CACHE_KEY, Object.fromEntries(entries));
}

function buildPreferredSources(codes) {
  const hints = readQuoteSourceHints();
  const account = getActiveAccount();
  const quotePreference = normalizeQuotePreference(account?.settings?.quotePreference);
  const selected = {};
  codes.forEach((code) => {
    const source = hints[code];
    if (quotePreference === "nav") {
      selected[code] = source === "OVERSEAS" ? "OVERSEAS" : "NAV";
      return;
    }

    selected[code] = source === "OVERSEAS" ? "OVERSEAS" : "ESTIMATE";
  });
  return selected;
}

function buildKnownFundNames(codes) {
  const cache = readFundNameCache();
  const selected = {};

  codes.forEach((code) => {
    const cachedName = String(cache[code] || "").trim();
    const liveName = String(state.quoteMap.get(code)?.data?.name || "").trim();
    const name = cachedName || liveName;
    if (name) selected[code] = name;
  });

  return selected;
}

function updateQuoteSourceHints(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const nextHints = readQuoteSourceHints();
  let changed = false;

  items.forEach((item) => {
    if (!item?.ok || !/^[0-9]{6}$/.test(String(item.code || ""))) return;
    const source = String(item?.data?.source || "");
    if (source === "OVERSEAS") {
      if (nextHints[item.code] === "OVERSEAS") return;
      nextHints[item.code] = "OVERSEAS";
      changed = true;
      return;
    }
    if (!(item.code in nextHints)) return;
    delete nextHints[item.code];
    changed = true;
  });

  if (changed) {
    writeQuoteSourceHints(nextHints);
  }
}

function updateFundNameCache(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const nextCache = readFundNameCache();
  let changed = false;

  items.forEach((item) => {
    if (!item?.ok || !/^[0-9]{6}$/.test(String(item.code || ""))) return;
    const name = String(item?.data?.name || "").trim();
    if (!name || nextCache[item.code] === name) return;
    nextCache[item.code] = name;
    changed = true;
  });

  if (changed) {
    writeFundNameCache(nextCache);
  }
}

function readRememberPreference() {
  return Boolean(getConfigValue(REMEMBER_PASS_KEY, false));
}

function writeRememberPreference(enabled) {
  if (enabled) {
    void setConfigValue(REMEMBER_PASS_KEY, true);
    return;
  }
  void deleteConfigValue(REMEMBER_PASS_KEY);
}

function readRememberedPassphrase() {
  if (!readRememberPreference()) return "";
  return String(getConfigValue(PASS_CACHE_KEY, "") || "");
}

function writeRememberedPassphrase(passphrase) {
  void setConfigValue(PASS_CACHE_KEY, passphrase);
}

function clearRememberedPassphrase() {
  void deleteConfigValue(PASS_CACHE_KEY);
}

function readGistToken() {
  return String(getConfigValue(GIST_TOKEN_KEY, "") || "");
}

function writeGistToken(token) {
  if (token) {
    void setConfigValue(GIST_TOKEN_KEY, token);
    return;
  }
  void deleteConfigValue(GIST_TOKEN_KEY);
}

function readGistId() {
  return String(getConfigValue(GIST_ID_KEY, "") || "");
}

function writeGistId(gistId) {
  if (gistId) {
    void setConfigValue(GIST_ID_KEY, gistId);
    return;
  }
  void deleteConfigValue(GIST_ID_KEY);
}

function readGistSyncedAt() {
  return String(getConfigValue(GIST_SYNCED_AT_KEY, "") || "");
}

function writeGistSyncedAt(value) {
  if (value) {
    void setConfigValue(GIST_SYNCED_AT_KEY, value);
    return;
  }
  void deleteConfigValue(GIST_SYNCED_AT_KEY);
}

function readGistUrl() {
  return String(getConfigValue(GIST_URL_KEY, "") || "");
}

function writeGistUrl(value) {
  if (value) {
    void setConfigValue(GIST_URL_KEY, value);
    return;
  }
  void deleteConfigValue(GIST_URL_KEY);
}

function syncRememberToggleFromStorage() {
  el.rememberPassphraseInput.checked = readRememberPreference();
}

function readLegacyHoldings() {
  const text = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) =>
        createHolding({
          code: item?.code,
          units: item?.units,
          cost: item?.cost,
          assetClass: item?.assetClass,
          groupName: item?.groupName,
          sortOrder: item?.sortOrder,
        }),
      )
      .filter((item) => item.code || item.units > 0 || item.cost !== null);
  } catch {
    return null;
  }
}

function cloneForHistory(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadTextFile(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function diffTrackedFields(before = {}, after = {}, fields = []) {
  const previous = {};
  const next = {};

  fields.forEach((field) => {
    const left = before?.[field];
    const right = after?.[field];
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    previous[field] = cloneForHistory(left);
    next[field] = cloneForHistory(right);
  });

  return {
    before: previous,
    after: next,
    changed: Object.keys(next).length > 0,
  };
}

function buildHistoryHoldingSnapshot(holding) {
  return {
    id: holding.id,
    name: holding.name,
    code: holding.code,
    units: holding.units,
    cost: holding.cost,
    manualAmount: holding.manualAmount,
    manualAmountCurrency: holding.manualAmountCurrency,
    manualPrice: holding.manualPrice,
    assetClass: holding.assetClass,
    groupName: holding.groupName,
    sortOrder: holding.sortOrder,
  };
}

function buildHistoryAccountSnapshot(account) {
  return {
    id: account.id,
    name: account.name,
    settings: cloneForHistory(account.settings || {}),
    settingsUpdatedAt: account.settingsUpdatedAt || nowIso(),
  };
}

async function emitHistoryChange(action, payload, accountId = getActiveAccount()?.id) {
  if (!accountId) return;
  await appendHistoryEvent({
    type: "HOLDINGS_CHANGE",
    accountId,
    date: getLocalDateKey(),
    timestamp: nowIso(),
    payload: {
      action,
      ...cloneForHistory(payload),
    },
  });
}

async function emitFullSnapshot(accountId = getActiveAccount()?.id) {
  const account = findAccountById(accountId);
  if (!account) return;

  await appendHistoryEvent({
    type: "FULL_SNAPSHOT",
    accountId,
    date: getLocalDateKey(),
    timestamp: nowIso(),
    payload: {
      holdings: accountToActiveHoldings(account).map((holding) => buildHistoryHoldingSnapshot(holding)),
      settings: cloneForHistory(account.settings || {}),
    },
  });
}

async function maybeEmitPeriodicFullSnapshot(accountId = getActiveAccount()?.id) {
  if (!accountId) return;
  const latest = await getLatestEventByType(accountId, "FULL_SNAPSHOT");
  if (!latest?.date) {
    await emitFullSnapshot(accountId);
    return;
  }

  const lastDate = new Date(`${latest.date}T00:00:00`);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays >= 30) {
    await emitFullSnapshot(accountId);
  }
}

async function recordPriceSnapshotAndDailyNav(activeHoldings, snapshot) {
  const account = getActiveAccount();
  if (!account) return;

  const timestamp = nowIso();
  const date = getLocalDateKey();
  const prices = {};

  activeHoldings.forEach((holding) => {
    if (!holding?.code || !/^[0-9]{6}$/.test(holding.code)) return;
    const quote = state.quoteMap.get(holding.code);
    if (!quote?.ok || !quote.data) return;
    prices[holding.code] = {
      price: Number.isFinite(Number(quote.data.price)) ? Number(quote.data.price) : null,
      source: quote.data.source || null,
      nav: Number.isFinite(Number(quote.data.nav)) ? Number(quote.data.nav) : null,
      navDate: quote.data.navDate || null,
      currency: quote.data.currency || null,
      currencyLabel: quote.data.currencyLabel || null,
    };
  });

  await replaceDailyPriceSnapshot({
    accountId: account.id,
    date,
    timestamp,
    payload: {
      prices,
      fx: cloneForHistory(state.fxSnapshot?.rates || {}),
    },
  });

  await upsertDailyNav({
    accountId: account.id,
    date,
    totalAsset: snapshot.totalAsset,
    totalCost: snapshot.totalCost,
    totalPnl: snapshot.totalPnl,
    holdingCount: activeHoldings.length,
    displayCurrency: getCurrentDisplayCurrency(),
    fxSnapshot: cloneForHistory(state.fxSnapshot?.rates || {}),
    timestamp,
  });
}

async function exportHistoryEventsJson() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再导出历史记录", "bad");
    return;
  }

  const payload = await exportHistoryPayload();
  downloadTextFile("qdii-history-events.json", JSON.stringify(payload, null, 2), "application/json");
  setVaultStatus("历史事件已导出", "good");
}

function isHistoryPayload(value) {
  return Boolean(value && typeof value === "object" && (Array.isArray(value.events) || Array.isArray(value.dailyNav)));
}

function countHistoryPayloadRecords(payload) {
  return (Array.isArray(payload?.events) ? payload.events.length : 0) + (Array.isArray(payload?.dailyNav) ? payload.dailyNav.length : 0);
}

function countNonPreviewHistoryRecords(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const dailyNav = Array.isArray(payload?.dailyNav) ? payload.dailyNav : [];
  return events.filter((item) => !item?.previewTag).length + dailyNav.filter((item) => !item?.previewTag).length;
}

async function importHistoryEventsJson(file) {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再导入历史记录", "bad");
    return;
  }

  const text = await file.text();
  const payload = JSON.parse(text);
  if (!isHistoryPayload(payload)) {
    throw new Error("文件不是有效的历史事件 JSON");
  }

  await importHistoryPayload(payload);
  await deleteConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY);
  await deleteConfigValue(PERFORMANCE_PREVIEW_META_KEY);
  renderAllPanels();
  if (state.activeTab === "performance") {
    await renderPerformanceOnly();
  }

  const eventCount = Array.isArray(payload.events) ? payload.events.length : 0;
  const dailyNavCount = Array.isArray(payload.dailyNav) ? payload.dailyNav.length : 0;
  setVaultStatus(`历史事件已导入：${eventCount} 条事件，${dailyNavCount} 条每日净值`, "good");
}

async function exportDailyNavCsv() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再导出每日净值", "bad");
    return;
  }

  const rows = await getDailyNavRows();
  const accountNameMap = Object.fromEntries((state.vault?.accounts || []).map((account) => [account.id, account.name]));
  const header = ["date", "accountId", "accountName", "totalAsset", "totalCost", "totalPnl", "holdingCount", "displayCurrency"];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    const cells = [
      row.date,
      row.accountId,
      accountNameMap[row.accountId] || "",
      row.totalAsset ?? "",
      row.totalCost ?? "",
      row.totalPnl ?? "",
      row.holdingCount ?? "",
      row.displayCurrency ?? "",
    ].map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`);
    lines.push(cells.join(","));
  });

  downloadTextFile("qdii-daily-nav.csv", lines.join("\n"), "text/csv;charset=utf-8");
  setVaultStatus("每日净值 CSV 已导出", "good");
}

async function previewHistoryReplay() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再查看历史回放", "bad");
    return;
  }

  const account = getActiveAccount();
  const date = String(el.historyReplayDateInput?.value || "").trim();
  if (!account || !date) {
    setVaultStatus("请选择要回放的日期", "bad");
    return;
  }

  const replay = await reconstructHoldingsAtDate(account.id, date);
  if (!replay) {
    el.historyReplayOutput.textContent = "该日期之前还没有可用的全量基线快照。";
    return;
  }

  const topHoldings = replay.holdings
    .slice(0, 5)
    .map((holding) => `${holding.name || holding.code || "未命名"} (${holding.code || "手工"})`)
    .join("，");

  el.historyReplayOutput.textContent = [
    `基线日期：${replay.baselineDate || "--"}`,
    `持仓数量：${replay.holdings.length}`,
    `价格快照：${Object.keys(replay.prices || {}).length > 0 ? "有" : "无"}`,
    topHoldings ? `示例持仓：${topHoldings}` : "示例持仓：无",
  ].join("\n");
}

function addDaysToDateKey(dateKey, offset) {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((item) => Number.parseInt(item, 10));
  if (!year || !month || !day) {
    return getLocalDateKey();
  }
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(offset || 0));
  return getLocalDateKey(date);
}

function buildPreviewTimestamp(dateKey, hour = 15, minute = 0) {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((item) => Number.parseInt(item, 10));
  const date = new Date(year || 2000, (month || 1) - 1, day || 1, hour, minute, 0, 0);
  return date.toISOString();
}

function roundPreviewNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function hashPreviewSeed(text) {
  return [...String(text || "preview")].reduce((seed, char, index) => seed + char.charCodeAt(0) * (index + 1), 0);
}

function buildPreviewCurrencyLabel(currencyCode = "CNY") {
  const code = normalizeCurrencyCode(currencyCode) || "CNY";
  const map = {
    CNY: "人民币",
    USD: "美元",
    HKD: "港元",
    EUR: "欧元",
    GBP: "英镑",
    JPY: "日元",
    AUD: "澳元",
    CAD: "加元",
    SGD: "新加坡元",
  };
  return map[code] || code;
}

function buildPreviewFxRates() {
  const currentRates = state.fxSnapshot?.rates && typeof state.fxSnapshot.rates === "object" ? state.fxSnapshot.rates : null;
  return {
    USD: 1,
    CNY: Number.isFinite(Number(currentRates?.CNY)) ? Number(currentRates.CNY) : 7.12,
    HKD: Number.isFinite(Number(currentRates?.HKD)) ? Number(currentRates.HKD) : 0.91,
    EUR: Number.isFinite(Number(currentRates?.EUR)) ? Number(currentRates.EUR) : 7.78,
    GBP: Number.isFinite(Number(currentRates?.GBP)) ? Number(currentRates.GBP) : 9.08,
    JPY: Number.isFinite(Number(currentRates?.JPY)) ? Number(currentRates.JPY) : 0.047,
    AUD: Number.isFinite(Number(currentRates?.AUD)) ? Number(currentRates.AUD) : 4.63,
    CAD: Number.isFinite(Number(currentRates?.CAD)) ? Number(currentRates.CAD) : 5.23,
    SGD: Number.isFinite(Number(currentRates?.SGD)) ? Number(currentRates.SGD) : 5.29,
  };
}

function createPreviewPrice(meta, dayIndex, totalDays) {
  const progress = totalDays <= 0 ? 1 : dayIndex / totalDays;
  const normalized = Math.min(1, Math.max(0, progress));
  const seed = meta.seed;
  const startMultiplier = 0.84 + (seed % 5) * 0.03;
  const drift = startMultiplier + (1 - startMultiplier) * normalized;
  const cycles = 1.2 + (seed % 4) * 0.45;
  const phase = (seed % 360) * (Math.PI / 180);
  const seasonal = Math.sin(normalized * Math.PI * 2 * cycles + phase) * (0.025 + (seed % 3) * 0.006) * (1 - normalized * 0.35);
  const pullbackCenter = 0.55 + (seed % 3) * 0.08;
  const pullbackDepth = 0.018 + (seed % 5) * 0.004;
  const pullback = -pullbackDepth * Math.exp(-Math.pow((normalized - pullbackCenter) / 0.12, 2));
  const multiplier = Math.max(0.45, drift + seasonal + pullback);
  if (dayIndex >= totalDays) {
    return roundPreviewNumber(meta.currentPrice, 4);
  }
  return roundPreviewNumber(meta.currentPrice * multiplier, 4);
}

function createPreviewHoldingPlan(holding, index) {
  const metric = buildHoldingMetric(holding);
  const manualAmount = Number.isFinite(Number(holding.manualAmount)) ? Number(holding.manualAmount) : null;
  const units = Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
  const currentPrice =
    Number.isFinite(Number(metric.price)) && Number(metric.price) > 0
      ? Number(metric.price)
      : Number.isFinite(Number(holding.manualPrice)) && Number(holding.manualPrice) > 0
        ? Number(holding.manualPrice)
        : Number.isFinite(Number(holding.cost)) && Number(holding.cost) > 0
          ? Number(holding.cost)
          : null;
  const currentCurrency =
    normalizeCurrencyCode(metric.priceCurrency) ||
    normalizeManualAmountCurrency(holding.manualAmountCurrency) ||
    inferCurrencyCodeFromText(holding.name) ||
    "CNY";
  const seed = hashPreviewSeed(holding.code || holding.name || holding.id || `holding-${index}`);
  const baseHolding = buildHistoryHoldingSnapshot(holding);

  if (manualAmount > 0) {
    const startAmount =
      index % 2 === 0
        ? roundPreviewNumber(manualAmount * 0.84, 2)
        : roundPreviewNumber(manualAmount * 1.18, 2);
    const changeDay = index % 2 === 0 ? 52 : 108;
    return {
      kind: "manualAmount",
      seed,
      currentCurrency,
      currentPrice: null,
      startHolding: {
        ...baseHolding,
        manualAmount: startAmount,
      },
      transitions:
        Math.abs(startAmount - manualAmount) > 0.009
          ? [
              {
                dayOffset: changeDay,
                before: { manualAmount: startAmount },
                after: { manualAmount },
              },
            ]
          : [],
    };
  }

  if (!(units > 0) || !(currentPrice > 0)) {
    return null;
  }

  let startUnits = units;
  let changeDay = null;
  if (index % 3 === 0) {
    startUnits = roundPreviewNumber(units * 0.74, 2);
    changeDay = 58;
  } else if (index % 3 === 1) {
    startUnits = roundPreviewNumber(units * 1.22, 2);
    changeDay = 104;
  } else {
    startUnits = roundPreviewNumber(units * 0.88, 2);
    changeDay = 136;
  }

  if (!(startUnits > 0)) {
    startUnits = units;
    changeDay = null;
  }

  return {
    kind: "priced",
    seed,
    currentCurrency,
    currentPrice,
    startHolding: {
      ...baseHolding,
      units: startUnits,
    },
    transitions:
      changeDay !== null && Math.abs(startUnits - units) > 0.009
        ? [
            {
              dayOffset: changeDay,
              before: { units: startUnits },
              after: { units },
            },
          ]
        : [],
  };
}

function buildPreviewHistoryPayload(account, holdings, totalDays = PERFORMANCE_PREVIEW_DAYS) {
  const endDate = getLocalDateKey();
  const startDate = addDaysToDateKey(endDate, -(Math.max(2, totalDays) - 1));
  const displayCurrency = getCurrentDisplayCurrency();
  const displayCurrencyCode = getDisplayCurrencyCode(displayCurrency);
  const fxRates = buildPreviewFxRates();
  const plans = holdings
    .map((holding, index) => ({
      holding,
      plan: createPreviewHoldingPlan(holding, index),
    }))
    .filter((item) => item.plan);

  if (plans.length === 0) {
    throw new Error("当前账户没有可用于生成演示历史的有效持仓");
  }

  const holdingsState = new Map(plans.map((item) => [item.holding.id, cloneForHistory(item.plan.startHolding)]));
  const changesByDay = new Map();
  plans.forEach(({ holding, plan }) => {
    plan.transitions.forEach((transition, transitionIndex) => {
      if (!changesByDay.has(transition.dayOffset)) {
        changesByDay.set(transition.dayOffset, []);
      }
      changesByDay.get(transition.dayOffset).push({
        holdingId: holding.id,
        before: cloneForHistory(transition.before),
        after: cloneForHistory(transition.after),
        index: transitionIndex,
      });
    });
  });

  const events = [
    {
      type: "FULL_SNAPSHOT",
      accountId: account.id,
      date: startDate,
      timestamp: buildPreviewTimestamp(startDate, 9, 0),
      previewTag: PERFORMANCE_PREVIEW_META_KEY,
      payload: {
        holdings: [...holdingsState.values()].map((item) => buildHistoryHoldingSnapshot(item)),
        settings: cloneForHistory(account.settings || {}),
      },
    },
  ];
  const dailyNav = [];

  for (let dayOffset = 0; dayOffset < Math.max(2, totalDays); dayOffset += 1) {
    const dateKey = addDaysToDateKey(startDate, dayOffset);
    const priceEntries = {};

    plans.forEach(({ holding, plan }) => {
      if (plan.kind !== "priced" || !holding.code) return;
      const price = createPreviewPrice(plan, dayOffset, Math.max(1, totalDays - 1));
      priceEntries[holding.code] = {
        price,
        nav: price,
        source: "NAV",
        navDate: dateKey,
        currency: plan.currentCurrency,
        currencyLabel: buildPreviewCurrencyLabel(plan.currentCurrency),
      };
    });

    events.push({
      type: "PRICE_SNAPSHOT",
      accountId: account.id,
      date: dateKey,
      timestamp: buildPreviewTimestamp(dateKey, 15, 0),
      previewTag: PERFORMANCE_PREVIEW_META_KEY,
      payload: {
        prices: priceEntries,
        fx: cloneForHistory(fxRates),
      },
    });

    const scheduledChanges = changesByDay.get(dayOffset) || [];
    scheduledChanges.forEach((change, changeIndex) => {
      const current = cloneForHistory(holdingsState.get(change.holdingId));
      if (!current) return;
      const next = {
        ...current,
        ...cloneForHistory(change.after),
      };
      holdingsState.set(change.holdingId, next);
      events.push({
        type: "HOLDINGS_CHANGE",
        accountId: account.id,
        date: dateKey,
        timestamp: buildPreviewTimestamp(dateKey, 15, 10 + changeIndex),
        previewTag: PERFORMANCE_PREVIEW_META_KEY,
        payload: {
          action: "UPDATE",
          holdingId: change.holdingId,
          before: cloneForHistory(change.before),
          after: cloneForHistory(change.after),
        },
      });
    });

    let totalAsset = 0;
    let totalCost = 0;
    let hasAnyCost = false;
    [...holdingsState.values()].forEach((holding) => {
      const currentManualAmount = Number.isFinite(Number(holding.manualAmount)) ? Number(holding.manualAmount) : null;
      if (currentManualAmount > 0) {
        const nativeCurrency = normalizeManualAmountCurrency(holding.manualAmountCurrency) || "CNY";
        const convertedAmount = convertMoneyAmount(currentManualAmount, nativeCurrency, displayCurrencyCode);
        if (Number.isFinite(convertedAmount)) {
          totalAsset += convertedAmount;
        }
        return;
      }

      const units = Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
      const code = String(holding.code || "").trim();
      const quote = code ? priceEntries[code] || null : null;
      if (!(units > 0) || !quote?.price) return;

      const convertedAmount = convertMoneyAmount(units * quote.price, quote.currency || "CNY", displayCurrencyCode);
      if (Number.isFinite(convertedAmount)) {
        totalAsset += convertedAmount;
      }

      const cost = Number.isFinite(Number(holding.cost)) ? Number(holding.cost) : null;
      if (Number.isFinite(cost)) {
        const convertedCost = convertMoneyAmount(units * cost, quote.currency || "CNY", displayCurrencyCode);
        if (Number.isFinite(convertedCost)) {
          totalCost += convertedCost;
          hasAnyCost = true;
        }
      }
    });

    dailyNav.push({
      accountId: account.id,
      date: dateKey,
      totalAsset: roundPreviewNumber(totalAsset, 2),
      totalCost: hasAnyCost ? roundPreviewNumber(totalCost, 2) : null,
      totalPnl: hasAnyCost ? roundPreviewNumber(totalAsset - totalCost, 2) : null,
      holdingCount: [...holdingsState.values()].length,
      displayCurrency,
      fxSnapshot: cloneForHistory(fxRates),
      timestamp: buildPreviewTimestamp(dateKey, 15, 45),
      previewTag: PERFORMANCE_PREVIEW_META_KEY,
    });
  }

  return {
    version: 1,
    exportedAt: nowIso(),
    events,
    dailyNav,
  };
}

async function seedPerformancePreviewHistory() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再生成演示历史", "bad");
    return;
  }

  const account = getActiveAccount();
  const holdings = accountToActiveHoldings(account).filter((holding) => {
    const manualAmount = Number.isFinite(Number(holding.manualAmount)) ? Number(holding.manualAmount) : null;
    const units = Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    return manualAmount > 0 || (holding.code && units > 0);
  });

  if (!account || holdings.length === 0) {
    setVaultStatus("当前账户没有可用于生成演示曲线的持仓", "bad");
    return;
  }

  setVaultStatus("正在生成本地演示历史...");

  const previewMeta = getConfigValue(PERFORMANCE_PREVIEW_META_KEY, null);
  const existingBackup = getConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY, null);
  const keepExistingBackup = Boolean(previewMeta?.active && isHistoryPayload(existingBackup));
  if (!keepExistingBackup) {
    const backupPayload = await exportHistoryPayload();
    await setConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY, backupPayload);
  }

  const previewPayload = buildPreviewHistoryPayload(account, holdings, PERFORMANCE_PREVIEW_DAYS);
  await importHistoryPayload(previewPayload);
  await setConfigValue(PERFORMANCE_PREVIEW_META_KEY, {
    active: true,
    accountId: account.id,
    generatedAt: nowIso(),
    days: PERFORMANCE_PREVIEW_DAYS,
  });

  state.performancePreset = "6m";
  state.performanceStartDate = "";
  state.performanceEndDate = "";
  syncPerformancePresetButtons();
  renderAllPanels();
  setActiveTab("performance");
  await renderPerformanceOnly();
  setVaultStatus("已生成本地演示历史，可切到收益曲线页查看；恢复原历史后再做正式备份。", "good");
}

async function restorePerformancePreviewHistory() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再恢复历史", "bad");
    return;
  }

  setVaultStatus("正在恢复生成演示历史前的原始记录...");
  const previewMeta = getConfigValue(PERFORMANCE_PREVIEW_META_KEY, null);
  const backupPayload = getConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY, null);

  if (!previewMeta?.active) {
    await deleteConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY);
    await deleteConfigValue(PERFORMANCE_PREVIEW_META_KEY);
    setVaultStatus("没有正在使用的演示历史，当前历史记录未改动。", "good");
    return;
  }

  if (!isHistoryPayload(backupPayload)) {
    await deleteConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY);
    await deleteConfigValue(PERFORMANCE_PREVIEW_META_KEY);
    setVaultStatus("没有找到演示历史前的备份，已保留当前历史；如需恢复请导入事件 JSON 或从 Gist 恢复。", "bad");
    return;
  }

  const currentPayload = await exportHistoryPayload();
  const backupRecordCount = countHistoryPayloadRecords(backupPayload);
  const currentNonPreviewCount = countNonPreviewHistoryRecords(currentPayload);
  if (backupRecordCount === 0 && currentNonPreviewCount > 0) {
    await deleteConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY);
    await deleteConfigValue(PERFORMANCE_PREVIEW_META_KEY);
    setVaultStatus("演示历史备份为空，但当前存在真实历史；为避免误删，已保留当前历史。", "bad");
    return;
  }

  await importHistoryPayload(backupPayload);
  await deleteConfigValue(PERFORMANCE_PREVIEW_BACKUP_KEY);
  await deleteConfigValue(PERFORMANCE_PREVIEW_META_KEY);
  renderAllPanels();
  if (state.activeTab === "performance") {
    await renderPerformanceOnly();
  }
  setVaultStatus("已恢复原历史记录", "good");
}

function findHoldingById(id) {
  const account = getActiveAccount();
  if (!account) return null;
  return account.holdings.find((item) => item.id === id) || null;
}

function findAccountById(id) {
  return state.vault?.accounts?.find((item) => item.id === id) || null;
}

function findHoldingInVaultById(id) {
  if (!state.vault?.accounts) return { account: null, holding: null };

  for (const account of state.vault.accounts) {
    const holding = account.holdings.find((item) => item.id === id);
    if (holding) {
      return { account, holding };
    }
  }

  return { account: null, holding: null };
}

function getArchivedAccounts(vault = state.vault) {
  if (!vault || !Array.isArray(vault.accounts)) return [];
  return vault.accounts.filter((account) => account.deleted);
}

function getArchivedHoldings(vault = state.vault) {
  if (!vault || !Array.isArray(vault.accounts)) return [];

  return vault.accounts
    .filter((account) => !account.deleted)
    .flatMap((account) =>
      account.holdings
        .filter((holding) => holding.deleted)
        .map((holding) => ({
          account,
          holding,
        })),
    );
}

function getArchiveEntryCount(vault = state.vault) {
  return getArchivedAccounts(vault).length + getArchivedHoldings(vault).length;
}

function updateHoldingUpdatedAt(holding) {
  const stamp = nowIso();
  holding.updatedAt = stamp;
  const account = getActiveAccount();
  if (account) account.updatedAt = stamp;
  if (state.vault) state.vault.updatedAt = stamp;
}

function updateAccountUpdatedAt(account) {
  const stamp = nowIso();
  account.updatedAt = stamp;
  if (state.vault) state.vault.updatedAt = stamp;
}

function touchAccount(account) {
  if (!account) return nowIso();
  const stamp = nowIso();
  account.updatedAt = stamp;
  if (state.vault) state.vault.updatedAt = stamp;
  return stamp;
}

function getSortMode() {
  if (el.viewSort.value === "change_pct") return "change_pct";
  if (el.viewSort.value === "amount") return "amount";
  return "default";
}

function normalizePieDisplayMode(value) {
  return String(value || "").trim().toLowerCase() === "percent" ? "percent" : "full";
}

function normalizeTreeDepth(value) {
  const depth = String(value || "").trim().toLowerCase();
  return TREE_DEPTH_ORDER.includes(depth) ? depth : "fund";
}

function buildGroupCompositeKeys(activeHoldings) {
  const keys = [];
  buildClassBuckets(activeHoldings).forEach((groups, classKey) => {
    groups.forEach((_, groupName) => {
      keys.push(buildGroupCompositeKey(classKey, groupName));
    });
  });
  return keys;
}

function getCurrentTreeDepth(activeHoldings) {
  if (!Array.isArray(activeHoldings) || activeHoldings.length === 0) return "fund";
  const classKeys = [...buildClassBuckets(activeHoldings).keys()];
  const allClassesCollapsed = classKeys.every((classKey) => state.collapsedClassKeys.has(classKey));
  if (allClassesCollapsed) return "class";

  const allClassesExpanded = classKeys.every((classKey) => !state.collapsedClassKeys.has(classKey));
  if (!allClassesExpanded) return "";

  const groupKeys = buildGroupCompositeKeys(activeHoldings);
  const allGroupsCollapsed = groupKeys.length > 0 && groupKeys.every((groupKey) => state.collapsedGroupKeys.has(groupKey));
  if (allGroupsCollapsed) return "group";

  const allGroupsExpanded = groupKeys.every((groupKey) => !state.collapsedGroupKeys.has(groupKey));
  if (allGroupsExpanded) return "fund";

  return "";
}

function syncTreeDepthButtons(activeHoldings = []) {
  const activeDepth = state.unlocked ? getCurrentTreeDepth(activeHoldings) : "";
  el.treeModeButtons.forEach((button) => {
    const isActive = button.dataset.treeDepth === activeDepth;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function applyDefaultViewModes({ render = false } = {}) {
  if (state.vault) {
    setTreeDepth("group", { render: false });
  } else {
    state.collapsedClassKeys.clear();
    state.collapsedGroupKeys.clear();
    syncTreeDepthButtons([]);
  }
  setPieLevel("group", { render: false });
  setTargetPieLevel("group", { render: false });
  if (render && state.unlocked) {
    if (state.activeTab === "pie") {
      renderPieOnly();
    } else if (state.activeTab === "performance") {
      void renderPerformanceOnly();
    } else {
      renderDashboardOnly();
    }
  }
}

function setTreeDepth(depth, { render = true } = {}) {
  if (!state.vault) return;

  const normalized = normalizeTreeDepth(depth);
  const activeHoldings = vaultToActiveHoldings(state.vault);
  const classBuckets = buildClassBuckets(activeHoldings);
  state.collapsedClassKeys.clear();
  state.collapsedGroupKeys.clear();

  if (normalized === "class") {
    classBuckets.forEach((_, classKey) => {
      state.collapsedClassKeys.add(classKey);
    });
  } else if (normalized === "group") {
    classBuckets.forEach((groups, classKey) => {
      groups.forEach((_, groupName) => {
        state.collapsedGroupKeys.add(buildGroupCompositeKey(classKey, groupName));
      });
    });
  }

  syncTreeDepthButtons(activeHoldings);
  if (render && state.unlocked) {
    renderDashboardOnly();
  }
}

function normalizePieLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return PIE_LEVEL_ORDER.includes(level) ? level : "group";
}

function syncPieLevelButtons() {
  const activeLevel = normalizePieLevel(el.pieLevel?.value);
  el.pieModeButtons.forEach((button) => {
    const isActive = button.dataset.pieLevel === activeLevel;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setPieLevel(level, { render = true } = {}) {
  const normalized = normalizePieLevel(level);
  if (el.pieLevel) {
    el.pieLevel.value = normalized;
  }
  syncPieLevelButtons();
  if (render && state.unlocked) {
    renderPieOnly();
  }
}

function cyclePieLevel() {
  const current = normalizePieLevel(el.pieLevel?.value);
  const currentIndex = PIE_LEVEL_ORDER.indexOf(current);
  const nextLevel = PIE_LEVEL_ORDER[(currentIndex + 1) % PIE_LEVEL_ORDER.length];
  setPieLevel(nextLevel);
}

function normalizeTargetPieLevel(value) {
  return String(value || "").trim().toLowerCase() === "class" ? "class" : "group";
}

function syncTargetPieLevelButtons() {
  const activeLevel = normalizeTargetPieLevel(state.targetPieLevel);
  el.targetPieModeButtons.forEach((button) => {
    const isActive = button.dataset.targetPieLevel === activeLevel;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setTargetPieLevel(level, { render = true } = {}) {
  state.targetPieLevel = normalizeTargetPieLevel(level);
  syncTargetPieLevelButtons();
  if (render && state.unlocked) {
    renderPieOnly();
  }
}

function syncPieDisplayButtons() {
  const activeMode = normalizePieDisplayMode(state.pieDisplayMode);
  el.pieDisplayButtons.forEach((button) => {
    const isActive = button.dataset.pieDisplay === activeMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setPieDisplayMode(mode, { render = true } = {}) {
  state.pieDisplayMode = normalizePieDisplayMode(mode);
  syncPieDisplayButtons();
  if (render && state.unlocked) {
    renderPieOnly();
  }
}

function syncDisplayCurrencyButtons() {
  const activeCurrency = getCurrentDisplayCurrency();
  el.displayCurrencyButtons.forEach((button) => {
    const isActive = normalizeDisplayCurrency(button.dataset.displayCurrency) === activeCurrency;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function updateDisplayCurrencyInVault(value) {
  if (!state.vault) return;
  const account = getActiveAccount();
  if (!account) return;
  const before = cloneForHistory(account.settings || {});
  account.settings.displayCurrency = normalizeDisplayCurrency(value);
  const stamp = nowIso();
  account.settingsUpdatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
  const diff = diffTrackedFields(before, account.settings, SETTINGS_HISTORY_FIELDS);
  if (diff.changed) {
    void emitHistoryChange("SETTINGS_CHANGE", { before: diff.before, after: diff.after }, account.id);
  }
}

function setActiveTab(tab) {
  if (tab === "config") {
    state.activeTab = "config";
  } else if (tab === "performance") {
    state.activeTab = "performance";
  } else if (tab === "pie") {
    state.activeTab = "pie";
  } else {
    state.activeTab = "view";
  }
  const isView = state.activeTab === "view";
  const isPie = state.activeTab === "pie";
  const isPerformance = state.activeTab === "performance";

  el.tabViewBtn.classList.toggle("is-active", isView);
  el.tabPieBtn.classList.toggle("is-active", isPie);
  el.tabPerformanceBtn.classList.toggle("is-active", isPerformance);
  el.tabConfigBtn.classList.toggle("is-active", state.activeTab === "config");
  el.tabView.classList.toggle("is-active", isView);
  el.tabPie.classList.toggle("is-active", isPie);
  el.tabPerformance.classList.toggle("is-active", isPerformance);
  el.tabConfig.classList.toggle("is-active", state.activeTab === "config");

  if (isView && state.unlocked) {
    renderDashboardOnly();
  } else if (isPie && state.unlocked) {
    renderPieOnly();
  } else if (isPerformance && state.unlocked) {
    void renderPerformanceOnly();
  }
}

function renderAccountSelector() {
  if (!el.accountSelect) return;

  if (!state.vault) {
    el.accountSelect.innerHTML = '<option value="">未解锁</option>';
    el.accountSelect.value = "";
    if (el.archiveOpenBtn) {
      el.archiveOpenBtn.textContent = "归档";
    }
    return;
  }

  ensureAtLeastOneAccount(state.vault);
  const activeAccount = getActiveAccount(state.vault);
  const visibleAccounts = getVisibleAccounts(state.vault);
  const archiveCount = getArchiveEntryCount(state.vault);

  const fragment = document.createDocumentFragment();
  visibleAccounts.forEach((account) => {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = account.name;
    fragment.appendChild(option);
  });

  el.accountSelect.innerHTML = "";
  el.accountSelect.appendChild(fragment);
  el.accountSelect.value = activeAccount?.id || state.vault.activeAccountId || "";
  if (el.archiveOpenBtn) {
    el.archiveOpenBtn.textContent = archiveCount > 0 ? `归档 (${archiveCount})` : "归档";
  }
}

function switchAccount(accountId) {
  if (!state.unlocked || !state.vault) return;
  const target = findAccountById(accountId);
  if (!target || target.deleted) return;
  if (state.vault.activeAccountId === target.id) return;

  state.vault.activeAccountId = target.id;
  state.vault.updatedAt = nowIso();
  state.quoteMap = new Map();
  state.pendingQuoteCodes.clear();
  setIntervalSelectFromVault();
  applyDefaultViewModes({ render: false });
  renderAllPanels();
  void maybeEmitPeriodicFullSnapshot(target.id);
  schedulePersist();
  scheduleSync();
  refreshData().catch((error) => setPriceStatus(formatError(error), "bad"));
}

function openAccountModal(mode = "create", account = null) {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再编辑账户", "bad");
    openUnlockModal();
    return;
  }

  const editing = mode === "edit" && account;
  state.accountModalMode = editing ? "edit" : "create";
  state.editingAccountId = editing ? account.id : null;

  el.accountModalTitle.textContent = editing ? "重命名账户" : "新增账户";
  el.accountSaveBtn.textContent = editing ? "保存名称" : "新增账户";
  el.accountNameInput.value = editing ? account.name : "";

  el.accountModal.hidden = false;
  updateModalOpenState();
  requestAnimationFrame(() => {
    el.accountNameInput.focus();
    el.accountNameInput.select();
  });
}

function closeAccountModal() {
  el.accountModal.hidden = true;
  state.accountModalMode = "create";
  state.editingAccountId = null;
  el.accountNameInput.value = "";
  updateModalOpenState();
}

function saveAccountFromModal() {
  if (!state.unlocked || !state.vault) return;

  const accountName = normalizeAccountName(el.accountNameInput.value);
  let target = null;
  let renameBefore = null;

  if (state.accountModalMode === "edit" && state.editingAccountId) {
    target = findAccountById(state.editingAccountId);
    if (!target) {
      setVaultStatus("目标账户不存在", "bad");
      closeAccountModal();
      return;
    }
    renameBefore = target.name;
    target.name = accountName;
    updateAccountUpdatedAt(target);
  } else {
    target = createAccount({
      name: accountName,
      settings: {
        refreshInterval: normalizeInterval(el.interval.value),
        quotePreference: normalizeQuotePreference(el.quotePreference.value),
        displayCurrency: getCurrentDisplayCurrency(),
      },
    });
    state.vault.accounts.push(target);
    state.vault.activeAccountId = target.id;
    state.quoteMap = new Map();
    applyDefaultViewModes({ render: false });
    ensureAtLeastOneActiveHolding();
    updateAccountUpdatedAt(target);
  }

  setIntervalSelectFromVault();
  renderAllPanels();
  if (state.accountModalMode === "edit" && renameBefore !== null && renameBefore !== target.name) {
    void emitHistoryChange("ACCOUNT_RENAME", { before: renameBefore, after: target.name }, target.id);
  } else if (state.accountModalMode !== "edit") {
    void emitHistoryChange("ACCOUNT_ADD", { account: buildHistoryAccountSnapshot(target) }, target.id);
    void emitFullSnapshot(target.id);
  }
  schedulePersist();
  scheduleSync();
  closeAccountModal();
}

function removeActiveAccount() {
  if (!state.unlocked || !state.vault) return;
  ensureAtLeastOneAccount(state.vault);

  if (getVisibleAccounts(state.vault).length <= 1) {
    setVaultStatus("至少保留一个账户，无法删除", "bad");
    return;
  }

  const activeId = state.vault.activeAccountId;
  const active = findAccountById(activeId);
  if (!active) return;
  openDeleteConfirmModal({
    type: "account",
    id: active.id,
    title: "确认归档账户",
    description: `确认将账户「${active.name}」移入归档？`,
    note: "账户内持仓不会丢失，只是不再展示，可在归档中恢复。",
    actionLabel: "移入归档",
  });
}

function updateModalOpenState() {
  const hasOpenModal =
    !el.unlockModal.hidden ||
    !el.passwordModal.hidden ||
    !el.accountModal.hidden ||
    !el.holdingModal.hidden ||
    !el.groupTargetModal.hidden ||
    !el.archiveModal.hidden ||
    !el.deleteConfirmModal.hidden;
  document.body.classList.toggle("modal-open", hasOpenModal);
}

function openArchiveModal() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再查看归档", "bad");
    openUnlockModal();
    return;
  }

  renderArchiveModal();
  el.archiveModal.hidden = false;
  updateModalOpenState();
}

function closeArchiveModal() {
  el.archiveModal.hidden = true;
  updateModalOpenState();
}

function openDeleteConfirmModal(context) {
  state.deleteConfirmContext = context;
  el.deleteConfirmTitle.textContent = context?.title || "确认删除";
  el.deleteConfirmDesc.textContent = context?.description || "确认将内容移入归档？";
  el.deleteConfirmNote.textContent = context?.note || "归档后不会真正删除，可稍后恢复。";
  el.deleteConfirmSubmitBtn.textContent = context?.actionLabel || "移入归档";
  el.deleteConfirmModal.hidden = false;
  updateModalOpenState();
}

function closeDeleteConfirmModal() {
  state.deleteConfirmContext = null;
  el.deleteConfirmModal.hidden = true;
  updateModalOpenState();
}

function confirmDeleteAction() {
  if (!state.unlocked || !state.vault) {
    closeDeleteConfirmModal();
    return;
  }

  const context = state.deleteConfirmContext;
  if (!context?.id || !context?.type) {
    closeDeleteConfirmModal();
    return;
  }

  if (context.type === "account") {
    archiveAccount(context.id);
  } else if (context.type === "holding") {
    archiveHolding(context.id);
  }

  closeDeleteConfirmModal();
}

function formatArchiveTime(value) {
  if (!value) return "时间未知";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "时间未知";
  return time.toLocaleString("zh-CN", { hour12: false });
}

function renderArchiveEmpty(container, text) {
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "archive-empty";
  empty.textContent = text;
  container.appendChild(empty);
}

function buildArchiveMetaParts(parts) {
  return parts.filter(Boolean).join(" · ");
}

function renderArchiveModal() {
  if (!state.vault) {
    renderArchiveEmpty(el.archiveAccountList, "请先解锁后查看归档");
    renderArchiveEmpty(el.archiveHoldingList, "请先解锁后查看归档");
    el.archiveAccountCount.textContent = "0 个";
    el.archiveHoldingCount.textContent = "0 个";
    return;
  }

  const archivedAccounts = [...getArchivedAccounts(state.vault)].sort((a, b) => compareIso(b.deletedAt, a.deletedAt));
  const archivedHoldings = [...getArchivedHoldings(state.vault)].sort((a, b) => compareIso(b.holding.deletedAt, a.holding.deletedAt));

  el.archiveAccountCount.textContent = `${archivedAccounts.length} 个`;
  el.archiveHoldingCount.textContent = `${archivedHoldings.length} 个`;
  el.archiveModalDesc.textContent =
    archivedAccounts.length + archivedHoldings.length > 0
      ? "删除的账户和持仓会先进入归档，可随时恢复。"
      : "当前没有已归档内容。";

  if (archivedAccounts.length === 0) {
    renderArchiveEmpty(el.archiveAccountList, "暂无已归档账户");
  } else {
    el.archiveAccountList.innerHTML = "";
    const accountFragment = document.createDocumentFragment();
    archivedAccounts.forEach((account) => {
      const row = document.createElement("div");
      row.className = "archive-item";

      const main = document.createElement("div");
      main.className = "archive-item-main";

      const title = document.createElement("p");
      title.className = "archive-item-title";
      title.textContent = account.name;

      const meta = document.createElement("p");
      meta.className = "archive-item-meta";
      meta.textContent = buildArchiveMetaParts([
        `${account.holdings.filter((holding) => !holding.deleted).length} 条持仓`,
        `归档于 ${formatArchiveTime(account.deletedAt)}`,
      ]);

      main.append(title, meta);

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-lite btn-sm";
      restoreBtn.textContent = "恢复";
      restoreBtn.addEventListener("click", () => restoreArchivedAccount(account.id));

      row.append(main, restoreBtn);
      accountFragment.appendChild(row);
    });
    el.archiveAccountList.appendChild(accountFragment);
  }

  if (archivedHoldings.length === 0) {
    renderArchiveEmpty(el.archiveHoldingList, "暂无已归档持仓");
  } else {
    el.archiveHoldingList.innerHTML = "";
    const holdingFragment = document.createDocumentFragment();
    archivedHoldings.forEach(({ account, holding }) => {
      const row = document.createElement("div");
      row.className = "archive-item";

      const main = document.createElement("div");
      main.className = "archive-item-main";

      const title = document.createElement("p");
      title.className = "archive-item-title";
      const displayName = holding.name || holding.code || "未命名持仓";
      title.textContent = displayName;

      const meta = document.createElement("p");
      meta.className = "archive-item-meta";
      meta.textContent = buildArchiveMetaParts([
        holding.code ? `代码 ${holding.code}` : "",
        `账户 ${account.name}`,
        `归档于 ${formatArchiveTime(holding.deletedAt)}`,
      ]);

      main.append(title, meta);

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-lite btn-sm";
      restoreBtn.textContent = "恢复";
      restoreBtn.addEventListener("click", () => restoreArchivedHolding(holding.id));

      row.append(main, restoreBtn);
      holdingFragment.appendChild(row);
    });
    el.archiveHoldingList.appendChild(holdingFragment);
  }
}

function archiveAccount(accountId) {
  if (!state.vault) return;
  ensureAtLeastOneAccount(state.vault);

  const account = findAccountById(accountId);
  if (!account || account.deleted) return;
  if (getVisibleAccounts(state.vault).length <= 1) {
    setVaultStatus("至少保留一个账户，无法删除", "bad");
    return;
  }

  const visibleAccounts = getVisibleAccounts(state.vault);
  const nextAccount = visibleAccounts.find((item) => item.id !== account.id);
  const stamp = touchAccount(account);
  account.deleted = true;
  account.deletedAt = stamp;
  state.vault.activeAccountId = nextAccount?.id || "";
  state.quoteMap = new Map();
  state.pendingQuoteCodes.clear();
  applyDefaultViewModes({ render: false });
  ensureAtLeastOneAccount(state.vault);
  ensureAtLeastOneActiveHolding();
  setIntervalSelectFromVault();
  renderAllPanels();
  renderArchiveModal();
  void emitHistoryChange("ACCOUNT_DELETE", { account: buildHistoryAccountSnapshot(account) }, account.id);
  schedulePersist();
  scheduleSync();
  setVaultStatus(`账户「${account.name}」已移入归档`, "good");
  refreshData().catch((error) => setPriceStatus(formatError(error), "bad"));
}

function archiveHolding(holdingId) {
  if (!state.vault) return;

  const { account, holding } = findHoldingInVaultById(holdingId);
  if (!account || !holding || holding.deleted) return;
  const historyHolding = buildHistoryHoldingSnapshot(holding);

  const stamp = nowIso();
  holding.deleted = true;
  holding.deletedAt = stamp;
  holding.updatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
  reindexHoldingSortOrders(account.holdings);
  ensureAtLeastOneActiveHolding();
  renderAllPanels();
  renderArchiveModal();
  void emitHistoryChange("DELETE", { holdingId: holding.id, holding: historyHolding }, account.id);
  schedulePersist();
  scheduleSync();
  setVaultStatus(`持仓「${holding.name || holding.code || "未命名持仓"}」已移入归档`, "good");
}

function restoreArchivedAccount(accountId) {
  if (!state.vault) return;

  const account = findAccountById(accountId);
  if (!account || !account.deleted) return;

  account.deleted = false;
  account.deletedAt = null;
  touchAccount(account);
  ensureAtLeastOneAccount(state.vault);
  renderAllPanels();
  renderArchiveModal();
  void emitHistoryChange("ACCOUNT_RESTORE", { account: buildHistoryAccountSnapshot(account) }, account.id);
  void emitFullSnapshot(account.id);
  schedulePersist();
  scheduleSync();
  setVaultStatus(`账户「${account.name}」已恢复`, "good");
}

function restoreArchivedHolding(holdingId) {
  if (!state.vault) return;

  const { account, holding } = findHoldingInVaultById(holdingId);
  if (!account || !holding || !holding.deleted || account.deleted) return;

  const activeCount = account.holdings.filter((item) => !item.deleted).length;
  const stamp = nowIso();
  holding.deleted = false;
  holding.deletedAt = null;
  holding.sortOrder = activeCount + 1;
  holding.updatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
  reindexHoldingSortOrders(account.holdings);
  ensureAtLeastOneActiveHolding();
  renderAllPanels();
  renderArchiveModal();
  void emitHistoryChange("RESTORE", { holdingId: holding.id, holding: buildHistoryHoldingSnapshot(holding) }, account.id);
  schedulePersist();
  scheduleSync();
  setVaultStatus(`持仓「${holding.name || holding.code || "未命名持仓"}」已恢复`, "good");
}

function openUnlockModal() {
  if (state.unlocked) return;
  syncRememberToggleFromStorage();
  if (el.rememberPassphraseInput.checked) {
    el.passphraseInput.value = readRememberedPassphrase();
  } else {
    el.passphraseInput.value = "";
  }
  el.unlockModal.hidden = false;
  updateModalOpenState();
  requestAnimationFrame(() => {
    el.passphraseInput.focus();
    el.passphraseInput.select();
  });
}

function closeUnlockModal() {
  el.unlockModal.hidden = true;
  updateModalOpenState();
}

function openPasswordModal() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再修改口令", "bad");
    openUnlockModal();
    return;
  }

  el.newPassphraseInput.value = "";
  el.confirmPassphraseInput.value = "";
  el.passwordModal.hidden = false;
  updateModalOpenState();

  requestAnimationFrame(() => {
    el.newPassphraseInput.focus();
    el.newPassphraseInput.select();
  });
}

function closePasswordModal() {
  el.passwordModal.hidden = true;
  el.newPassphraseInput.value = "";
  el.confirmPassphraseInput.value = "";
  updateModalOpenState();
}

async function savePasswordChange() {
  if (!state.unlocked || !state.vault) return;

  const nextPassphrase = el.newPassphraseInput.value;
  const confirmPassphrase = el.confirmPassphraseInput.value;

  if (!nextPassphrase || nextPassphrase.length < 8) {
    setVaultStatus("新口令长度至少 8 位", "bad");
    return;
  }

  if (nextPassphrase !== confirmPassphrase) {
    setVaultStatus("两次输入的新口令不一致", "bad");
    return;
  }

  if (nextPassphrase === state.passphrase) {
    setVaultStatus("新旧口令相同，无需修改");
    closePasswordModal();
    return;
  }

  const previousPassphrase = state.passphrase;
  state.passphrase = nextPassphrase;

  try {
    await persistLocalNow();
  } catch (error) {
    state.passphrase = previousPassphrase;
    setVaultStatus(`口令修改失败：${formatError(error)}`, "bad");
    return;
  }

  const remember = Boolean(el.rememberPassphraseInput.checked);
  writeRememberPreference(remember);
  if (remember) {
    writeRememberedPassphrase(nextPassphrase);
  } else {
    clearRememberedPassphrase();
  }

  try {
    await syncCloud();
    setVaultStatus("口令已更新并完成 Gist 备份", "good");
  } catch (error) {
    setVaultStatus(`口令已更新（本地生效），Gist 备份失败：${formatError(error)}`, "bad");
  }

  closePasswordModal();
}

function openHoldingModal(mode = "create", holding = null) {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再编辑持仓", "bad");
    openUnlockModal();
    return;
  }

  const editing = mode === "edit" && holding;
  state.holdingModalMode = editing ? "edit" : "create";
  state.editingHoldingId = editing ? holding.id : null;

  el.holdingModalTitle.textContent = editing ? "编辑持仓" : "新增持仓";
  el.holdingSaveBtn.textContent = editing ? "保存修改" : "新增持仓";

  el.holdingNameInput.value = editing ? String(holding.name || "") : "";
  el.holdingCodeInput.value = editing ? String(holding.code || "") : "";
  el.holdingManualAmountInput.value =
    editing && Number.isFinite(Number(holding.manualAmount)) && Number(holding.manualAmount) > 0
      ? String(holding.manualAmount)
      : "";
  el.holdingManualAmountCurrencyInput.value = editing ? resolveManualAmountCurrency(holding) : "CNY";
  el.holdingUnitsInput.value = editing && holding.units > 0 ? String(holding.units) : "";
  el.holdingClassInput.value = editing ? normalizeAssetClass(holding.assetClass) : "stock";
  el.holdingGroupInput.value = editing && holding.groupName !== DEFAULT_GROUP_NAME ? String(holding.groupName || "") : "";
  el.holdingCostInput.value = editing && holding.cost !== null ? String(holding.cost) : "";
  el.holdingManualPriceInput.value = editing && holding.manualPrice !== null ? String(holding.manualPrice) : "";

  el.holdingModal.hidden = false;
  updateModalOpenState();

  requestAnimationFrame(() => {
    el.holdingNameInput.focus();
    el.holdingNameInput.select();
  });
}

function closeHoldingModal() {
  el.holdingModal.hidden = true;
  state.holdingModalMode = "create";
  state.editingHoldingId = null;
  updateModalOpenState();
}

function readHoldingModalDraft() {
  const name = String(el.holdingNameInput.value || "").trim();
  const manualAmount = Number.parseFloat(el.holdingManualAmountInput.value);
  const units = Number.parseFloat(el.holdingUnitsInput.value);
  const cost = Number.parseFloat(el.holdingCostInput.value);
  const manualPrice = Number.parseFloat(el.holdingManualPriceInput.value);
  return {
    name,
    code: el.holdingCodeInput.value.trim(),
    manualAmount: Number.isFinite(manualAmount) ? manualAmount : null,
    manualAmountCurrency: normalizeManualAmountCurrency(el.holdingManualAmountCurrencyInput.value) || "CNY",
    units: Number.isFinite(units) ? units : 0,
    assetClass: normalizeAssetClass(el.holdingClassInput.value),
    groupName: normalizeGroupName(el.holdingGroupInput.value),
    cost: Number.isFinite(cost) ? cost : null,
    manualPrice: Number.isFinite(manualPrice) ? manualPrice : null,
  };
}

function saveHoldingFromModal() {
  if (!state.unlocked || !state.vault) return;
  const account = getActiveAccount();
  if (!account) return;

  const draft = readHoldingModalDraft();
  let target = null;
  let previousSnapshot = null;
  const creating = !(state.holdingModalMode === "edit" && state.editingHoldingId);

  if (state.holdingModalMode === "edit" && state.editingHoldingId) {
    target = findHoldingById(state.editingHoldingId);
    if (!target || target.deleted) {
      setVaultStatus("目标持仓不存在，无法保存", "bad");
      closeHoldingModal();
      return;
    }
    previousSnapshot = buildHistoryHoldingSnapshot(target);
  } else {
    target = createHolding({ sortOrder: getNextSortOrder(state.vault) });
    account.holdings.push(target);
    reindexHoldingSortOrders(account.holdings);
    updateAccountUpdatedAt(account);
  }

  target.name = draft.name;
  target.code = draft.code;
  target.manualAmount = draft.manualAmount;
  target.manualAmountCurrency = draft.manualAmountCurrency;
  target.units = draft.units;
  target.assetClass = draft.assetClass;
  target.groupName = draft.groupName;
  target.cost = draft.cost;
  target.manualPrice = draft.manualPrice;
  updateHoldingUpdatedAt(target);

  renderAllPanels();
  const nextSnapshot = buildHistoryHoldingSnapshot(target);
  if (creating) {
    void emitHistoryChange("ADD", { holdingId: target.id, holding: nextSnapshot }, account.id);
  } else if (previousSnapshot) {
    const diff = diffTrackedFields(previousSnapshot, nextSnapshot, HOLDING_HISTORY_FIELDS);
    if (diff.changed) {
      void emitHistoryChange("UPDATE", { holdingId: target.id, before: diff.before, after: diff.after }, account.id);
    }
  }
  schedulePersist();
  scheduleSync();
  closeHoldingModal();
}

function updateGroupTargetInVault(groupKey, targetShare) {
  if (!state.vault) return;
  const account = getActiveAccount();
  if (!account) return;
  const before = cloneForHistory(account.settings || {});

  const { classKey, groupName } = parseGroupCompositeKey(groupKey);
  const normalizedKey = buildGroupCompositeKey(classKey, groupName);
  const nextTargets = { ...normalizeGroupTargets(account.settings?.groupTargets) };

  if (Number.isFinite(targetShare) && targetShare > 0) {
    nextTargets[normalizedKey] = targetShare;
  } else {
    delete nextTargets[normalizedKey];
  }

  account.settings.groupTargets = nextTargets;
  const stamp = nowIso();
  account.settingsUpdatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
  const diff = diffTrackedFields(before, account.settings, SETTINGS_HISTORY_FIELDS);
  if (diff.changed) {
    void emitHistoryChange("SETTINGS_CHANGE", { before: diff.before, after: diff.after }, account.id);
  }
}

function openGroupTargetModal(groupKey) {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再设置目标仓位", "bad");
    openUnlockModal();
    return;
  }

  const { snapshot } = getActiveSnapshot();
  const row = buildGroupTargetRows(snapshot).find((item) => item.key === groupKey);
  const parsed = row || (() => {
    const meta = parseGroupCompositeKey(groupKey);
    return {
      key: buildGroupCompositeKey(meta.classKey, meta.groupName),
      classKey: meta.classKey,
      classLabel: ASSET_CLASS_LABELS[meta.classKey] || meta.classKey,
      groupName: meta.groupName,
      currentAmount: 0,
      currentShare: 0,
      targetShare: null,
      targetAmount: null,
      shareDiff: null,
      amountDiff: null,
      hasTarget: false,
    };
  })();

  state.editingGroupTargetKey = parsed.key;
  el.groupTargetModalTitle.textContent = "设置分组目标仓位";
  el.groupTargetModalDesc.textContent = `${parsed.classLabel} / ${parsed.groupName}`;
  el.groupTargetModalCurrent.textContent = `当前仓位 ${formatShareRatio(parsed.currentShare)} · 当前金额 ${formatMoney(parsed.currentAmount)}`;
  el.groupTargetModalSummary.textContent = `${
    parsed.hasTarget ? `当前目标 ${formatShareRatio(parsed.targetShare)}` : "当前未设置目标"
  } · 已设目标合计 ${formatShareRatio(getTotalGroupTargetShare())}。留空或填 0 可清除目标。`;
  el.groupTargetInput.value = parsed.hasTarget ? formatTargetShareInput(parsed.targetShare) : "";
  el.groupTargetClearBtn.hidden = !parsed.hasTarget;

  el.groupTargetModal.hidden = false;
  updateModalOpenState();

  requestAnimationFrame(() => {
    el.groupTargetInput.focus();
    el.groupTargetInput.select();
  });
}

function closeGroupTargetModal() {
  el.groupTargetModal.hidden = true;
  state.editingGroupTargetKey = null;
  el.groupTargetInput.value = "";
  el.groupTargetClearBtn.hidden = false;
  updateModalOpenState();
}

function saveGroupTargetFromModal() {
  if (!state.unlocked || !state.vault || !state.editingGroupTargetKey) return;

  const targetShare = parseTargetShareFromPercentInput(el.groupTargetInput.value);
  if (Number.isNaN(targetShare)) {
    setVaultStatus("目标仓位需填写 0 到 100 之间的数字", "bad");
    return;
  }

  updateGroupTargetInVault(state.editingGroupTargetKey, targetShare);
  const totalTargetShare = getTotalGroupTargetShare();
  renderAllPanels();
  schedulePersist();
  scheduleSync();
  closeGroupTargetModal();

  if (totalTargetShare > 1.0001) {
    setVaultStatus(`目标仓位已保存，但已设目标合计为 ${formatShareRatio(totalTargetShare)}`, "bad");
    return;
  }

  setVaultStatus(targetShare ? "目标仓位已保存" : "目标仓位已清除", "good");
}

function clearGroupTargetFromModal() {
  if (!state.unlocked || !state.vault || !state.editingGroupTargetKey) return;

  updateGroupTargetInVault(state.editingGroupTargetKey, null);
  renderAllPanels();
  schedulePersist();
  scheduleSync();
  closeGroupTargetModal();
  setVaultStatus("目标仓位已清除", "good");
}

function isClassExpanded(classKey) {
  return !state.collapsedClassKeys.has(classKey);
}

function isGroupExpanded(groupKey) {
  return !state.collapsedGroupKeys.has(groupKey);
}

function toggleClassExpanded(classKey) {
  if (state.collapsedClassKeys.has(classKey)) {
    state.collapsedClassKeys.delete(classKey);
  } else {
    state.collapsedClassKeys.add(classKey);
  }
  renderDashboardOnly();
}

function toggleGroupExpanded(groupKey) {
  if (state.collapsedGroupKeys.has(groupKey)) {
    state.collapsedGroupKeys.delete(groupKey);
  } else {
    state.collapsedGroupKeys.add(groupKey);
  }
  renderDashboardOnly();
}

function updateLockUI() {
  document.body.classList.toggle("is-locked", !state.unlocked);

  el.refreshBtn.disabled = false;
  el.unlockOpenBtn.disabled = state.unlocked;
  el.unlockBtn.disabled = state.unlocked;
  el.unlockCancelBtn.disabled = state.unlocked;
  el.lockBtn.disabled = !state.unlocked;
  el.passphraseInput.disabled = state.unlocked;
  el.syncBtn.disabled = !state.unlocked;
  el.syncPullBtn.disabled = !state.unlocked;
  if (el.gistTokenInput) el.gistTokenInput.disabled = false;
  if (el.gistIdInput) el.gistIdInput.disabled = false;
  if (el.gistVerifyBtn) el.gistVerifyBtn.disabled = false;
  el.interval.disabled = !state.unlocked;
  el.quotePreference.disabled = !state.unlocked;
  el.exportBtn.disabled = !state.unlocked;
  el.importBtn.disabled = false;
  if (el.exportHistoryBtn) el.exportHistoryBtn.disabled = !state.unlocked;
  if (el.importHistoryBtn) el.importHistoryBtn.disabled = !state.unlocked;
  if (el.exportDailyNavBtn) el.exportDailyNavBtn.disabled = !state.unlocked;
  if (el.historyReplayDateInput) el.historyReplayDateInput.disabled = !state.unlocked;
  if (el.historyReplayBtn) el.historyReplayBtn.disabled = !state.unlocked;
  el.addRowBtn.disabled = !state.unlocked;
  el.changePassBtn.disabled = !state.unlocked;
  el.accountSelect.disabled = !state.unlocked;
  el.displayCurrencyButtons.forEach((button) => {
    button.disabled = !state.unlocked;
  });
  el.accountAddBtn.disabled = !state.unlocked;
  el.accountRenameBtn.disabled = !state.unlocked;
  el.archiveOpenBtn.disabled = !state.unlocked;
  el.accountDeleteBtn.disabled = !state.unlocked;
  el.viewSort.disabled = !state.unlocked;
  el.treeModeButtons.forEach((button) => {
    button.disabled = !state.unlocked;
  });
  el.pieLevel.disabled = !state.unlocked;
  el.pieModeButtons.forEach((button) => {
    button.disabled = !state.unlocked;
  });
  el.pieDisplayButtons.forEach((button) => {
    button.disabled = !state.unlocked;
  });
  el.unlockOpenBtn.classList.toggle("is-hidden", state.unlocked);
}

function pickChangePct(data) {
  const estimate = Number.parseFloat(data?.estimateChangePct);
  const nav = Number.parseFloat(data?.navChangePct);
  if (data?.source === "EXCHANGE" && Number.isFinite(estimate)) return estimate;
  if (data?.source === "ESTIMATE" && Number.isFinite(estimate)) return estimate;
  if (Number.isFinite(nav)) return nav;
  if (Number.isFinite(estimate)) return estimate;
  return null;
}

function deriveChangeAmount(units, price, changePct) {
  if (!Number.isFinite(units) || !Number.isFinite(price) || !Number.isFinite(changePct)) return null;
  const denominator = 100 + changePct;
  if (denominator <= 0) return null;
  const perUnit = (price * changePct) / denominator;
  return units * perUnit;
}

function deriveChangePctFromAmounts(currentAmount, changeAmount) {
  if (!Number.isFinite(currentAmount) || !Number.isFinite(changeAmount)) return null;
  const previousAmount = currentAmount - changeAmount;
  if (!Number.isFinite(previousAmount) || previousAmount <= 0) return null;
  return (changeAmount / previousAmount) * 100;
}

function resolveQuoteSourceLabel(sourceType, rawLabel, code, quotePreference = normalizeQuotePreference(getActiveAccount()?.settings?.quotePreference)) {
  const source = String(sourceType || "").trim().toUpperCase();
  if (quotePreference === "estimate") {
    if (source === "EXCHANGE") return "场内最新价";
    if (source === "ESTIMATE") return "当日估值";
    if (source === "NAV") return "使用净值";
  }
  return rawLabel || source || "--";
}

function isQuotePending(code) {
  return state.refreshInFlight && /^[0-9]{6}$/.test(String(code || "").trim()) && state.pendingQuoteCodes.has(String(code || "").trim());
}

function buildHoldingMetric(holding) {
  const customName = String(holding.name || "").trim();
  const code = String(holding.code || "").trim();
  const cachedFundName = code ? String(readFundNameCache()[code] || "").trim() : "";
  const manualAmount = Number.isFinite(Number(holding.manualAmount)) ? Number(holding.manualAmount) : null;
  const manualAmountCurrency = normalizeManualAmountCurrency(holding?.manualAmountCurrency);
  const manualPrice = Number.isFinite(Number(holding.manualPrice)) ? Number(holding.manualPrice) : null;
  const displayCurrencyCode = getDisplayCurrencyCode();
  const quotePreference = normalizeQuotePreference(getActiveAccount()?.settings?.quotePreference);
  const pendingQuote = isQuotePending(code);
  const fallbackCurrency = manualAmountCurrency || inferCurrencyCodeFromText(customName) || inferCurrencyCodeFromText(cachedFundName) || "CNY";
  const base = {
    code,
    name: customName || code || "未命名资产",
    price: null,
    priceCurrency: null,
    nativeCurrency: fallbackCurrency,
    changePct: null,
    changeAmount: null,
    sourceLabel: null,
    sourceType: null,
    date: null,
    assetAmount: null,
    costAmount: null,
    pnl: null,
    notice: null,
    isPending: false,
    usesNavFallback: false,
    error: null,
  };

  const convertAmountForDisplay = (value, nativeCurrency) => {
    if (!Number.isFinite(value)) return null;
    return convertMoneyAmount(value, nativeCurrency, displayCurrencyCode);
  };

  const buildMissingFxError = (nativeCurrency) => {
    const resolvedCurrency = normalizeCurrencyCode(nativeCurrency) || "CNY";
    if (resolvedCurrency === displayCurrencyCode) return null;
    return "缺少最新汇率";
  };

  const buildManualAmountMetric = () => {
    if (!(manualAmount > 0)) return null;
    const nativeCurrency = manualAmountCurrency || "CNY";
    const assetAmount = convertAmountForDisplay(manualAmount, nativeCurrency);

    return {
      ...base,
      name: customName || code || "手工资产",
      price: null,
      priceCurrency: nativeCurrency,
      nativeCurrency,
      changePct: null,
      changeAmount: null,
      sourceLabel: "手工录入金额",
      sourceType: "MANUAL_AMOUNT",
      date: null,
      assetAmount,
      costAmount: null,
      pnl: null,
      error: assetAmount === null ? buildMissingFxError(nativeCurrency) : null,
    };
  };

  const buildManualMetric = () => {
    if (!(manualPrice > 0)) return null;

    const nativeCurrency = fallbackCurrency;
    const units = Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
    const cost = Number.isFinite(holding.cost) ? Number(holding.cost) : null;
    const nativeAssetAmount = units > 0 ? units * manualPrice : 0;
    const nativeCostAmount = cost !== null ? units * cost : null;
    const assetAmount = convertAmountForDisplay(nativeAssetAmount, nativeCurrency);
    const costAmount = nativeCostAmount !== null ? convertAmountForDisplay(nativeCostAmount, nativeCurrency) : null;
    const pnl = Number.isFinite(assetAmount) && Number.isFinite(costAmount) ? assetAmount - costAmount : null;
    const fxError =
      assetAmount === null || (nativeCostAmount !== null && costAmount === null) ? buildMissingFxError(nativeCurrency) : null;

    return {
      ...base,
      name: customName || code || "手动价格持仓",
      price: manualPrice,
      priceCurrency: nativeCurrency,
      nativeCurrency,
      changePct: null,
      changeAmount: null,
      sourceLabel: "手动价格",
      sourceType: "MANUAL",
      date: null,
      assetAmount,
      costAmount,
      pnl,
      error: fxError,
    };
  };

  const manualAmountMetric = buildManualAmountMetric();
  if (manualAmountMetric) return manualAmountMetric;

  if (!code) {
    return {
      ...base,
      error: "请填写 6 位基金代码",
    };
  }

  if (!/^[0-9]{6}$/.test(code)) {
    return {
      ...base,
      error: "代码格式错误（应为 6 位数字）",
    };
  }

  const quoteItem = state.quoteMap.get(code);
  if (!quoteItem) {
    const manualMetric = buildManualMetric();
    if (manualMetric) return manualMetric;
    return {
      ...base,
      notice: quotePreference === "estimate" && pendingQuote ? "最新价格读取中" : null,
      isPending: quotePreference === "estimate" && pendingQuote,
      error: quotePreference === "estimate" && pendingQuote ? null : "待刷新行情",
    };
  }

  if (!quoteItem.ok) {
    const manualMetric = buildManualMetric();
    if (manualMetric) return manualMetric;
    return {
      ...base,
      error: quoteItem.error || "查询失败",
    };
  }

  const data = quoteItem.data || {};
  const price = Number.parseFloat(data.price);
  const sourceType = data.source || "NAV";
  const sourceLabel = resolveQuoteSourceLabel(sourceType, data.sourceLabel || "--", code, quotePreference);
  const nativeCurrency = resolveHoldingCurrency(holding, data);
  const usesNavFallback = quotePreference === "estimate" && sourceType === "NAV";
  const date =
    sourceType === "ESTIMATE"
      ? data.estimateDate || data.navDate || null
      : data.navDate || data.estimateDate || null;

  if (!Number.isFinite(price)) {
    const manualMetric = buildManualMetric();
    if (manualMetric) return manualMetric;
    return {
      ...base,
      name: customName || data.name || code,
      priceCurrency: nativeCurrency,
      nativeCurrency,
      sourceLabel,
      sourceType,
      date,
      notice: quotePreference === "estimate" && pendingQuote ? "最新价格读取中" : null,
      isPending: quotePreference === "estimate" && pendingQuote,
      usesNavFallback,
      error: "无有效估值",
    };
  }

  const units = Number.isFinite(Number(holding.units)) ? Number(holding.units) : 0;
  const cost = Number.isFinite(holding.cost) ? Number(holding.cost) : null;
  const changePct = pickChangePct(data);
  const nativeAssetAmount = units > 0 ? units * price : 0;
  const nativeChangeAmount = deriveChangeAmount(units, price, changePct);
  const nativeCostAmount = cost !== null ? units * cost : null;
  const assetAmount = convertAmountForDisplay(nativeAssetAmount, nativeCurrency);
  const changeAmount = Number.isFinite(nativeChangeAmount) ? convertAmountForDisplay(nativeChangeAmount, nativeCurrency) : null;
  const costAmount = nativeCostAmount !== null ? convertAmountForDisplay(nativeCostAmount, nativeCurrency) : null;
  const pnl = Number.isFinite(assetAmount) && Number.isFinite(costAmount) ? assetAmount - costAmount : null;
  const fxError =
    assetAmount === null ||
    (Number.isFinite(nativeChangeAmount) && changeAmount === null) ||
    (nativeCostAmount !== null && costAmount === null)
      ? buildMissingFxError(nativeCurrency)
      : null;

  return {
    ...base,
    name: customName || data.name || code,
    price,
    priceCurrency: nativeCurrency,
    nativeCurrency,
    changePct,
    changeAmount,
    sourceLabel,
    sourceType,
    date,
    notice: quotePreference === "estimate" && pendingQuote ? "最新价格读取中，沿用上次结果" : null,
    isPending: quotePreference === "estimate" && pendingQuote,
    usesNavFallback,
    assetAmount,
    costAmount,
    pnl,
    error: fxError,
  };
}

function createEmptyStat() {
  return {
    amount: 0,
    changeAmount: 0,
    hasChange: false,
    count: 0,
    navFallbackCount: 0,
    pendingCount: 0,
  };
}

function addStat(map, key, amount, changeAmount, options = {}) {
  if (!map.has(key)) {
    map.set(key, createEmptyStat());
  }

  const stat = map.get(key);
  stat.count += 1;
  if (options.usesNavFallback) stat.navFallbackCount += 1;
  if (options.isPending) stat.pendingCount += 1;

  if (Number.isFinite(amount)) {
    stat.amount += amount;
  }

  if (Number.isFinite(changeAmount)) {
    stat.changeAmount += changeAmount;
    stat.hasChange = true;
  }
}

function statChangePct(stat) {
  if (!stat?.hasChange) return null;
  return deriveChangePctFromAmounts(stat.amount, stat.changeAmount);
}

function buildPortfolioSnapshot(activeHoldings) {
  const metrics = new Map();
  const classStats = new Map();
  const groupStats = new Map();
  let totalAsset = 0;
  let totalCost = 0;
  let hasAnyCost = false;
  let totalChangeAmount = 0;
  let hasAnyChange = false;
  let totalNavFallbackCount = 0;
  let totalPendingCount = 0;

  activeHoldings.forEach((holding) => {
    const metric = buildHoldingMetric(holding);
    metrics.set(holding.id, metric);

    const classKey = normalizeAssetClass(holding.assetClass);
    const groupKey = getHoldingGroupName(holding);
    const groupComposite = buildGroupCompositeKey(classKey, groupKey);

    const amount = Number.isFinite(metric.assetAmount) ? metric.assetAmount : 0;
    const changeAmount = Number.isFinite(metric.changeAmount) ? metric.changeAmount : null;
    const statOptions = {
      usesNavFallback: Boolean(metric.usesNavFallback),
      isPending: Boolean(metric.isPending),
    };

    addStat(classStats, classKey, amount, changeAmount, statOptions);
    addStat(groupStats, groupComposite, amount, changeAmount, statOptions);
    if (metric.usesNavFallback) totalNavFallbackCount += 1;
    if (metric.isPending) totalPendingCount += 1;

    if (Number.isFinite(metric.assetAmount)) {
      totalAsset += metric.assetAmount;
    }

    if (Number.isFinite(metric.costAmount)) {
      totalCost += metric.costAmount;
      hasAnyCost = true;
    }

    if (Number.isFinite(metric.changeAmount)) {
      totalChangeAmount += metric.changeAmount;
      hasAnyChange = true;
    }
  });

  return {
    metrics,
    classStats,
    groupStats,
    totalAsset,
    totalCost,
    hasAnyCost,
    totalPnl: hasAnyCost ? totalAsset - totalCost : null,
    totalChangeAmount,
    hasAnyChange,
    totalChangePct: hasAnyChange ? deriveChangePctFromAmounts(totalAsset, totalChangeAmount) : null,
    totalNavFallbackCount,
    totalPendingCount,
  };
}

function buildQuoteDebugEntry(holding, metric, quoteItem) {
  const data = quoteItem?.ok ? quoteItem.data || {} : {};
  const quoteError = quoteItem && quoteItem.ok === false ? quoteItem.error || "查询失败" : null;
  const priceCurrency = normalizeCurrencyCode(metric.priceCurrency || metric.nativeCurrency || data.currency) || "CNY";

  return {
    holdingId: holding.id,
    code: String(holding.code || "").trim(),
    name: metric.name || holding.name || data.name || holding.code || "未命名资产",
    assetClass: normalizeAssetClass(holding.assetClass),
    groupName: getHoldingGroupName(holding),
    source: metric.sourceType || data.source || "--",
    sourceLabel: metric.sourceLabel || data.sourceLabel || "--",
    price: Number.isFinite(metric.price) ? metric.price : Number.parseFloat(data.price),
    priceCurrency,
    assetAmount: Number.isFinite(metric.assetAmount) ? metric.assetAmount : null,
    changeAmount: Number.isFinite(metric.changeAmount) ? metric.changeAmount : null,
    changePct: Number.isFinite(metric.changePct) ? metric.changePct : null,
    date: metric.date || data.estimateDate || data.navDate || null,
    estimateNav: Number.parseFloat(data.estimateNav),
    estimateDate: data.estimateDate || null,
    nav: Number.parseFloat(data.nav),
    navDate: data.navDate || null,
    error: metric.error || quoteError || null,
    quoteError,
  };
}

function buildQuoteDebugChange(entry, previous) {
  if (!previous) return null;

  const sourceChanged = !sameDebugText(previous.source, entry.source) || !sameDebugText(previous.sourceLabel, entry.sourceLabel);
  const priceChanged =
    !sameDebugNumber(previous.price, entry.price) || !sameDebugText(previous.priceCurrency, entry.priceCurrency);
  const amountChanged = !sameDebugNumber(previous.assetAmount, entry.assetAmount);
  const errorChanged = !sameDebugText(previous.error, entry.error);
  const dateChanged = !sameDebugText(previous.date, entry.date);

  if (!sourceChanged && !priceChanged && !amountChanged && !errorChanged && !dateChanged) {
    return null;
  }

  return {
    ...entry,
    previousSource: previous.source,
    previousSourceLabel: previous.sourceLabel,
    previousPrice: previous.price,
    previousPriceCurrency: previous.priceCurrency,
    previousAssetAmount: previous.assetAmount,
    previousDate: previous.date,
    previousError: previous.error,
    sourceChanged,
    priceChanged,
    amountChanged,
    errorChanged,
    dateChanged,
    assetAmountDiff:
      Number.isFinite(entry.assetAmount) && Number.isFinite(previous.assetAmount)
        ? entry.assetAmount - previous.assetAmount
        : null,
  };
}

function captureQuoteDiagnostics(activeHoldings, snapshot) {
  const account = getActiveAccount();
  if (!account) return;

  const displayCurrencyCode = getDisplayCurrencyCode();
  const quotePreference = normalizeQuotePreference(account?.settings?.quotePreference);
  const previousRecord = state.quoteDebugByAccount[account.id] || null;
  const comparablePrevious =
    previousRecord &&
    previousRecord.displayCurrencyCode === displayCurrencyCode &&
    previousRecord.quotePreference === quotePreference
      ? previousRecord
      : null;
  const previousEntries = new Map((comparablePrevious?.entries || []).map((entry) => [entry.holdingId, entry]));

  const entries = activeHoldings
    .map((holding) => {
      const metric = snapshot.metrics.get(holding.id) || buildHoldingMetric(holding);
      const quoteItem = holding.code ? state.quoteMap.get(holding.code) : null;
      return buildQuoteDebugEntry(holding, metric, quoteItem);
    })
    .sort((a, b) => {
      const amountDiff = compareBySortValue(a.assetAmount, b.assetAmount);
      if (amountDiff !== 0) return amountDiff;
      return String(a.code || a.name).localeCompare(String(b.code || b.name), "zh-CN");
    });

  const changes = entries
    .map((entry) => buildQuoteDebugChange(entry, previousEntries.get(entry.holdingId)))
    .filter(Boolean)
    .sort((a, b) => {
      const diffA = Number.isFinite(a.assetAmountDiff) ? Math.abs(a.assetAmountDiff) : -1;
      const diffB = Number.isFinite(b.assetAmountDiff) ? Math.abs(b.assetAmountDiff) : -1;
      if (diffB !== diffA) return diffB - diffA;
      if (a.sourceChanged !== b.sourceChanged) return a.sourceChanged ? -1 : 1;
      if (a.priceChanged !== b.priceChanged) return a.priceChanged ? -1 : 1;
      return String(a.code || a.name).localeCompare(String(b.code || b.name), "zh-CN");
    });

  state.quoteDebugByAccount[account.id] = {
    refreshedAt: nowIso(),
    displayCurrencyCode,
    quotePreference,
    totalAsset: snapshot.totalAsset,
    totalAssetDiff: comparablePrevious ? snapshot.totalAsset - comparablePrevious.totalAsset : null,
    baselineReason: comparablePrevious ? null : previousRecord ? "mode_changed" : "first_refresh",
    entries,
    changes,
  };
}

function clearActiveQuoteDiagnostics() {
  const account = getActiveAccount();
  if (!account) return;
  delete state.quoteDebugByAccount[account.id];
}

function createQuoteDebugBadge(text, type = "source") {
  const badge = document.createElement("span");
  badge.className = `quote-debug-badge is-${type}`;
  badge.textContent = text;
  return badge;
}

function createQuoteDebugItemElement(item, mode, currencyCode) {
  const wrapper = document.createElement("div");
  wrapper.className = "quote-debug-item";

  const head = document.createElement("div");
  head.className = "quote-debug-item-head";

  const titleWrap = document.createElement("div");
  const title = document.createElement("p");
  title.className = "quote-debug-item-title";
  title.textContent = `${item.name || item.code || "未命名资产"}${item.code ? ` (${item.code})` : ""}`;
  titleWrap.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "quote-debug-item-subtitle";
  const classLabel = ASSET_CLASS_LABELS[normalizeAssetClass(item.assetClass)] || normalizeAssetClass(item.assetClass);
  subtitle.textContent = `${classLabel} / ${normalizeGroupName(item.groupName)}`;
  titleWrap.appendChild(subtitle);
  head.appendChild(titleWrap);

  const badges = document.createElement("div");
  badges.className = "quote-debug-badges";
  badges.appendChild(createQuoteDebugBadge(item.sourceLabel || item.source || "--", "source"));
  if (mode === "change") {
    if (item.sourceChanged) badges.appendChild(createQuoteDebugBadge("来源变更", "change"));
    if (item.priceChanged) badges.appendChild(createQuoteDebugBadge("价格变更", "change"));
    if (item.amountChanged) badges.appendChild(createQuoteDebugBadge("金额变更", "change"));
    if (item.errorChanged) badges.appendChild(createQuoteDebugBadge("状态变更", "error"));
  } else if (item.error) {
    badges.appendChild(createQuoteDebugBadge("有错误", "error"));
  }
  head.appendChild(badges);
  wrapper.appendChild(head);

  const primary = document.createElement("p");
  primary.className = "quote-debug-item-meta";
  if (mode === "change") {
    primary.textContent =
      `本次 ${item.sourceLabel || item.source || "--"} ${formatDebugPrice(item.price, item.priceCurrency)} · ` +
      `上次 ${item.previousSourceLabel || item.previousSource || "--"} ${formatDebugPrice(item.previousPrice, item.previousPriceCurrency)}`;
  } else {
    primary.textContent =
      `来源 ${item.sourceLabel || item.source || "--"} · 价格 ${formatDebugPrice(item.price, item.priceCurrency)} · ` +
      `资产 ${formatMoney(item.assetAmount, currencyCode)}`;
  }
  wrapper.appendChild(primary);

  const secondary = document.createElement("p");
  secondary.className = "quote-debug-item-meta";
  const parts = [];
  if (mode === "change") {
    parts.push(
      `资产 ${formatMoney(item.assetAmount, currencyCode)}${
        Number.isFinite(item.assetAmountDiff) ? `（较上次 ${formatSignedMoney(item.assetAmountDiff, currencyCode)}）` : ""
      }`,
    );
    parts.push(`日期 ${formatDebugDateTime(item.date)}`);
    parts.push(`上次 ${formatDebugDateTime(item.previousDate)}`);
  } else {
    if (Number.isFinite(item.estimateNav)) parts.push(`估值 ${formatDebugPrice(item.estimateNav, item.priceCurrency)} @ ${formatDebugDateTime(item.estimateDate)}`);
    if (Number.isFinite(item.nav)) parts.push(`净值 ${formatDebugPrice(item.nav, item.priceCurrency)} @ ${formatDebugDateTime(item.navDate)}`);
    if (Number.isFinite(item.changeAmount) || Number.isFinite(item.changePct)) {
      parts.push(`涨跌 ${formatSignedMoney(item.changeAmount, currencyCode)} / ${formatPercent(item.changePct, 2)}`);
    }
  }
  secondary.textContent = parts.filter(Boolean).join(" · ") || "暂无更多报价细节";
  wrapper.appendChild(secondary);

  if (item.error || item.quoteError || item.previousError) {
    const error = document.createElement("p");
    error.className = "quote-debug-item-meta is-error";
    if (mode === "change" && item.errorChanged) {
      error.textContent = `状态 本次：${item.error || "正常"} · 上次：${item.previousError || "正常"}`;
    } else {
      error.textContent = `状态 ${item.error || item.quoteError}`;
    }
    wrapper.appendChild(error);
  }

  return wrapper;
}

function renderQuoteDebugList(container, items, mode, currencyCode) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "quote-debug-empty";
    empty.textContent = mode === "change" ? "和上次刷新相比，暂未检测到报价来源或金额变化。" : "暂无本次报价明细。";
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    fragment.appendChild(createQuoteDebugItemElement(item, mode, currencyCode));
  });
  container.appendChild(fragment);
}

function renderQuoteDebugPanel() {
  if (!el.quoteDebugSummary || !el.quoteDebugChanges || !el.quoteDebugCurrent) return;

  if (!state.vault) {
    el.quoteDebugSummary.textContent = "解锁后刷新一次，即可看到报价来源和波动诊断。";
    renderQuoteDebugList(el.quoteDebugChanges, [], "change", getDisplayCurrencyCode());
    renderQuoteDebugList(el.quoteDebugCurrent, [], "current", getDisplayCurrencyCode());
    return;
  }

  const account = getActiveAccount();
  const record = account ? state.quoteDebugByAccount[account.id] : null;
  if (!record) {
    el.quoteDebugSummary.textContent = "当前账户还没有刷新诊断数据，刷新一次后这里会显示每只基金的报价来源和差异。";
    renderQuoteDebugList(el.quoteDebugChanges, [], "change", getDisplayCurrencyCode());
    renderQuoteDebugList(el.quoteDebugCurrent, [], "current", getDisplayCurrencyCode());
    return;
  }

  const modeLabel = record.quotePreference === "estimate" ? "最新价格" : "优先净值";
  const baselineText =
    record.totalAssetDiff === null
      ? record.baselineReason === "mode_changed"
        ? "本次作为新基线（计价或净值模式已切换）"
        : "本次作为首次基线"
      : `总资产较上次 ${formatSignedMoney(record.totalAssetDiff, record.displayCurrencyCode)}`;
  el.quoteDebugSummary.textContent =
    `${formatDebugDateTime(record.refreshedAt)} · ${modeLabel} · 当前总资产 ${formatMoney(record.totalAsset, record.displayCurrencyCode)} · ` +
    `${baselineText} · ${record.changes.length}/${record.entries.length} 条发生变化`;

  renderQuoteDebugList(el.quoteDebugChanges, record.changes.slice(0, 20), "change", record.displayCurrencyCode);
  renderQuoteDebugList(el.quoteDebugCurrent, record.entries, "current", record.displayCurrencyCode);
}

function buildClassBuckets(activeHoldings) {
  const classBuckets = new Map();

  activeHoldings.forEach((holding) => {
    const classKey = normalizeAssetClass(holding.assetClass);
    const groupKey = getHoldingGroupName(holding);

    if (!classBuckets.has(classKey)) {
      classBuckets.set(classKey, new Map());
    }

    const groups = classBuckets.get(classKey);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }

    groups.get(groupKey).push(holding);
  });

  return classBuckets;
}

function compareBySortValue(aValue, bValue) {
  if (Number.isFinite(aValue) && Number.isFinite(bValue)) {
    if (bValue !== aValue) return bValue - aValue;
    return 0;
  }
  if (Number.isFinite(aValue)) return -1;
  if (Number.isFinite(bValue)) return 1;
  return 0;
}

function getStatSortValue(stat, sortMode) {
  if (sortMode === "default") return null;
  if (sortMode === "change_pct") {
    return statChangePct(stat);
  }
  return Number.isFinite(stat?.amount) ? stat.amount : null;
}

function getMetricSortValue(metric, sortMode) {
  if (sortMode === "default") return null;
  if (sortMode === "change_pct") {
    return Number.isFinite(metric?.changePct) ? metric.changePct : null;
  }
  return Number.isFinite(metric?.assetAmount) ? metric.assetAmount : null;
}

function getActiveSnapshot() {
  const active = state.vault ? vaultToActiveHoldings(state.vault) : [];
  const snapshot = buildPortfolioSnapshot(active);
  return { active, snapshot };
}

function updateSummaryCards(snapshot) {
  el.totalAsset.textContent = formatMoney(snapshot.totalAsset);
  el.totalCost.textContent = snapshot.hasAnyCost ? formatMoney(snapshot.totalCost) : "--";
  el.totalPnl.textContent = snapshot.totalPnl === null ? "--" : formatMoney(snapshot.totalPnl);
  el.totalPnl.classList.remove("is-good", "is-bad", "is-up", "is-down");
  if (snapshot.totalPnl !== null) {
    if (snapshot.totalPnl > 0) el.totalPnl.classList.add("is-up");
    if (snapshot.totalPnl < 0) el.totalPnl.classList.add("is-down");
  }

  const totalChangeAmount = snapshot.hasAnyChange ? snapshot.totalChangeAmount : null;
  const totalChangePct = snapshot.hasAnyChange ? snapshot.totalChangePct : null;

  if (el.overviewDayChange) {
    el.overviewDayChange.textContent = formatSignedMoney(totalChangeAmount);
    el.overviewDayChange.classList.remove("is-up", "is-down");
    if (Number.isFinite(totalChangeAmount)) {
      if (totalChangeAmount > 0) el.overviewDayChange.classList.add("is-up");
      if (totalChangeAmount < 0) el.overviewDayChange.classList.add("is-down");
    }
  }

  if (el.overviewDayChangePct) {
    el.overviewDayChangePct.textContent = formatPercent(totalChangePct, 2);
    el.overviewDayChangePct.classList.remove("is-up", "is-down");
    if (Number.isFinite(totalChangePct)) {
      if (totalChangePct > 0) el.overviewDayChangePct.classList.add("is-up");
      if (totalChangePct < 0) el.overviewDayChangePct.classList.add("is-down");
    }
  }

  if (isLatestPriceMode()) {
    const parts = [];
    if (snapshot.totalPendingCount > 0) parts.push(`${snapshot.totalPendingCount} 项最新价格读取中`);
    if (snapshot.totalNavFallbackCount > 0) parts.push(`含 ${snapshot.totalNavFallbackCount} 项使用净值`);
    if (parts.length > 0) {
      el.lastRefresh.textContent = parts.join("；");
    }
  }
}

function clearViewTable(message = "暂无持仓") {
  el.viewTableBody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 2;
  cell.textContent = message;
  cell.className = "name-cell";
  row.appendChild(cell);
  el.viewTableBody.appendChild(row);
}

function buildAggregateQuoteNotice(stat, quotePreference = normalizeQuotePreference(getActiveAccount()?.settings?.quotePreference)) {
  if (quotePreference !== "estimate") return "";
  const parts = [];
  if (stat?.pendingCount > 0) parts.push(`${stat.pendingCount} 项最新价格读取中`);
  if (stat?.navFallbackCount > 0) parts.push(`含 ${stat.navFallbackCount} 项使用净值`);
  return parts.join(" / ");
}

function getViewLevelBadge(level) {
  if (level === 1) return "类";
  if (level === 2) return "组";
  return "基";
}

function createTreeDepth(level) {
  const depth = document.createElement("span");
  depth.className = `tree-depth tree-depth-${level}`;

  if (level === 1) {
    const root = document.createElement("span");
    root.className = "tree-root";
    depth.appendChild(root);
    return depth;
  }

  for (let index = 1; index < level; index += 1) {
    const segment = document.createElement("span");
    segment.className = index === level - 1 ? "tree-branch" : "tree-rail";
    depth.appendChild(segment);
  }

  return depth;
}

function createViewRow({
  level,
  label,
  subtext,
  amount,
  changeAmount,
  changePct,
  totalAsset,
  toggle = null,
  onOpen = null,
  actionLabel = "",
}) {
  const row = document.createElement("tr");
  row.className = `view-row-level-${level}`;
  row.dataset.level = String(level);

  const nameCell = document.createElement("td");
  nameCell.dataset.label = "名称 / 金额";
  nameCell.className = `name-cell name-indent-${level}`;
  const nameInner = document.createElement("div");
  nameInner.className = "name-inner";
  nameInner.appendChild(createTreeDepth(level));

  if (toggle) {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "toggle-btn";
    toggleBtn.textContent = toggle.expanded ? "▾" : "▸";
    toggleBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle.onToggle();
    });
    nameInner.appendChild(toggleBtn);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "toggle-spacer";
    spacer.setAttribute("aria-hidden", "true");
    nameInner.appendChild(spacer);
  }

  const nameStack = document.createElement("div");
  nameStack.className = "name-stack";
  const nameLine = document.createElement("div");
  nameLine.className = "name-line";

  const badgeSpan = document.createElement("span");
  badgeSpan.className = `level-badge level-badge-${level}`;
  badgeSpan.textContent = getViewLevelBadge(level);
  nameLine.appendChild(badgeSpan);

  const labelSpan = document.createElement("span");
  labelSpan.className = "name-label";
  labelSpan.textContent = label;
  nameLine.appendChild(labelSpan);

  const subLine = document.createElement("div");
  subLine.className = "name-meta";
  if (subtext) {
    const sub = document.createElement("span");
    sub.className = "name-subtext";
    sub.textContent = subtext;
    subLine.appendChild(sub);
  }

  const amountLine = document.createElement("div");
  amountLine.className = "metric-primary";
  amountLine.textContent = formatMoney(amount);

  const shareLine = document.createElement("div");
  shareLine.className = "metric-secondary";
  shareLine.textContent = `占比 ${formatShare(amount, totalAsset)}`;

  nameStack.append(nameLine);
  if (subtext) {
    nameStack.append(subLine);
  }
  nameStack.append(amountLine, shareLine);
  nameInner.appendChild(nameStack);
  nameCell.appendChild(nameInner);

  const changeCell = document.createElement("td");
  changeCell.dataset.label = "当日盈亏";
  changeCell.className = "change-cell";

  const changeStack = document.createElement("div");
  changeStack.className = "metric-stack";

  const changeAmountLine = document.createElement("div");
  changeAmountLine.className = "metric-primary";
  changeAmountLine.textContent = formatSignedMoney(changeAmount);

  const changePctLine = document.createElement("div");
  changePctLine.className = "metric-secondary";
  changePctLine.textContent = formatPercent(changePct, 2);

  const trend = Number.isFinite(changeAmount)
    ? Math.sign(changeAmount)
    : Number.isFinite(changePct)
      ? Math.sign(changePct)
      : 0;
  if (trend > 0) {
    changeAmountLine.classList.add("is-up");
    changePctLine.classList.add("is-up");
  } else if (trend < 0) {
    changeAmountLine.classList.add("is-down");
    changePctLine.classList.add("is-down");
  }

  changeStack.append(changeAmountLine, changePctLine);
  changeCell.appendChild(changeStack);

  row.append(nameCell, changeCell);

  if (typeof onOpen === "function") {
    row.classList.add("is-clickable");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", actionLabel || label);
    row.addEventListener("click", () => onOpen());
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpen();
    });
  }

  return row;
}

function renderViewTable(activeHoldings, snapshot) {
  if (activeHoldings.length === 0) {
    clearViewTable("暂无持仓，请到配置管理中新增");
    return;
  }

  const sortMode = getSortMode();
  const classBuckets = buildClassBuckets(activeHoldings);
  const fragment = document.createDocumentFragment();

  const classEntries = [...classBuckets.entries()]
    .map(([classKey, groups]) => {
      const stat = snapshot.classStats.get(classKey) || createEmptyStat();
      const allHoldings = [...groups.values()].flat();
      const defaultRank = Math.min(...allHoldings.map((item) => getHoldingOrderValue(item)));
      return { classKey, groups, stat, defaultRank };
    })
    .sort((a, b) => {
      if (sortMode === "default") {
        const byRank = a.defaultRank - b.defaultRank;
        if (byRank !== 0) return byRank;
        return (ASSET_CLASS_ORDER.indexOf(a.classKey) || 0) - (ASSET_CLASS_ORDER.indexOf(b.classKey) || 0);
      }

      const sortValueA = getStatSortValue(a.stat, sortMode);
      const sortValueB = getStatSortValue(b.stat, sortMode);
      const cmp = compareBySortValue(sortValueA, sortValueB);
      if (cmp !== 0) return cmp;
      return a.defaultRank - b.defaultRank;
    });

  classEntries.forEach(({ classKey, groups, stat }) => {
    const classExpanded = isClassExpanded(classKey);
    fragment.appendChild(
      createViewRow({
        level: 1,
        label: ASSET_CLASS_LABELS[classKey] || classKey,
        subtext: buildAggregateQuoteNotice(stat),
        amount: stat.amount,
        changeAmount: stat.hasChange ? stat.changeAmount : null,
        changePct: statChangePct(stat),
        totalAsset: snapshot.totalAsset,
        toggle: {
          expanded: classExpanded,
          onToggle: () => toggleClassExpanded(classKey),
        },
        onOpen: () => toggleClassExpanded(classKey),
        actionLabel: `${ASSET_CLASS_LABELS[classKey] || classKey} 展开或收起`,
      }),
    );

    if (!classExpanded) return;

    const groupEntries = [...groups.entries()]
      .map(([groupName, holdings]) => {
        const groupKey = buildGroupCompositeKey(classKey, groupName);
        const groupStat = snapshot.groupStats.get(groupKey) || createEmptyStat();
        const defaultRank = Math.min(...holdings.map((item) => getHoldingOrderValue(item)));
        return { groupName, holdings, groupStat, defaultRank };
      })
      .sort((a, b) => {
        if (sortMode === "default") {
          const byRank = a.defaultRank - b.defaultRank;
          if (byRank !== 0) return byRank;
          return a.groupName.localeCompare(b.groupName, "zh-CN");
        }

        const sortValueA = getStatSortValue(a.groupStat, sortMode);
        const sortValueB = getStatSortValue(b.groupStat, sortMode);
        const cmp = compareBySortValue(sortValueA, sortValueB);
        if (cmp !== 0) return cmp;
        return a.defaultRank - b.defaultRank;
      });

    groupEntries.forEach(({ groupName, holdings, groupStat }) => {
      const groupKey = buildGroupCompositeKey(classKey, groupName);
      const groupExpanded = isGroupExpanded(groupKey);
      fragment.appendChild(
        createViewRow({
          level: 2,
          label: groupName,
          subtext: buildAggregateQuoteNotice(groupStat),
          amount: groupStat.amount,
          changeAmount: groupStat.hasChange ? groupStat.changeAmount : null,
          changePct: statChangePct(groupStat),
          totalAsset: snapshot.totalAsset,
          toggle: {
            expanded: groupExpanded,
            onToggle: () => toggleGroupExpanded(groupKey),
          },
          onOpen: () => toggleGroupExpanded(groupKey),
          actionLabel: `${groupName} 展开或收起`,
        }),
      );

      if (!groupExpanded) return;

      const fundEntries = [...holdings]
        .map((holding) => ({ holding, metric: snapshot.metrics.get(holding.id) || buildHoldingMetric(holding) }))
        .sort((a, b) => {
          if (sortMode === "default") {
            return getHoldingOrderValue(a.holding) - getHoldingOrderValue(b.holding);
          }
          const sortValueA = getMetricSortValue(a.metric, sortMode);
          const sortValueB = getMetricSortValue(b.metric, sortMode);
          const cmp = compareBySortValue(sortValueA, sortValueB);
          if (cmp !== 0) return cmp;
          return getHoldingOrderValue(a.holding) - getHoldingOrderValue(b.holding);
        });

      fundEntries.forEach(({ holding, metric }) => {
        const subtextParts = [];
        if (holding.code) subtextParts.push(holding.code);
        if (metric.sourceType) subtextParts.push(metric.sourceLabel);
        if (metric.notice) subtextParts.push(metric.notice);
        if (metric.error) subtextParts.push(metric.error);

        const fallbackChangePct = Number.isFinite(metric.changePct)
          ? metric.changePct
          : deriveChangePctFromAmounts(metric.assetAmount, metric.changeAmount);

        fragment.appendChild(
          createViewRow({
            level: 3,
            label: metric.name || holding.code || "未填写基金代码",
            subtext: subtextParts.length > 0 ? `(${subtextParts.join(" / ")})` : "",
            amount: metric.assetAmount,
            changeAmount: metric.changeAmount,
            changePct: fallbackChangePct,
            totalAsset: snapshot.totalAsset,
            onOpen: () => openHoldingModal("edit", holding),
            actionLabel: `编辑 ${metric.name || holding.code || "基金"}`,
          }),
        );
      });
    });
  });

  el.viewTableBody.innerHTML = "";
  el.viewTableBody.appendChild(fragment);
}

function pieLevelSubtitle(level) {
  if (level === "group") return "按分组展示，轻触饼图或按钮切换";
  if (level === "fund") return "按基金展示，轻触饼图或按钮切换";
  return "按资产大类展示，轻触饼图或按钮切换";
}

function buildPieSeries(level, activeHoldings, snapshot) {
  const items = [];

  if (level === "group") {
    snapshot.groupStats.forEach((stat, key) => {
      if (!Number.isFinite(stat.amount) || stat.amount <= 0) return;
      const { groupName } = parseGroupCompositeKey(key);
      items.push({
        label: groupName || DEFAULT_GROUP_NAME,
        value: stat.amount,
      });
    });
  } else if (level === "fund") {
    activeHoldings.forEach((holding) => {
      const metric = snapshot.metrics.get(holding.id) || buildHoldingMetric(holding);
      if (!Number.isFinite(metric.assetAmount) || metric.assetAmount <= 0) return;
      const label = `${metric.name || holding.code || "未命名"} (${holding.code || "--"})`;
      items.push({ label, value: metric.assetAmount });
    });
  } else {
    ASSET_CLASS_ORDER.forEach((classKey) => {
      const stat = snapshot.classStats.get(classKey);
      if (!stat || !Number.isFinite(stat.amount) || stat.amount <= 0) return;
      items.push({
        label: ASSET_CLASS_LABELS[classKey] || classKey,
        value: stat.amount,
      });
    });
  }

  items.sort((a, b) => b.value - a.value);

  return items;
}

function truncatePieLabel(label, maxLength) {
  const text = String(label || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function layoutOutsidePieLabels(entries, minY, maxY, gap) {
  if (!entries.length) return entries;

  entries.sort((a, b) => a.targetY - b.targetY);
  let nextY = minY;
  entries.forEach((entry) => {
    entry.labelY = Math.max(entry.targetY, nextY);
    nextY = entry.labelY + gap;
  });

  if (entries[entries.length - 1].labelY > maxY) {
    let prevY = maxY;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      entries[index].labelY = Math.min(entries[index].labelY, prevY);
      prevY = entries[index].labelY - gap;
    }

    if (entries[0].labelY < minY) {
      const shift = minY - entries[0].labelY;
      entries.forEach((entry) => {
        entry.labelY += shift;
      });
    }
  }

  return entries;
}

function drawPieChart(items, totalAsset, displayMode = "full", options = {}) {
  const {
    canvas = el.pieCanvas,
    emptyText = "暂无可绘制资产数据",
    centerLabel = displayMode === "percent" ? "比例视图" : "总资产",
    centerValue = displayMode === "percent" ? "100%" : formatMoney(totalAsset),
  } = options;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width > 40 ? rect.width : 640;
  const cssHeight = rect.height > 40 ? rect.height : 300;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (!items.length || !Number.isFinite(totalAsset) || totalAsset <= 0) {
    ctx.fillStyle = "#4a646f";
    ctx.font = "14px \"Noto Sans SC\", sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(emptyText, cssWidth / 2, cssHeight / 2);
    return;
  }

  const isCompact = cssWidth <= 520;
  const centerX = cssWidth / 2;
  const centerY = cssHeight / 2;
  const radius = Math.min(cssWidth * (isCompact ? 0.25 : 0.28), cssHeight * (isCompact ? 0.28 : 0.31));
  const insideFontSize = isCompact ? 9 : 10;
  const outsideFontSize = isCompact ? 9 : 10;
  const labelMaxLength = isCompact ? 7 : 11;
  const minGap = isCompact ? 12 : 14;
  const leaderOffset = isCompact ? 12 : 16;
  const labelMargin = isCompact ? 8 : 12;
  const outsideLeft = [];
  const outsideRight = [];
  let start = -Math.PI / 2;

  items.forEach((item, index) => {
    const angle = (item.value / totalAsset) * Math.PI * 2;
    const color = PIE_COLORS[index % PIE_COLORS.length];
    const end = start + angle;
    const mid = start + angle / 2;
    const shareText = formatShare(item.value, totalAsset);

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    const canDrawInside = angle >= (isCompact ? 0.72 : 0.56);
    const labelText = truncatePieLabel(item.label, labelMaxLength);

    if (canDrawInside) {
      const innerRadius = radius * 0.7;
      const labelX = centerX + Math.cos(mid) * innerRadius;
      const labelY = centerY + Math.sin(mid) * innerRadius;

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${insideFontSize}px "Noto Sans SC", sans-serif`;
      ctx.fillText(labelText, labelX, labelY - insideFontSize * 0.55);
      ctx.font = `600 ${insideFontSize - 1}px "Noto Sans SC", sans-serif`;
      ctx.fillText(shareText, labelX, labelY + insideFontSize * 0.7);
    } else {
      const edgeX = centerX + Math.cos(mid) * radius;
      const edgeY = centerY + Math.sin(mid) * radius;
      const bendX = centerX + Math.cos(mid) * (radius + leaderOffset);
      const bendY = centerY + Math.sin(mid) * (radius + leaderOffset);
      const side = Math.cos(mid) >= 0 ? "right" : "left";

      const entry = {
        color,
        side,
        edgeX,
        edgeY,
        bendX,
        bendY,
        targetY: bendY,
        text: `${labelText} ${shareText}`,
      };

      if (side === "right") {
        outsideRight.push(entry);
      } else {
        outsideLeft.push(entry);
      }
    }

    start = end;
  });

  layoutOutsidePieLabels(outsideLeft, labelMargin + outsideFontSize, cssHeight - labelMargin - outsideFontSize, minGap);
  layoutOutsidePieLabels(outsideRight, labelMargin + outsideFontSize, cssHeight - labelMargin - outsideFontSize, minGap);

  [...outsideLeft, ...outsideRight].forEach((entry) => {
    const labelX = entry.side === "right" ? cssWidth - labelMargin : labelMargin;
    const lineEndX = entry.side === "right" ? labelX - 3 : labelX + 3;

    ctx.beginPath();
    ctx.moveTo(entry.edgeX, entry.edgeY);
    ctx.lineTo(entry.bendX, entry.bendY);
    ctx.lineTo(lineEndX, entry.labelY);
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "#24424f";
    ctx.font = `600 ${outsideFontSize}px "Noto Sans SC", sans-serif`;
    ctx.textAlign = entry.side === "right" ? "right" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.text, labelX, entry.labelY);
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.fillStyle = "#4a646f";
  ctx.font = "12px \"Noto Sans SC\", sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(centerLabel, centerX, centerY - 10);
  ctx.fillStyle = "#102129";
  ctx.font = "bold 15px \"Noto Sans SC\", sans-serif";
  ctx.fillText(centerValue, centerX, centerY + 12);
}

function renderPieLegend(items, totalAsset, displayMode = "full") {
  el.pieLegend.innerHTML = "";
  if (!items.length || !Number.isFinite(totalAsset) || totalAsset <= 0) return;

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "pie-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "pie-swatch";
    swatch.style.background = PIE_COLORS[index % PIE_COLORS.length];

    const name = document.createElement("span");
    name.className = "pie-legend-name";
    name.textContent = item.label;

    const value = document.createElement("span");
    value.className = "pie-legend-value";
    value.textContent =
      displayMode === "percent"
        ? formatShare(item.value, totalAsset)
        : `${formatMoney(item.value)}  ${formatShare(item.value, totalAsset)}`;

    row.append(swatch, name, value);
    fragment.appendChild(row);
  });

  el.pieLegend.appendChild(fragment);
}

function readActiveGroupTargets() {
  const account = getActiveAccount();
  return normalizeGroupTargets(account?.settings?.groupTargets);
}

function getTotalGroupTargetShare(groupTargets = readActiveGroupTargets()) {
  return Object.values(groupTargets).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function buildGroupTargetRows(snapshot, groupTargets = readActiveGroupTargets()) {
  const keys = new Set([...snapshot.groupStats.keys(), ...Object.keys(groupTargets)]);
  const rows = [];

  keys.forEach((key) => {
    const { classKey, groupName } = parseGroupCompositeKey(key);
    const stat = snapshot.groupStats.get(key) || createEmptyStat();
    const currentAmount = Number.isFinite(stat.amount) ? stat.amount : 0;
    const currentShare = snapshot.totalAsset > 0 ? currentAmount / snapshot.totalAsset : 0;
    const targetShare = Number.isFinite(groupTargets[key]) ? groupTargets[key] : null;
    const targetAmount = targetShare !== null && snapshot.totalAsset > 0 ? snapshot.totalAsset * targetShare : null;
    const shareDiff = targetShare !== null ? currentShare - targetShare : null;
    const amountDiff = Number.isFinite(targetAmount) ? currentAmount - targetAmount : null;

    rows.push({
      key,
      classKey,
      classLabel: ASSET_CLASS_LABELS[classKey] || classKey,
      groupName,
      currentAmount,
      currentShare,
      targetShare,
      targetAmount,
      shareDiff,
      amountDiff,
      hasTarget: targetShare !== null,
    });
  });

  rows.sort((a, b) => {
    const targetRank = Number(b.hasTarget) - Number(a.hasTarget);
    if (targetRank !== 0) return targetRank;

    if (a.hasTarget && b.hasTarget) {
      const diffA = Number.isFinite(a.amountDiff) ? Math.abs(a.amountDiff) : Math.abs(a.shareDiff || 0);
      const diffB = Number.isFinite(b.amountDiff) ? Math.abs(b.amountDiff) : Math.abs(b.shareDiff || 0);
      if (diffB !== diffA) return diffB - diffA;
    }

    if (b.currentAmount !== a.currentAmount) {
      return b.currentAmount - a.currentAmount;
    }

    const classOrderDiff = ASSET_CLASS_ORDER.indexOf(a.classKey) - ASSET_CLASS_ORDER.indexOf(b.classKey);
    if (classOrderDiff !== 0) return classOrderDiff;
    return a.groupName.localeCompare(b.groupName, "zh-CN");
  });

  return rows;
}

function getGroupTargetStatus(row) {
  if (!row?.hasTarget) {
    return { text: "未设目标", className: "" };
  }

  if (!Number.isFinite(row.shareDiff)) {
    return { text: "待计算", className: "" };
  }

  if (Math.abs(row.shareDiff) < 0.001) {
    return { text: "接近目标", className: "is-neutral" };
  }

  return row.shareDiff > 0
    ? { text: "超配", className: "is-up" }
    : { text: "低配", className: "is-down" };
}

function createGroupTargetHeader() {
  const header = document.createElement("div");
  header.className = "group-target-header";
  ["分组", "当前", "目标", "偏离"].forEach((label) => {
    const cell = document.createElement("span");
    cell.className = "group-target-header-cell";
    cell.textContent = label;
    header.appendChild(cell);
  });
  return header;
}

function createGroupTargetValueCell(valueText, amountText, valueClassName = "") {
  const cell = document.createElement("div");
  cell.className = "group-target-cell";

  const valueEl = document.createElement("strong");
  valueEl.className = "group-target-cell-value";
  if (valueClassName) valueEl.classList.add(valueClassName);
  valueEl.textContent = valueText;

  const amountEl = document.createElement("span");
  amountEl.className = "group-target-cell-amount";
  amountEl.textContent = amountText;

  cell.append(valueEl, amountEl);
  return cell;
}

function clearGroupTargetSection(message) {
  if (el.groupTargetSummary) {
    el.groupTargetSummary.textContent = "未设置目标";
    el.groupTargetSummary.classList.remove("is-bad");
  }

  if (!el.groupTargetList) return;
  el.groupTargetList.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "group-target-empty";
  empty.textContent = message;
  el.groupTargetList.appendChild(empty);
}

function renderGroupTargetSection(snapshot) {
  if (!el.groupTargetList || !el.groupTargetSummary) return;

  const groupTargets = readActiveGroupTargets();
  const rows = buildGroupTargetRows(snapshot, groupTargets);
  const totalTargetShare = getTotalGroupTargetShare(groupTargets);

  el.groupTargetSummary.textContent =
    Object.keys(groupTargets).length > 0 ? `已设目标合计 ${formatShareRatio(totalTargetShare)}` : "未设置目标";
  el.groupTargetSummary.classList.toggle("is-bad", totalTargetShare > 1.0001);

  el.groupTargetList.innerHTML = "";
  if (rows.length === 0) {
    clearGroupTargetSection("暂无分组，新增持仓后可设置目标仓位");
    return;
  }

  const fragment = document.createDocumentFragment();
  fragment.appendChild(createGroupTargetHeader());
  rows.forEach((row) => {
    const status = getGroupTargetStatus(row);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "group-target-item";
    item.setAttribute("aria-label", `设置 ${row.classLabel} / ${row.groupName} 目标仓位`);
    item.addEventListener("click", () => openGroupTargetModal(row.key));

    const title = document.createElement("div");
    title.className = "group-target-title-cell";

    const nameEl = document.createElement("span");
    nameEl.className = "group-target-name";
    nameEl.textContent = row.groupName;

    const classEl = document.createElement("span");
    classEl.className = "group-target-class";
    classEl.textContent = row.classLabel;

    const statusEl = document.createElement("span");
    statusEl.className = "group-target-status";
    if (status.className) statusEl.classList.add(status.className);
    statusEl.textContent = row.hasTarget ? status.text : "未设目标";

    title.append(nameEl, classEl, statusEl);

    item.append(
      title,
      createGroupTargetValueCell(formatShareRatio(row.currentShare), formatCompactMoney(row.currentAmount)),
      createGroupTargetValueCell(
        row.hasTarget ? formatShareRatio(row.targetShare) : "未设置",
        Number.isFinite(row.targetAmount) ? formatCompactMoney(row.targetAmount) : row.hasTarget ? "--" : "点击设置",
      ),
      createGroupTargetValueCell(
        row.hasTarget ? formatTargetShareDiff(row.shareDiff) : "--",
        row.hasTarget && Number.isFinite(row.amountDiff) ? formatSignedCompactMoney(row.amountDiff) : "--",
        row.hasTarget && Number.isFinite(row.shareDiff) ? status.className : "",
      ),
    );
    fragment.appendChild(item);
  });

  el.groupTargetList.appendChild(fragment);
}

function targetPieLevelSubtitle(level, totalTargetShare) {
  const summary = `已设目标合计 ${formatShareRatio(totalTargetShare)}`;
  if (level === "class") {
    return `${summary}，按大类展示目标仓位`;
  }
  return `${summary}，按分组展示目标仓位`;
}

function buildTargetPieSeries(level, snapshot, groupTargets = readActiveGroupTargets()) {
  const normalizedLevel = normalizeTargetPieLevel(level);
  const totalTargetShare = getTotalGroupTargetShare(groupTargets);
  if (totalTargetShare <= 0) {
    return { items: [], totalBase: 0, totalTargetShare };
  }

  const bucket = new Map();
  Object.entries(groupTargets).forEach(([key, targetShare]) => {
    if (!(targetShare > 0)) return;
    const { classKey, groupName } = parseGroupCompositeKey(key);
    const label =
      normalizedLevel === "class"
        ? ASSET_CLASS_LABELS[classKey] || classKey
        : `${groupName} · ${ASSET_CLASS_LABELS[classKey] || classKey}`;
    const current = bucket.get(label) || 0;
    bucket.set(label, current + targetShare);
  });

  const items = [...bucket.entries()]
    .map(([label, value]) => ({
      label,
      value,
      targetShare: value,
      targetAmount: snapshot.totalAsset > 0 ? snapshot.totalAsset * value : null,
      isRemainder: false,
    }))
    .sort((a, b) => b.value - a.value);

  if (totalTargetShare < 1) {
    const remainder = 1 - totalTargetShare;
    items.push({
      label: "未设目标",
      value: remainder,
      targetShare: remainder,
      targetAmount: snapshot.totalAsset > 0 ? snapshot.totalAsset * remainder : null,
      isRemainder: true,
    });
  }

  return {
    items,
    totalBase: totalTargetShare < 1 ? 1 : totalTargetShare,
    totalTargetShare,
  };
}

function renderTargetPieLegend(items, snapshot, displayMode = "full") {
  if (!el.targetPieLegend) return;
  el.targetPieLegend.innerHTML = "";
  if (!items.length) return;

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "pie-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "pie-swatch";
    swatch.style.background = PIE_COLORS[index % PIE_COLORS.length];

    const name = document.createElement("span");
    name.className = "pie-legend-name";
    name.textContent = item.label;

    const value = document.createElement("span");
    value.className = "pie-legend-value";
    value.textContent =
      displayMode === "percent" || !Number.isFinite(item.targetAmount)
        ? formatShareRatio(item.targetShare)
        : `${formatShareRatio(item.targetShare)}  ${formatMoney(item.targetAmount)}`;

    row.append(swatch, name, value);
    fragment.appendChild(row);
  });

  el.targetPieLegend.appendChild(fragment);
}

function renderTargetPieSection(snapshot) {
  if (!el.targetPieCanvas || !el.targetPieSubtitle || !el.targetPieLegend) return;

  const level = normalizeTargetPieLevel(state.targetPieLevel);
  const displayMode = normalizePieDisplayMode(state.pieDisplayMode);
  const { items, totalBase, totalTargetShare } = buildTargetPieSeries(level, snapshot);
  syncTargetPieLevelButtons();
  el.targetPieSubtitle.textContent =
    items.length > 0 ? targetPieLevelSubtitle(level, totalTargetShare) : "设置分组目标仓位后即可查看整体分布";

  drawPieChart(items, totalBase, displayMode, {
    canvas: el.targetPieCanvas,
    emptyText: "暂无目标仓位数据",
    centerLabel: "已设目标",
    centerValue: formatShareRatio(totalTargetShare),
  });
  renderTargetPieLegend(items, snapshot, displayMode);
}

function clearTargetPieSection(message = "设置分组目标仓位后即可查看整体分布") {
  if (el.targetPieSubtitle) {
    el.targetPieSubtitle.textContent = message;
  }
  if (el.targetPieLegend) {
    el.targetPieLegend.innerHTML = "";
  }
  drawPieChart([], 0, normalizePieDisplayMode(state.pieDisplayMode), {
    canvas: el.targetPieCanvas,
    emptyText: "暂无目标仓位数据",
    centerLabel: "已设目标",
    centerValue: "0%",
  });
}

function renderPieSection(activeHoldings, snapshot) {
  const level = normalizePieLevel(el.pieLevel.value);
  const displayMode = normalizePieDisplayMode(state.pieDisplayMode);
  syncPieLevelButtons();
  syncPieDisplayButtons();
  const series = buildPieSeries(level, activeHoldings, snapshot);
  el.pieSubtitle.textContent = pieLevelSubtitle(level);
  drawPieChart(series, snapshot.totalAsset, displayMode);
  renderPieLegend(series, snapshot.totalAsset, displayMode);
  renderGroupTargetSection(snapshot);
  renderTargetPieSection(snapshot);
}

function normalizePerformancePreset(value) {
  const preset = String(value || "").trim().toLowerCase();
  return PERFORMANCE_PRESET_ORDER.includes(preset) ? preset : "3m";
}

function normalizePerformanceScopeType(value) {
  const scopeType = String(value || "").trim().toLowerCase();
  return PERFORMANCE_SCOPE_TYPES.includes(scopeType) ? scopeType : "portfolio";
}

function normalizePerformanceMetricMode(value) {
  const metric = String(value || "").trim().toLowerCase();
  return PERFORMANCE_METRIC_MODES.includes(metric) ? metric : "nav";
}

function parseDateKeyToLocalDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map((item) => Number.parseInt(item, 10));
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateKeyLocal(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateKeyByMonths(dateKey, deltaMonths) {
  const base = parseDateKeyToLocalDate(dateKey);
  if (!base) return dateKey;
  const next = new Date(base.getFullYear(), base.getMonth() + deltaMonths, base.getDate());
  return formatDateKeyLocal(next);
}

function buildPerformanceAvailableDates(events = []) {
  return [...new Set((Array.isArray(events) ? events : []).map((item) => String(item?.date || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function clampDateKey(value, min, max) {
  if (!value) return min || max || "";
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

function resolvePerformanceRange(availableDates) {
  const availableStart = availableDates[0] || getLocalDateKey();
  const availableEnd = availableDates[availableDates.length - 1] || getLocalDateKey();
  const preset = normalizePerformancePreset(state.performancePreset);

  if (preset === "custom") {
    const start = clampDateKey(state.performanceStartDate || availableStart, availableStart, availableEnd);
    const end = clampDateKey(state.performanceEndDate || availableEnd, start, availableEnd);
    state.performanceStartDate = start;
    state.performanceEndDate = end;
    return { start, end, availableStart, availableEnd };
  }

  let start = availableStart;
  if (preset === "6m") {
    start = shiftDateKeyByMonths(availableEnd, -6);
  } else if (preset === "ytd") {
    const endDate = parseDateKeyToLocalDate(availableEnd);
    start = endDate ? `${endDate.getFullYear()}-01-01` : availableStart;
  } else if (preset === "1y") {
    start = shiftDateKeyByMonths(availableEnd, -12);
  } else if (preset === "all") {
    start = availableStart;
  } else {
    start = shiftDateKeyByMonths(availableEnd, -3);
  }

  start = clampDateKey(start, availableStart, availableEnd);
  const end = clampDateKey(availableEnd, start, availableEnd);
  state.performanceStartDate = start;
  state.performanceEndDate = end;
  return { start, end, availableStart, availableEnd };
}

function syncPerformancePresetButtons() {
  const activePreset = normalizePerformancePreset(state.performancePreset);
  el.performancePresetButtons.forEach((button) => {
    const isActive = button.dataset.performancePreset === activePreset;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function syncPerformanceMetricButtons() {
  const activeMetric = normalizePerformanceMetricMode(state.performanceMetricMode);
  el.performanceMetricButtons.forEach((button) => {
    const isActive = button.dataset.performanceMetric === activeMetric;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setPerformanceStatus(text, level = "normal") {
  if (!el.performanceStatus) return;
  el.performanceStatus.textContent = text;
  el.performanceStatus.classList.remove("is-good", "is-bad");
  if (level === "good") el.performanceStatus.classList.add("is-good");
  if (level === "bad") el.performanceStatus.classList.add("is-bad");
}

function setPerformanceValue(elm, value, { format = "text", currency = getDisplayCurrencyCode(), signed = false } = {}) {
  if (!elm) return;
  elm.classList.remove("is-up", "is-down");
  if (!Number.isFinite(value)) {
    elm.textContent = "--";
    return;
  }

  if (format === "money") {
    elm.textContent = signed ? formatSignedMoney(value, currency) : formatMoney(value, currency);
  } else if (format === "percent") {
    elm.textContent = formatReturnRatio(value, 2);
  } else {
    elm.textContent = String(value);
  }

  if (value > 0 && (format === "money" || format === "percent")) elm.classList.add("is-up");
  if (value < 0 && (format === "money" || format === "percent")) elm.classList.add("is-down");
}

function drawEmptyPerformanceChart(message = "暂无收益率数据") {
  if (!el.performanceChart) return;
  state.performanceChartModel = null;
  clearPerformancePointDetail();
  const ctx = el.performanceChart.getContext("2d");
  const rect = el.performanceChart.getBoundingClientRect();
  const cssWidth = rect.width > 40 ? rect.width : 720;
  const cssHeight = rect.height > 40 ? rect.height : 320;
  const dpr = window.devicePixelRatio || 1;

  el.performanceChart.width = Math.floor(cssWidth * dpr);
  el.performanceChart.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#4a646f";
  ctx.font = '14px "Noto Sans SC", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(message, cssWidth / 2, cssHeight / 2);
}

function formatChartAxisValue(value, metricMode) {
  if (!Number.isFinite(value)) return "--";
  if (metricMode === "return") return formatReturnRatio(value, 1);
  return value.toFixed(3);
}

function clearPerformancePointDetail() {
  if (!el.performancePointDetail) return;
  el.performancePointDetail.hidden = true;
  el.performancePointDetail.innerHTML = "";
}

function appendPerformancePointItem(fragment, label, value) {
  const item = document.createElement("div");
  item.className = "performance-point-item";

  const labelEl = document.createElement("p");
  labelEl.className = "performance-point-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("p");
  valueEl.className = "performance-point-value";
  valueEl.textContent = value;

  item.append(labelEl, valueEl);
  fragment.appendChild(item);
}

function renderPerformancePointDetail(point, metricMode = normalizePerformanceMetricMode(state.performanceMetricMode)) {
  if (!el.performancePointDetail || !point) {
    clearPerformancePointDetail();
    return;
  }

  const primaryLabel = metricMode === "return" ? "累计收益率" : "净值";
  const primaryValue = metricMode === "return" ? formatReturnRatio(point.cumulativeReturn, 2) : formatNumber(point.nav, 4);
  const secondaryLabel = metricMode === "return" ? "净值" : "累计收益率";
  const secondaryValue = metricMode === "return" ? formatNumber(point.nav, 4) : formatReturnRatio(point.cumulativeReturn, 2);

  const fragment = document.createDocumentFragment();
  appendPerformancePointItem(fragment, "日期", point.date || "--");
  appendPerformancePointItem(fragment, primaryLabel, primaryValue);
  appendPerformancePointItem(fragment, secondaryLabel, secondaryValue);
  appendPerformancePointItem(fragment, "当日收益", Number.isFinite(point.dailyReturn) ? formatReturnRatio(point.dailyReturn, 2) : "--");
  appendPerformancePointItem(fragment, "当日市值", formatMoney(point.marketValue));

  el.performancePointDetail.innerHTML = "";
  el.performancePointDetail.appendChild(fragment);
  el.performancePointDetail.hidden = false;
}

function drawPerformanceChart(report, metricMode = normalizePerformanceMetricMode(state.performanceMetricMode)) {
  if (!el.performanceChart) return;

  const points = Array.isArray(report?.points) ? report.points : [];
  const values = points
    .map((point) => (metricMode === "return" ? point.cumulativeReturn : point.nav))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    drawEmptyPerformanceChart("所选区间暂无可绘制的收益率数据");
    return;
  }

  const ctx = el.performanceChart.getContext("2d");
  const rect = el.performanceChart.getBoundingClientRect();
  const cssWidth = rect.width > 40 ? rect.width : 720;
  const cssHeight = rect.height > 40 ? rect.height : 320;
  const dpr = window.devicePixelRatio || 1;

  el.performanceChart.width = Math.floor(cssWidth * dpr);
  el.performanceChart.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 18, right: 18, bottom: 34, left: 56 };
  const innerWidth = cssWidth - padding.left - padding.right;
  const innerHeight = cssHeight - padding.top - padding.bottom;
  const minX = new Date(`${points[0].date}T00:00:00`).getTime();
  const maxX = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  if (Math.abs(maxY - minY) < 1e-8) {
    const pad = metricMode === "return" ? 0.01 : 0.02;
    minY -= pad;
    maxY += pad;
  } else {
    const pad = (maxY - minY) * 0.15;
    minY -= pad;
    maxY += pad;
  }

  function toCanvasX(dateKey) {
    if (maxX === minX) return padding.left + innerWidth / 2;
    const current = new Date(`${dateKey}T00:00:00`).getTime();
    return padding.left + ((current - minX) / (maxX - minX)) * innerWidth;
  }

  function toCanvasY(value) {
    return padding.top + innerHeight - ((value - minY) / (maxY - minY)) * innerHeight;
  }

  ctx.strokeStyle = "#d9e4ea";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = padding.top + innerHeight * ratio;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + innerWidth, y);
    ctx.stroke();

    const value = maxY - (maxY - minY) * ratio;
    ctx.fillStyle = "#6b8592";
    ctx.font = '11px "Noto Sans SC", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(formatChartAxisValue(value, metricMode), 8, y + 4);
  }

  const linePoints = points
    .map((point, index) => ({
      index,
      point,
      x: toCanvasX(point.date),
      y: toCanvasY(metricMode === "return" ? point.cumulativeReturn : point.nav),
      value: metricMode === "return" ? point.cumulativeReturn : point.nav,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (linePoints.length === 0) {
    drawEmptyPerformanceChart("所选区间暂无可绘制的收益率数据");
    return;
  }

  const selectedLinePoint =
    linePoints.find((point) => point.point.date === state.performanceSelectedPointDate) || linePoints[linePoints.length - 1];
  state.performanceSelectedPointDate = selectedLinePoint.point.date;
  state.performanceChartModel = {
    report,
    metricMode,
    linePoints,
  };

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + innerHeight);
  gradient.addColorStop(0, "rgba(43, 143, 184, 0.26)");
  gradient.addColorStop(1, "rgba(43, 143, 184, 0.02)");

  ctx.beginPath();
  ctx.moveTo(linePoints[0].x, padding.top + innerHeight);
  linePoints.forEach((point) => {
    ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(linePoints[linePoints.length - 1].x, padding.top + innerHeight);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(linePoints[0].x, linePoints[0].y);
  for (let index = 1; index < linePoints.length; index += 1) {
    ctx.lineTo(linePoints[index].x, linePoints[index].y);
  }
  ctx.strokeStyle = "#2b8fb8";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const lastPoint = linePoints[linePoints.length - 1];
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#2b8fb8";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = "rgba(128, 87, 57, 0.38)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(selectedLinePoint.x, padding.top);
  ctx.lineTo(selectedLinePoint.x, padding.top + innerHeight);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(selectedLinePoint.x, selectedLinePoint.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#805739";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const labelDates = [points[0].date, points[Math.floor(points.length / 2)].date, points[points.length - 1].date];
  ctx.fillStyle = "#6b8592";
  ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.textAlign = "center";
  labelDates.forEach((dateKey, index) => {
    const x = index === 0 ? padding.left : index === 2 ? padding.left + innerWidth : padding.left + innerWidth / 2;
    ctx.fillText(dateKey, x, cssHeight - 10);
  });

  renderPerformancePointDetail(selectedLinePoint.point, metricMode);
}

function handlePerformanceChartClick(event) {
  const model = state.performanceChartModel;
  if (!model?.linePoints?.length || !el.performanceChart) return;

  const rect = el.performanceChart.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const nearest = model.linePoints.reduce((best, point) => {
    if (!best) return point;
    return Math.abs(point.x - clickX) < Math.abs(best.x - clickX) ? point : best;
  }, null);
  if (!nearest?.point?.date) return;

  state.performanceSelectedPointDate = nearest.point.date;
  drawPerformanceChart(model.report, model.metricMode);
}

function clearPerformancePanel(message = "解锁后可查看收益率曲线。", level = "normal") {
  setPerformanceStatus(message, level);
  setPerformanceValue(el.performanceTotalReturn, Number.NaN);
  setPerformanceValue(el.performanceXirr, Number.NaN);
  setPerformanceValue(el.performanceEndValue, Number.NaN);
  setPerformanceValue(el.performanceNetFlow, Number.NaN);
  if (el.performanceRangeMeta) el.performanceRangeMeta.textContent = "--";
  if (el.performanceFormulaMeta) {
    el.performanceFormulaMeta.textContent = "曲线按时间加权收益率计算，年化收益率按 XIRR 计算。";
  }
  if (el.performanceNotes) {
    el.performanceNotes.innerHTML = "";
  }
  drawEmptyPerformanceChart(message);
}

function buildPerformanceScopeSelection(catalog) {
  const scopeType = normalizePerformanceScopeType(state.performanceScopeType);
  if (scopeType === "portfolio") {
    return {
      scope: { type: "portfolio" },
      label: "整个组合",
    };
  }

  const items =
    scopeType === "class" ? catalog.classes : scopeType === "group" ? catalog.groups : catalog.holdings;
  const firstItem = items[0] || null;
  if (!firstItem) {
    return {
      scope: { type: "portfolio" },
      label: "整个组合",
    };
  }

  if (scopeType === "class") {
    const selected = items.find((item) => item.classKey === state.performanceScopeTarget) || firstItem;
    state.performanceScopeTarget = selected.classKey;
    return {
      scope: { type: "class", classKey: selected.classKey },
      label: selected.label,
    };
  }

  if (scopeType === "group") {
    const selected = items.find((item) => item.groupKey === state.performanceScopeTarget) || firstItem;
    state.performanceScopeTarget = selected.groupKey;
    return {
      scope: { type: "group", groupKey: selected.groupKey },
      label: selected.label,
    };
  }

  const selected = items.find((item) => item.holdingId === state.performanceScopeTarget) || firstItem;
  state.performanceScopeTarget = selected.holdingId;
  return {
    scope: { type: "holding", holdingId: selected.holdingId },
    label: selected.label,
  };
}

function syncPerformanceScopeTargetOptions(catalog) {
  if (!el.performanceScopeTarget || !el.performanceScopeType) return;

  const scopeType = normalizePerformanceScopeType(state.performanceScopeType);
  el.performanceScopeType.value = scopeType;
  el.performanceScopeTarget.innerHTML = "";

  if (scopeType === "portfolio") {
    const option = document.createElement("option");
    option.value = "__portfolio__";
    option.textContent = "当前账户";
    el.performanceScopeTarget.appendChild(option);
    el.performanceScopeTarget.disabled = true;
    el.performanceScopeTarget.value = "__portfolio__";
    return;
  }

  const items = scopeType === "class" ? catalog.classes : scopeType === "group" ? catalog.groups : catalog.holdings;
  if (items.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无可选项";
    el.performanceScopeTarget.appendChild(option);
    el.performanceScopeTarget.disabled = true;
    el.performanceScopeTarget.value = "";
    return;
  }

  el.performanceScopeTarget.disabled = false;
  items.forEach((item) => {
    const option = document.createElement("option");
    if (scopeType === "class") {
      option.value = item.classKey;
    } else if (scopeType === "group") {
      option.value = item.groupKey;
    } else {
      option.value = item.holdingId;
    }
    option.textContent = item.label;
    el.performanceScopeTarget.appendChild(option);
  });

  const firstValue = scopeType === "class" ? items[0].classKey : scopeType === "group" ? items[0].groupKey : items[0].holdingId;
  const existing = [...el.performanceScopeTarget.options].some((option) => option.value === state.performanceScopeTarget)
    ? state.performanceScopeTarget
    : firstValue;
  state.performanceScopeTarget = existing;
  el.performanceScopeTarget.value = existing;
}

async function renderPerformanceOnly() {
  if (!el.performanceChart) return;

  const renderToken = ++state.performanceRenderToken;
  syncPerformancePresetButtons();
  syncPerformanceMetricButtons();

  if (!state.unlocked || !state.vault) {
    clearPerformancePanel("请先解锁持仓库后查看收益率曲线");
    return;
  }

  const account = getActiveAccount();
  if (!account) {
    clearPerformancePanel("当前没有可用账户");
    return;
  }

  setPerformanceStatus("正在计算收益率曲线...");
  const events = await getAllEvents(account.id);
  if (renderToken !== state.performanceRenderToken) return;

  const catalog = buildPerformanceScopeCatalog({ account, events });
  syncPerformanceScopeTargetOptions(catalog);
  const availableDates = buildPerformanceAvailableDates(events);
  if (availableDates.length === 0) {
    clearPerformancePanel("历史记录还不足以生成收益率曲线");
    return;
  }

  const { start, end, availableStart, availableEnd } = resolvePerformanceRange(availableDates);
  if (el.performanceStartDateInput) el.performanceStartDateInput.value = start;
  if (el.performanceEndDateInput) el.performanceEndDateInput.value = end;

  const { scope, label } = buildPerformanceScopeSelection(catalog);
  const report = computePerformanceReport({
    accountId: account.id,
    events,
    scope,
    rangeStart: start,
    rangeEnd: end,
    displayCurrencyCode: getDisplayCurrencyCode(),
  });
  if (renderToken !== state.performanceRenderToken) return;

  if (!report.ok) {
    clearPerformancePanel(report.reason || "所选区间暂无收益率数据");
    if (el.performanceRangeMeta) {
      el.performanceRangeMeta.textContent = [availableStart, availableEnd].filter(Boolean).join(" 至 ") || "--";
    }
    return;
  }

  setPerformanceStatus("收益率曲线已更新", "good");
  setPerformanceValue(el.performanceTotalReturn, report.summary.totalReturn, { format: "percent" });
  setPerformanceValue(el.performanceXirr, report.summary.xirr, { format: "percent" });
  setPerformanceValue(el.performanceEndValue, report.summary.endValue, { format: "money" });
  setPerformanceValue(el.performanceNetFlow, report.summary.netCashFlow, { format: "money", signed: true });

  if (el.performanceRangeMeta) {
    el.performanceRangeMeta.textContent = `${report.effectiveStartDate || start} 至 ${report.effectiveEndDate || end} · ${label} · ${report.summary.pointCount} 个观测点`;
  }
  if (el.performanceFormulaMeta) {
    const notes = [`时间加权净值曲线`, `累计收益率 ${formatReturnRatio(report.summary.totalReturn, 2)}`];
    if (Number.isFinite(report.summary.xirr)) {
      notes.push(`年化 ${formatReturnRatio(report.summary.xirr, 2)}`);
    }
    el.performanceFormulaMeta.textContent = notes.join(" · ");
  }

  if (el.performanceNotes) {
    el.performanceNotes.innerHTML = "";
    const fragment = document.createDocumentFragment();
    const notes = [
      `统计口径：${label}`,
      `净流入 ${formatSignedMoney(report.summary.netCashFlow)}`,
      `曲线按时间加权收益率计算，年化收益率按 XIRR 计算`,
      ...report.notes,
    ];
    notes.forEach((text) => {
      const row = document.createElement("p");
      row.className = "quote-debug-summary";
      row.textContent = text;
      fragment.appendChild(row);
    });
    el.performanceNotes.appendChild(fragment);
  }

  drawPerformanceChart(report, normalizePerformanceMetricMode(state.performanceMetricMode));
}

function applyMetricToConfigCard(card, holding, metric) {
  const titleEl = card.querySelector(".config-title");
  const orderEl = card.querySelector(".config-order");
  const assetEl = card.querySelector(".config-asset");
  const changeEl = card.querySelector(".config-change");

  titleEl.textContent = metric.name || holding.code || "未填写基金代码";
  titleEl.classList.remove("is-bad");
  if (metric.error) {
    titleEl.classList.add("is-bad");
  }

  const orderValue = normalizeSortOrder(holding.sortOrder) || 0;
  orderEl.textContent = `排序 #${orderValue > 0 ? orderValue : "--"}`;

  const classLabel = ASSET_CLASS_LABELS[normalizeAssetClass(holding.assetClass)] || normalizeAssetClass(holding.assetClass);
  const groupName = getHoldingGroupName(holding);
  const assetAmountText = Number.isFinite(metric.assetAmount) ? formatMoney(metric.assetAmount) : "--";
  const rawManualAmount = Number.isFinite(Number(holding.manualAmount)) && Number(holding.manualAmount) > 0 ? Number(holding.manualAmount) : null;
  const manualAmountCurrency = resolveManualAmountCurrency(holding);
  const manualAmountText =
    Number.isFinite(rawManualAmount)
      ? ` · 原币 ${formatMoney(rawManualAmount, manualAmountCurrency)}`
      : "";
  const manualPriceText =
    Number.isFinite(Number(holding.manualPrice)) && Number(holding.manualPrice) > 0
      ? ` · 手动价 ${(metric.priceCurrency || metric.nativeCurrency || "CNY").toUpperCase()} ${formatNumber(
          Number(holding.manualPrice),
          4,
        )}`
      : "";
  const unitText = manualAmountText ? "" : ` · 份额 ${formatUnits(holding.units)}`;
  assetEl.textContent = `${classLabel} / ${groupName}${unitText} · 资产 ${assetAmountText}${manualAmountText}${manualPriceText}`;

  const changePct = Number.isFinite(metric.changePct)
    ? metric.changePct
    : deriveChangePctFromAmounts(metric.assetAmount, metric.changeAmount);
  changeEl.classList.remove("is-up", "is-down");
  if (metric.sourceType === "MANUAL_AMOUNT") {
    changeEl.textContent = "手工录入资产，金额不自动更新";
    return;
  }
  if (metric.sourceType === "MANUAL") {
    changeEl.textContent = "手动价格兜底，暂无实时涨跌";
    return;
  }

  const prefix = metric.notice || metric.sourceLabel || "";
  changeEl.textContent = prefix
    ? `${prefix} · 涨跌 ${formatSignedMoney(metric.changeAmount)} / ${formatPercent(changePct, 2)}`
    : `涨跌 ${formatSignedMoney(metric.changeAmount)} / ${formatPercent(changePct, 2)}`;
  if (Number.isFinite(metric.changeAmount)) {
    if (metric.changeAmount > 0) changeEl.classList.add("is-up");
    if (metric.changeAmount < 0) changeEl.classList.add("is-down");
  }
}

function updateConfigCardsComputed(snapshot) {
  const cards = [...el.configList.querySelectorAll(".config-item")];
  cards.forEach((card) => {
    const holding = findHoldingById(card.dataset.holdingId);
    if (!holding || holding.deleted) return;
    const metric = snapshot.metrics.get(holding.id) || buildHoldingMetric(holding);
    applyMetricToConfigCard(card, holding, metric);
  });
}

function moveHoldingOrder(holdingId, direction) {
  if (!state.vault) return;
  const account = getActiveAccount();
  if (!account) return;
  const active = sortActiveHoldingsByDefaultOrder(vaultToActiveHoldings(state.vault));
  const previousOrders = active.map((item) => ({ holdingId: item.id, sortOrder: item.sortOrder }));
  const index = active.findIndex((item) => item.id === holdingId);
  if (index < 0) return;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= active.length) return;

  const firstId = active[index].id;
  const secondId = active[nextIndex].id;
  [active[index], active[nextIndex]] = [active[nextIndex], active[index]];

  applyActiveOrder(active);
  const stamp = nowIso();
  const first = findHoldingById(firstId);
  const second = findHoldingById(secondId);
  if (first) first.updatedAt = stamp;
  if (second) second.updatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;

  schedulePersist();
  scheduleSync();
  const nextOrders = sortActiveHoldingsByDefaultOrder(vaultToActiveHoldings(state.vault)).map((item) => ({
    holdingId: item.id,
    sortOrder: item.sortOrder,
  }));
  if (JSON.stringify(previousOrders) !== JSON.stringify(nextOrders)) {
    void emitHistoryChange("REORDER", { orders: nextOrders }, account.id);
  }
  renderAllPanels();
}

function createConfigCard(holding, snapshot) {
  const fragment = el.configTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".config-item");
  const editBtn = card.querySelector(".edit-btn");
  const moveUpBtn = card.querySelector(".move-up-btn");
  const moveDownBtn = card.querySelector(".move-down-btn");
  const removeBtn = card.querySelector(".remove-btn");

  card.dataset.holdingId = holding.id;
  const metric = snapshot.metrics.get(holding.id) || buildHoldingMetric(holding);
  applyMetricToConfigCard(card, holding, metric);

  editBtn.addEventListener("click", () => {
    const target = findHoldingById(card.dataset.holdingId);
    if (!target || target.deleted) return;
    openHoldingModal("edit", target);
  });

  moveUpBtn.addEventListener("click", () => {
    moveHoldingOrder(holding.id, -1);
  });

  moveDownBtn.addEventListener("click", () => {
    moveHoldingOrder(holding.id, 1);
  });

  removeBtn.addEventListener("click", () => {
    const target = findHoldingById(card.dataset.holdingId);
    if (!target || target.deleted) return;
    openDeleteConfirmModal({
      type: "holding",
      id: target.id,
      title: "确认归档持仓",
      description: `确认将持仓「${target.name || target.code || "未命名持仓"}」移入归档？`,
      note: "归档后不会真正删除，可在归档弹窗中恢复。",
      actionLabel: "移入归档",
    });
  });

  return card;
}

function renderConfigTab(activeHoldings, snapshot) {
  el.configList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const ordered = sortActiveHoldingsByDefaultOrder(activeHoldings);
  ordered.forEach((holding, index) => {
    const card = createConfigCard(holding, snapshot);
    const upBtn = card.querySelector(".move-up-btn");
    const downBtn = card.querySelector(".move-down-btn");
    if (upBtn) upBtn.disabled = index === 0;
    if (downBtn) downBtn.disabled = index === ordered.length - 1;
    fragment.appendChild(card);
  });
  el.configList.appendChild(fragment);
}

function renderDashboardOnly() {
  renderAccountSelector();
  if (!state.vault) {
    if (el.overviewDayChange) {
      el.overviewDayChange.textContent = "--";
      el.overviewDayChange.classList.remove("is-up", "is-down");
    }
    if (el.overviewDayChangePct) {
      el.overviewDayChangePct.textContent = "--";
      el.overviewDayChangePct.classList.remove("is-up", "is-down");
    }
    clearViewTable("请先解锁持仓库");
    syncTreeDepthButtons([]);
    renderQuoteDebugPanel();
    if (state.activeTab === "performance") {
      clearPerformancePanel("请先解锁持仓库后查看收益率曲线");
    }
    return;
  }

  const { active, snapshot } = getActiveSnapshot();
  updateSummaryCards(snapshot);
  syncTreeDepthButtons(active);
  renderViewTable(active, snapshot);
  updateConfigCardsComputed(snapshot);
  renderQuoteDebugPanel();
}

function renderPieOnly() {
  if (!state.vault) {
    el.pieLegend.innerHTML = "";
    el.pieSubtitle.textContent = pieLevelSubtitle(normalizePieLevel(el.pieLevel.value || "group"));
    syncPieLevelButtons();
    syncPieDisplayButtons();
    drawPieChart([], 0, normalizePieDisplayMode(state.pieDisplayMode));
    clearGroupTargetSection("请先解锁持仓库后查看目标仓位");
    clearTargetPieSection("请先解锁持仓库后查看目标分布");
    return;
  }

  const { active, snapshot } = getActiveSnapshot();
  renderPieSection(active, snapshot);
}

function renderAllPanels() {
  if (!state.vault) {
    renderDashboardOnly();
    el.configList.innerHTML = "";
    clearGroupTargetSection("请先解锁持仓库后查看目标仓位");
    clearTargetPieSection("请先解锁持仓库后查看目标分布");
    renderQuoteDebugPanel();
    clearPerformancePanel("请先解锁持仓库后查看收益率曲线");
    return;
  }

  ensureAtLeastOneAccount(state.vault);
  renderAccountSelector();
  ensureAtLeastOneActiveHolding();
  const { active, snapshot } = getActiveSnapshot();
  updateSummaryCards(snapshot);
  syncTreeDepthButtons(active);
  renderViewTable(active, snapshot);
  if (state.activeTab === "pie") {
    renderPieSection(active, snapshot);
  } else if (state.activeTab === "performance") {
    void renderPerformanceOnly();
  }
  renderConfigTab(active, snapshot);
  renderQuoteDebugPanel();
}

function updateRefreshIntervalInVault(value) {
  if (!state.vault) return;
  const account = getActiveAccount();
  if (!account) return;
  const before = cloneForHistory(account.settings || {});
  account.settings.refreshInterval = normalizeInterval(value);
  const stamp = nowIso();
  account.settingsUpdatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
  const diff = diffTrackedFields(before, account.settings, SETTINGS_HISTORY_FIELDS);
  if (diff.changed) {
    void emitHistoryChange("SETTINGS_CHANGE", { before: diff.before, after: diff.after }, account.id);
  }
}

function updateQuotePreferenceInVault(value) {
  if (!state.vault) return;
  const account = getActiveAccount();
  if (!account) return;
  const before = cloneForHistory(account.settings || {});
  account.settings.quotePreference = normalizeQuotePreference(value);
  const stamp = nowIso();
  account.settingsUpdatedAt = stamp;
  account.updatedAt = stamp;
  state.vault.updatedAt = stamp;
  const diff = diffTrackedFields(before, account.settings, SETTINGS_HISTORY_FIELDS);
  if (diff.changed) {
    void emitHistoryChange("SETTINGS_CHANGE", { before: diff.before, after: diff.after }, account.id);
  }
}

function updateDisplayCurrencySettingInVault(value) {
  updateDisplayCurrencyInVault(value);
}

async function changeDisplayCurrency(value) {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再切换计价币种", "bad");
    openUnlockModal();
    return;
  }

  const nextCurrency = normalizeDisplayCurrency(value);
  const currentCurrency = getCurrentDisplayCurrency();
  if (nextCurrency === currentCurrency) {
    syncDisplayCurrencyButtons();
    return;
  }

  updateDisplayCurrencySettingInVault(nextCurrency);
  syncDisplayCurrencyButtons();

  let fxError = null;
  try {
    await ensureFxSnapshot({ force: true });
  } catch (error) {
    fxError = error;
  }

  renderAllPanels();
  schedulePersist();
  scheduleSync();

  const label = getDisplayCurrencyLabel(nextCurrency);
  const fxSummaryText = buildFxSummaryText();
  if (fxError) {
    setPriceStatus(`已切换为${label}计价，汇率更新失败${state.fxSnapshot ? "，沿用上次汇率" : ""}`, "bad");
    return;
  }

  setPriceStatus(fxSummaryText ? `已切换为${label}计价，汇率 ${fxSummaryText}` : `已切换为${label}计价`, "good");
}

function applyAutoRefresh() {
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }

  if (!state.unlocked) return;
  const seconds = normalizeInterval(el.interval.value);
  if (seconds <= 0) return;

  state.autoTimer = setInterval(() => {
    refreshData();
  }, seconds * 1000);
}

function setIntervalSelectFromVault() {
  const account = getActiveAccount();
  const value = normalizeInterval(account?.settings?.refreshInterval);
  el.interval.value = String(value);
  el.quotePreference.value = normalizeQuotePreference(account?.settings?.quotePreference);
  syncDisplayCurrencyButtons();
}

function schedulePersist() {
  if (!state.unlocked) return;
  if (state.persistTimer) clearTimeout(state.persistTimer);

  state.persistTimer = setTimeout(() => {
    persistLocalNow().catch((error) => {
      setVaultStatus(`本地保存失败：${formatError(error)}`, "bad");
    });
  }, SAVE_DEBOUNCE_MS);
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!state.unlocked) return;
  const token = String(el.gistTokenInput?.value || readGistToken() || "").trim();
  if (!token) return;
  if (state.syncTimer) clearTimeout(state.syncTimer);

  state.syncTimer = setTimeout(() => {
    syncCloud().catch((error) => {
      setVaultStatus(`Gist 自动备份失败：${formatError(error)}`, "bad");
    });
  }, delay);
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function persistLocalNow() {
  if (!state.unlocked || !state.passphrase) return;
  const encrypted = await encryptVault(state.vault, state.passphrase);
  await writeLocalBundle(encrypted);
}

function normalizeFxSnapshot(payload) {
  const rates = Object.fromEntries(
    Object.entries(payload?.rates || {})
      .map(([currency, rate]) => [String(currency || "").trim().toUpperCase(), Number(rate)])
      .filter(([currency, rate]) => SUPPORTED_CURRENCY_CODES.includes(currency) && Number.isFinite(rate) && rate > 0),
  );

  if (!Number.isFinite(rates.CNY) || rates.CNY <= 0) {
    throw new Error("汇率接口缺少 USD/CNY 数据");
  }

  rates.USD = 1;

  return {
    base: String(payload?.base || "USD").trim().toUpperCase() || "USD",
    provider: String(payload?.provider || "ECB").trim() || "ECB",
    date: String(payload?.date || "").trim() || null,
    fetchedAt: String(payload?.fetchedAt || "").trim() || nowIso(),
    stale: Boolean(payload?.stale),
    rates,
  };
}

async function fetchFxSnapshot() {
  return normalizeFxSnapshot(await fetchDirectFxSnapshot());
}

async function ensureFxSnapshot({ force = false } = {}) {
  if (!force && state.fxSnapshot?.rates?.CNY) {
    return state.fxSnapshot;
  }

  const snapshot = await fetchFxSnapshot();
  state.fxSnapshot = snapshot;
  return snapshot;
}

async function fetchSnapshots(codes) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_API_TIMEOUT_MS);

  try {
    const items = await fetchFundSnapshots(codes, {
      preferredSources: buildPreferredSources(codes),
      knownNames: buildKnownFundNames(codes),
      signal: controller.signal,
    });
    updateQuoteSourceHints(items);
    updateFundNameCache(items);
    return items;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("行情请求超时，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchSnapshotsBatched(codes, options = {}) {
  const { onProgress = null, onBatch = null } = options;
  const items = [];
  const totalBatches = Math.max(1, Math.ceil(codes.length / QUOTE_BATCH_SIZE));

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const start = batchIndex * QUOTE_BATCH_SIZE;
    const batchCodes = codes.slice(start, start + QUOTE_BATCH_SIZE);
    if (typeof onProgress === "function") {
      onProgress({
        batchIndex: batchIndex + 1,
        totalBatches,
        batchCodes,
      });
    }
    const batchItems = await fetchSnapshots(batchCodes);
    items.push(...batchItems);
    if (typeof onBatch === "function") {
      onBatch({
        batchIndex: batchIndex + 1,
        totalBatches,
        batchCodes,
        batchItems,
      });
    }
  }

  return items;
}

async function refreshData() {
  if (!state.unlocked) {
    setPriceStatus("请先输入口令并解锁", "bad");
    openUnlockModal();
    return;
  }

  const activeHoldings = vaultToActiveHoldings(state.vault);
  if (activeHoldings.length === 0) {
    setPriceStatus("暂无持仓，请到配置管理中新增", "bad");
    return;
  }

  const validCodes = [...new Set(activeHoldings.map((item) => item.code).filter((code) => /^[0-9]{6}$/.test(code)))];
  const hasManualOnlyAssets = activeHoldings.some((item) => Number.isFinite(Number(item.manualAmount)) && Number(item.manualAmount) > 0);

  if (validCodes.length === 0) {
    state.quoteMap = new Map();
    state.pendingQuoteCodes.clear();
    renderDashboardOnly();
    if (hasManualOnlyAssets) {
      setPriceStatus("手工录入资产无需行情刷新", "good");
      el.lastRefresh.textContent = new Date().toLocaleString("zh-CN", { hour12: false });
    } else {
      setPriceStatus("请至少填写一个 6 位基金代码", "bad");
    }
    return;
  }

  if (state.refreshInFlight) {
    state.refreshQueued = true;
    setPriceStatus("当前刷新尚未结束，已自动排队下一次刷新...");
    return;
  }

  try {
    state.refreshInFlight = true;
    state.refreshQueued = false;

    let items;
    let fxError = null;
    const nextQuoteMap = new Map();
    const latestPriceMode = isLatestPriceMode();
    state.pendingQuoteCodes.clear();
    setPriceStatus("正在刷新数据...");
    try {
      await ensureFxSnapshot({ force: true });
    } catch (error) {
      fxError = error;
    }
    items = await fetchSnapshotsBatched(validCodes, {
      onProgress: ({ batchIndex, totalBatches, batchCodes }) => {
        state.pendingQuoteCodes = latestPriceMode ? new Set(batchCodes) : new Set();
        if (latestPriceMode) {
          renderDashboardOnly();
        }
        if (totalBatches > 1) {
          setPriceStatus(`正在刷新数据（第 ${batchIndex}/${totalBatches} 批）${latestPriceMode ? "，最新价格读取中" : ""}...`);
        } else if (latestPriceMode) {
          setPriceStatus("正在刷新数据，最新价格读取中...");
        }
      },
      onBatch: ({ batchCodes, batchItems }) => {
        batchItems.forEach((item) => {
          nextQuoteMap.set(item.code, item);
        });
        batchCodes.forEach((code) => state.pendingQuoteCodes.delete(code));
        state.quoteMap = new Map(nextQuoteMap);
        renderDashboardOnly();
      },
    });

    state.quoteMap = new Map(items.map((item) => [item.code, item]));
    state.pendingQuoteCodes.clear();
    const refreshedActiveHoldings = vaultToActiveHoldings(state.vault);
    const refreshedSnapshot = buildPortfolioSnapshot(refreshedActiveHoldings);
    captureQuoteDiagnostics(refreshedActiveHoldings, refreshedSnapshot);
    await recordPriceSnapshotAndDailyNav(refreshedActiveHoldings, refreshedSnapshot);
    scheduleSync();
    renderDashboardOnly();
    if (state.activeTab === "performance") {
      void renderPerformanceOnly();
    }

    const invalidCodeCount = activeHoldings.filter((item) => item.code && !/^[0-9]{6}$/.test(item.code)).length;
    const quoteFailCount = items.filter((item) => !item.ok).length;
    const errorCount = invalidCodeCount + quoteFailCount;

    el.lastRefresh.textContent = new Date().toLocaleString("zh-CN", { hour12: false });
    const fxSummaryText = buildFxSummaryText();
    const navFallbackCount = latestPriceMode ? refreshedSnapshot.totalNavFallbackCount : 0;
    if (errorCount > 0 || fxError || navFallbackCount > 0) {
      const suffix = [];
      if (errorCount > 0) suffix.push(`${errorCount} 条记录有问题`);
      if (navFallbackCount > 0) suffix.push(`${navFallbackCount} 条使用净值替代`);
      if (fxError) {
        suffix.push(state.fxSnapshot ? "汇率更新失败，沿用上次汇率" : "汇率更新失败");
      } else if (fxSummaryText) {
        suffix.push(`汇率 ${fxSummaryText}`);
      }
      setPriceStatus(`刷新完成，${suffix.join("；")}`, "bad");
    } else {
      setPriceStatus(fxSummaryText ? `刷新完成，汇率 ${fxSummaryText}` : "刷新完成", "good");
    }
  } catch (error) {
    state.pendingQuoteCodes.clear();
    setPriceStatus(`刷新失败：${formatError(error)}`, "bad");
    renderDashboardOnly();
  } finally {
    state.pendingQuoteCodes.clear();
    state.refreshInFlight = false;
    if (state.refreshQueued) {
      state.refreshQueued = false;
      void refreshData();
    }
  }
}

async function syncCloud() {
  if (!state.unlocked || !state.passphrase) return;
  if (state.syncInFlight) return;

  state.syncInFlight = true;
  setVaultStatus("正在备份到 GitHub Gist...");

  try {
    await persistLocalNow();
    const encryptedVault = readLocalBundle() || (await encryptVault(state.vault, state.passphrase));
    const historyPayload = await exportHistoryPayload();
    const encryptedHistory = await encryptPayload(historyPayload, state.passphrase);
    const token = String(el.gistTokenInput?.value || readGistToken() || "").trim();
    const gistId = String(el.gistIdInput?.value || readGistId() || "").trim();

    if (!token) {
      throw new Error("请先填写 GitHub Token");
    }

    if (el.gistTokenInput) {
      el.gistTokenInput.value = token;
    }
    writeGistToken(token);

    const result = await upsertBackupGist({
      token,
      gistId,
      vaultBundle: encryptedVault,
      historyBundle: encryptedHistory,
    });

    writeGistId(result.id || gistId);
    writeGistSyncedAt(result.updatedAt || nowIso());
    writeGistUrl(result.url || "");
    syncGistInputsFromStorage();
    setVaultStatus("Gist 备份完成", "good");
  } finally {
    state.syncInFlight = false;
  }
}

function lockVault() {
  state.unlocked = false;
  state.passphrase = "";
  state.vault = null;
  state.fxSnapshot = null;
  state.quoteMap = new Map();
  state.pendingQuoteCodes.clear();
  state.collapsedClassKeys.clear();
  state.collapsedGroupKeys.clear();

  if (state.autoTimer) clearInterval(state.autoTimer);
  if (state.persistTimer) clearTimeout(state.persistTimer);
  if (state.syncTimer) clearTimeout(state.syncTimer);

  state.autoTimer = null;
  state.persistTimer = null;
  state.syncTimer = null;

  el.configList.innerHTML = "";
  el.viewTableBody.innerHTML = "";
  el.pieLegend.innerHTML = "";
  el.passphraseInput.value = "";
  el.totalAsset.textContent = "--";
  el.totalCost.textContent = "--";
  el.totalPnl.textContent = "--";
  el.totalPnl.classList.remove("is-good", "is-bad", "is-up", "is-down");
  el.lastRefresh.textContent = "未刷新";
  clearGroupTargetSection("请先解锁持仓库后查看目标仓位");
  clearTargetPieSection("请先解锁持仓库后查看目标分布");
  closeGroupTargetModal();
  closeHoldingModal();
  closeAccountModal();
  closeArchiveModal();
  closeDeleteConfirmModal();
  closePasswordModal();
  closeUnlockModal();

  setPriceStatus("等待刷新");
  setVaultStatus("当前状态：已锁定");
  syncGistInputsFromStorage();
  setActiveTab("view");
  syncDisplayCurrencyButtons();
  renderDashboardOnly();
  updateLockUI();
}

async function unlockVault() {
  if (state.unlocked) return true;

  const passphrase = el.passphraseInput.value;
  if (!passphrase || passphrase.length < 8) {
    setVaultStatus("口令长度至少 8 位", "bad");
    return false;
  }

  setVaultStatus("正在解锁并加载数据...");

  let localVault = null;
  let gistLoaded = false;

  const localBundle = readLocalBundle();
  if (localBundle) {
    try {
      localVault = await decryptVault(localBundle, passphrase);
    } catch (error) {
      setVaultStatus(`本地密文解锁失败：${formatError(error)}`, "bad");
      return false;
    }
  } else {
    const legacy = readLegacyHoldings();
    if (legacy && legacy.length > 0) {
      localVault = createVaultFromHoldings(legacy);
    }
  }

  const gistToken = readGistToken();
  const gistId = readGistId();
  if (!localVault && gistToken && gistId) {
    try {
      const remote = await readBackupGist({ token: gistToken, gistId });
      if (remote?.vaultBundle) {
        localVault = await decryptVault(remote.vaultBundle, passphrase);
        if (remote.historyBundle) {
          const historyPayload = await decryptPayload(remote.historyBundle, passphrase);
          await importHistoryPayload(historyPayload);
        }
        writeGistSyncedAt(remote.updatedAt || nowIso());
        writeGistUrl(remote.url || "");
        gistLoaded = true;
      }
    } catch (error) {
      setVaultStatus(`Gist 加载失败：${formatError(error)}`, "bad");
      return false;
    }
  }

  const merged = localVault || createVaultFromHoldings(defaultHoldings.map((item) => createHolding(item)));

  state.unlocked = true;
  state.passphrase = passphrase;
  state.vault = normalizeVault(merged);
  state.quoteMap = new Map();

  const remember = Boolean(el.rememberPassphraseInput.checked);
  writeRememberPreference(remember);
  if (remember) {
    writeRememberedPassphrase(passphrase);
  } else {
    clearRememberedPassphrase();
  }

  ensureAtLeastOneAccount(state.vault);
  ensureAtLeastOneActiveHolding();
  applyDefaultViewModes({ render: false });
  setIntervalSelectFromVault();
  updateLockUI();
  renderAllPanels();
  applyAutoRefresh();
  syncGistInputsFromStorage();

  setVaultStatus(
    gistLoaded
      ? remember
        ? "当前状态：已解锁（已从 Gist 恢复，本机已记住口令）"
        : "当前状态：已解锁（已从 Gist 恢复）"
      : remember
        ? "当前状态：已解锁（本机已记住口令）"
        : "当前状态：已解锁（口令仅保留在当前标签页内存）",
    "good",
  );
  setPriceStatus("已解锁，正在后台刷新行情...");

  closeUnlockModal();

  void (async () => {
    try {
      await persistLocalNow();
    } catch (error) {
      setVaultStatus(`本地保存失败：${formatError(error)}`, "bad");
    }

    try {
      await maybeEmitPeriodicFullSnapshot(state.vault?.activeAccountId);
    } catch (error) {
      setVaultStatus(`历史基线初始化失败：${formatError(error)}`, "bad");
    }

    try {
      await refreshData();
    } catch (error) {
      setPriceStatus(`刷新失败：${formatError(error)}`, "bad");
    }
  })();

  return true;
}

async function pullFromCloud() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再从 Gist 恢复", "bad");
    return;
  }

  const token = String(el.gistTokenInput?.value || readGistToken() || "").trim();
  const gistId = String(el.gistIdInput?.value || readGistId() || "").trim();
  if (!token || !gistId) {
    setVaultStatus("请先填写 Token 和 Gist ID", "bad");
    return;
  }
  writeGistToken(token);
  writeGistId(gistId);

  setVaultStatus("正在从 Gist 恢复...");
  const remote = await readBackupGist({ token, gistId });
  if (!remote?.vaultBundle) {
    throw new Error("Gist 中未找到 vault.json");
  }

  const remoteVault = await decryptVault(remote.vaultBundle, state.passphrase);
  if (remote.historyBundle) {
    const historyPayload = await decryptPayload(remote.historyBundle, state.passphrase);
    await importHistoryPayload(historyPayload);
  }

  state.vault = normalizeVault(remoteVault);
  ensureAtLeastOneAccount(state.vault);
  ensureAtLeastOneActiveHolding();
  applyDefaultViewModes({ render: false });
  setIntervalSelectFromVault();
  renderAllPanels();
  await refreshData();
  await persistLocalNow();
  writeGistId(remote.id || gistId);
  writeGistSyncedAt(remote.updatedAt || nowIso());
  writeGistUrl(remote.url || "");
  syncGistInputsFromStorage();
  setVaultStatus("Gist 恢复完成", "good");
}

function addHoldingRow() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再新增持仓", "bad");
    openUnlockModal();
    return;
  }
  openHoldingModal("create");
}

function exportEncryptedBackup() {
  if (!state.unlocked) {
    setVaultStatus("请先解锁后再导出", "bad");
    return;
  }

  const bundle = readLocalBundle();
  if (!bundle) {
    setVaultStatus("本地没有可导出的密文数据", "bad");
    return;
  }

  const payload = {
    exportedAt: nowIso(),
    format: "qdii-encrypted-v1",
    bundle,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "qdii-vault-encrypted-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importEncryptedBackup(file) {
  if (!file) return;
  const text = await file.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效 JSON");
  }

  const bundle = parsed?.bundle || parsed;
  if (!bundle?.kdf?.salt || !bundle?.enc?.ciphertext || !bundle?.enc?.iv) {
    throw new Error("不是合法的密文备份格式");
  }

  if (state.unlocked) {
    const importedVault = await decryptVault(bundle, state.passphrase);
    state.vault = normalizeVault(importedVault);
    state.quoteMap = new Map();
    ensureAtLeastOneAccount(state.vault);
    ensureAtLeastOneActiveHolding();
    setIntervalSelectFromVault();
    renderAllPanels();
    await emitFullSnapshot(state.vault.activeAccountId);
    await refreshData();
    await persistLocalNow();
    scheduleSync(200);
  } else {
    await writeLocalBundle(bundle);
  }
}

async function tryAutoUnlockWithRememberedPassphrase() {
  const remembered = readRememberedPassphrase();
  if (!remembered) return;

  el.rememberPassphraseInput.checked = true;
  el.passphraseInput.value = remembered;
  const ok = await unlockVault();
  if (ok) return;

  clearRememberedPassphrase();
  writeRememberPreference(false);
  el.passphraseInput.value = "";
  el.rememberPassphraseInput.checked = false;
  setVaultStatus("本机记住口令已失效，请手动解锁", "bad");
}

function bindEvents() {
  el.unlockOpenBtn.addEventListener("click", () => openUnlockModal());

  el.unlockBtn.addEventListener("click", () => {
    unlockVault().catch((error) => setVaultStatus(formatError(error), "bad"));
  });

  el.unlockCancelBtn.addEventListener("click", () => closeUnlockModal());

  el.unlockModal.addEventListener("click", (event) => {
    if (event.target === el.unlockModal) {
      closeUnlockModal();
    }
  });

  el.rememberPassphraseInput.addEventListener("change", () => {
    const remember = Boolean(el.rememberPassphraseInput.checked);
    writeRememberPreference(remember);
    if (!remember) clearRememberedPassphrase();
  });

  el.gistTokenInput?.addEventListener("change", () => {
    writeGistToken(String(el.gistTokenInput.value || "").trim());
  });

  el.gistIdInput?.addEventListener("change", () => {
    writeGistId(String(el.gistIdInput.value || "").trim());
    syncGistInputsFromStorage();
  });

  el.gistVerifyBtn?.addEventListener("click", () => {
    const token = String(el.gistTokenInput?.value || "").trim();
    verifyGistToken(token)
      .then(() => {
        writeGistToken(token);
        setVaultStatus("GitHub Token 校验通过", "good");
      })
      .catch((error) => {
        setVaultStatus(`Token 校验失败：${formatError(error)}`, "bad");
      });
  });

  el.changePassBtn.addEventListener("click", () => openPasswordModal());

  el.passwordCancelBtn.addEventListener("click", () => closePasswordModal());

  el.passwordSaveBtn.addEventListener("click", () => {
    savePasswordChange().catch((error) => setVaultStatus(formatError(error), "bad"));
  });

  el.passwordModal.addEventListener("click", (event) => {
    if (event.target === el.passwordModal) {
      closePasswordModal();
    }
  });

  el.passwordModal.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    savePasswordChange().catch((error) => setVaultStatus(formatError(error), "bad"));
  });

  el.accountAddBtn.addEventListener("click", () => openAccountModal("create"));

  el.accountRenameBtn.addEventListener("click", () => {
    const active = getActiveAccount();
    if (!active) return;
    openAccountModal("edit", active);
  });

  el.archiveOpenBtn.addEventListener("click", () => openArchiveModal());

  el.accountDeleteBtn.addEventListener("click", () => removeActiveAccount());

  el.accountSelect.addEventListener("change", () => {
    if (!state.unlocked) return;
    switchAccount(el.accountSelect.value);
  });

  el.displayCurrencyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      changeDisplayCurrency(button.dataset.displayCurrency).catch((error) => {
        setPriceStatus(`切换计价失败：${formatError(error)}`, "bad");
      });
    });
  });

  el.accountCancelBtn.addEventListener("click", () => closeAccountModal());

  el.accountSaveBtn.addEventListener("click", () => saveAccountFromModal());

  el.accountModal.addEventListener("click", (event) => {
    if (event.target === el.accountModal) {
      closeAccountModal();
    }
  });

  el.accountModal.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveAccountFromModal();
  });

  el.holdingCancelBtn.addEventListener("click", () => closeHoldingModal());

  el.holdingSaveBtn.addEventListener("click", () => saveHoldingFromModal());

  el.holdingModal.addEventListener("click", (event) => {
    if (event.target === el.holdingModal) {
      closeHoldingModal();
    }
  });

  el.holdingModal.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveHoldingFromModal();
  });

  el.groupTargetCancelBtn.addEventListener("click", () => closeGroupTargetModal());

  el.groupTargetSaveBtn.addEventListener("click", () => saveGroupTargetFromModal());

  el.groupTargetClearBtn.addEventListener("click", () => clearGroupTargetFromModal());

  el.groupTargetModal.addEventListener("click", (event) => {
    if (event.target === el.groupTargetModal) {
      closeGroupTargetModal();
    }
  });

  el.groupTargetModal.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveGroupTargetFromModal();
  });

  el.archiveCloseBtn.addEventListener("click", () => closeArchiveModal());

  el.archiveModal.addEventListener("click", (event) => {
    if (event.target === el.archiveModal) {
      closeArchiveModal();
    }
  });

  el.deleteConfirmCancelBtn.addEventListener("click", () => closeDeleteConfirmModal());

  el.deleteConfirmSubmitBtn.addEventListener("click", () => confirmDeleteAction());

  el.deleteConfirmModal.addEventListener("click", (event) => {
    if (event.target === el.deleteConfirmModal) {
      closeDeleteConfirmModal();
    }
  });

  el.deleteConfirmModal.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmDeleteAction();
  });

  el.lockBtn.addEventListener("click", () => lockVault());

  el.passphraseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockVault().catch((error) => setVaultStatus(formatError(error), "bad"));
    }
  });

  el.refreshBtn.addEventListener("click", () => {
    refreshData().catch((error) => setPriceStatus(formatError(error), "bad"));
  });

  el.syncBtn.addEventListener("click", () => {
    syncCloud().catch((error) => setVaultStatus(`Gist 备份失败：${formatError(error)}`, "bad"));
  });

  el.syncPullBtn.addEventListener("click", () => {
    pullFromCloud().catch((error) => setVaultStatus(`Gist 恢复失败：${formatError(error)}`, "bad"));
  });

  el.interval.addEventListener("change", () => {
    if (!state.unlocked) return;
    updateRefreshIntervalInVault(el.interval.value);
    applyAutoRefresh();
    schedulePersist();
    scheduleSync();
  });

  el.quotePreference.addEventListener("change", () => {
    if (!state.unlocked) return;
    updateQuotePreferenceInVault(el.quotePreference.value);
    schedulePersist();
    scheduleSync();
    refreshData().catch((error) => setPriceStatus(formatError(error), "bad"));
  });

  el.quoteDebugClearBtn.addEventListener("click", () => {
    if (!state.unlocked) return;
    clearActiveQuoteDiagnostics();
    renderQuoteDebugPanel();
    setPriceStatus("已清空当前账户的刷新诊断", "normal");
  });

  el.exportBtn.addEventListener("click", () => exportEncryptedBackup());
  el.exportHistoryBtn?.addEventListener("click", () => {
    exportHistoryEventsJson().catch((error) => setVaultStatus(`历史导出失败：${formatError(error)}`, "bad"));
  });
  el.importHistoryBtn?.addEventListener("click", () => {
    el.importHistoryFile?.click();
  });
  el.importHistoryFile?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importHistoryEventsJson(file);
    } catch (error) {
      setVaultStatus(`历史事件导入失败：${formatError(error)}`, "bad");
    } finally {
      event.target.value = "";
    }
  });
  el.exportDailyNavBtn?.addEventListener("click", () => {
    exportDailyNavCsv().catch((error) => setVaultStatus(`每日净值导出失败：${formatError(error)}`, "bad"));
  });

  el.importBtn.addEventListener("click", () => {
    el.importFile.click();
  });

  el.importFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    try {
      await importEncryptedBackup(file);
      setVaultStatus("备份导入成功", "good");
    } catch (error) {
      setVaultStatus(`备份导入失败：${formatError(error)}`, "bad");
    } finally {
      event.target.value = "";
    }
  });

  el.historyReplayBtn?.addEventListener("click", () => {
    previewHistoryReplay().catch((error) => setVaultStatus(`历史回放失败：${formatError(error)}`, "bad"));
  });

  el.seedPreviewHistoryBtn?.addEventListener("click", () => {
    seedPerformancePreviewHistory().catch((error) => setVaultStatus(`生成演示历史失败：${formatError(error)}`, "bad"));
  });

  el.restorePreviewHistoryBtn?.addEventListener("click", () => {
    restorePerformancePreviewHistory().catch((error) => setVaultStatus(`恢复原历史失败：${formatError(error)}`, "bad"));
  });

  el.tabViewBtn.addEventListener("click", () => setActiveTab("view"));
  el.tabPieBtn.addEventListener("click", () => setActiveTab("pie"));
  el.tabPerformanceBtn.addEventListener("click", () => setActiveTab("performance"));
  el.tabConfigBtn.addEventListener("click", () => setActiveTab("config"));

  el.performancePresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.performancePreset = normalizePerformancePreset(button.dataset.performancePreset);
      if (state.performancePreset !== "custom") {
        state.performanceStartDate = "";
        state.performanceEndDate = "";
      }
      syncPerformancePresetButtons();
      if (state.unlocked && state.activeTab === "performance") {
        void renderPerformanceOnly();
      }
    });
  });

  el.performanceStartDateInput?.addEventListener("change", () => {
    state.performancePreset = "custom";
    state.performanceStartDate = String(el.performanceStartDateInput.value || "").trim();
    syncPerformancePresetButtons();
    if (state.unlocked && state.activeTab === "performance") {
      void renderPerformanceOnly();
    }
  });

  el.performanceEndDateInput?.addEventListener("change", () => {
    state.performancePreset = "custom";
    state.performanceEndDate = String(el.performanceEndDateInput.value || "").trim();
    syncPerformancePresetButtons();
    if (state.unlocked && state.activeTab === "performance") {
      void renderPerformanceOnly();
    }
  });

  el.performanceScopeType?.addEventListener("change", () => {
    state.performanceScopeType = normalizePerformanceScopeType(el.performanceScopeType.value);
    state.performanceScopeTarget = "";
    if (state.unlocked && state.activeTab === "performance") {
      void renderPerformanceOnly();
    }
  });

  el.performanceScopeTarget?.addEventListener("change", () => {
    state.performanceScopeTarget = String(el.performanceScopeTarget.value || "").trim();
    if (state.unlocked && state.activeTab === "performance") {
      void renderPerformanceOnly();
    }
  });

  el.performanceMetricButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.performanceMetricMode = normalizePerformanceMetricMode(button.dataset.performanceMetric);
      syncPerformanceMetricButtons();
      if (state.unlocked && state.activeTab === "performance") {
        void renderPerformanceOnly();
      }
    });
  });

  el.performanceChart?.addEventListener("click", handlePerformanceChartClick);

  el.viewSort.addEventListener("change", () => {
    if (!state.unlocked) return;
    renderDashboardOnly();
  });

  el.treeModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.unlocked) return;
      setTreeDepth(button.dataset.treeDepth);
    });
  });

  el.pieLevel.addEventListener("change", () => {
    setPieLevel(el.pieLevel.value);
  });

  el.pieModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.unlocked) return;
      setPieLevel(button.dataset.pieLevel);
    });
  });

  el.pieDisplayButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.unlocked) return;
      setPieDisplayMode(button.dataset.pieDisplay);
    });
  });

  el.targetPieModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.unlocked) return;
      setTargetPieLevel(button.dataset.targetPieLevel);
    });
  });

  el.pieCanvas.addEventListener("click", () => {
    if (!state.unlocked) return;
    cyclePieLevel();
  });

  el.addRowBtn.addEventListener("click", () => addHoldingRow());

  window.addEventListener("resize", () => {
    if (!state.unlocked) return;
    if (state.resizeTimer) clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      if (state.activeTab === "pie") {
        renderPieOnly();
        return;
      }
      if (state.activeTab === "performance") {
        void renderPerformanceOnly();
        return;
      }
      renderDashboardOnly();
    }, 120);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!el.deleteConfirmModal.hidden) {
      closeDeleteConfirmModal();
      return;
    }
    if (!el.archiveModal.hidden) {
      closeArchiveModal();
      return;
    }
    if (!el.accountModal.hidden) {
      closeAccountModal();
      return;
    }
    if (!el.holdingModal.hidden) {
      closeHoldingModal();
      return;
    }
    if (!el.groupTargetModal.hidden) {
      closeGroupTargetModal();
      return;
    }
    if (!el.passwordModal.hidden) {
      closePasswordModal();
      return;
    }
    if (!el.unlockModal.hidden) {
      closeUnlockModal();
    }
  });
}

async function init() {
  lockVault();
  syncTreeDepthButtons([]);
  syncPieDisplayButtons();
  syncPerformancePresetButtons();
  syncPerformanceMetricButtons();
  syncDisplayCurrencyButtons();
  setPieLevel(el.pieLevel?.value || "group", { render: false });
  setTargetPieLevel(state.targetPieLevel || "group", { render: false });
  if (el.performanceScopeType) {
    el.performanceScopeType.value = normalizePerformanceScopeType(state.performanceScopeType);
  }
  clearPerformancePanel("解锁后可查看收益率曲线。");
  setVaultStatus("正在初始化本地存储...");
  setPriceStatus("请先解锁持仓库后刷新");
  bindEvents();
  await initStorage({
    legacyBundleKey: STORAGE_KEY,
    configMigrations: [
      {
        key: QUOTE_SOURCE_HINTS_KEY,
        legacyKey: QUOTE_SOURCE_HINTS_KEY,
        parse: (raw) => JSON.parse(raw),
      },
      {
        key: FUND_NAME_CACHE_KEY,
        legacyKey: FUND_NAME_CACHE_KEY,
        parse: (raw) => JSON.parse(raw),
      },
      {
        key: REMEMBER_PASS_KEY,
        legacyKey: REMEMBER_PASS_KEY,
        parse: (raw) => raw === "1",
      },
      {
        key: PASS_CACHE_KEY,
        legacyKey: PASS_CACHE_KEY,
        parse: (raw) => raw,
      },
    ],
  });
  state.storageReady = true;
  syncRememberToggleFromStorage();
  syncGistInputsFromStorage();
  if (el.historyReplayDateInput) {
    el.historyReplayDateInput.value = getLocalDateKey();
  }
  setVaultStatus("当前状态：未解锁");
  tryAutoUnlockWithRememberedPassphrase().catch(() => {});
}

init().catch((error) => {
  setVaultStatus(`本地存储初始化失败：${formatError(error)}`, "bad");
});
