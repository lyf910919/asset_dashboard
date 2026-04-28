const SUPPORTED_CURRENCY_CODES = ["USD", "CNY", "HKD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD"];
const DEFAULT_GROUP_NAME = "未分组";
const ASSET_CLASS_ORDER = ["stock", "bond", "gold", "cash"];
const ACCOUNT_VALUE_SNAPSHOT = "ACCOUNT_VALUE_SNAPSHOT";
const ACCOUNT_CASH_FLOW = "ACCOUNT_CASH_FLOW";
const ASSET_CLASS_LABELS = {
  stock: "股票",
  bond: "债券",
  gold: "黄金",
  cash: "现金",
};

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function parseFloatSafe(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCurrencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return SUPPORTED_CURRENCY_CODES.includes(code) ? code : null;
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

function normalizeAssetClass(value) {
  const text = String(value || "").trim().toLowerCase();
  return ASSET_CLASS_ORDER.includes(text) ? text : "stock";
}

function normalizeGroupName(value) {
  const text = String(value || "").trim();
  return text || DEFAULT_GROUP_NAME;
}

function buildGroupCompositeKey(classKey, groupName) {
  return `${normalizeAssetClass(classKey)}::${normalizeGroupName(groupName)}`;
}

function toTime(value) {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareByTimeline(left, right) {
  const leftTime = toTime(left?.timestamp || `${left?.date || ""}T00:00:00`);
  const rightTime = toTime(right?.timestamp || `${right?.date || ""}T00:00:00`);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return Number(left?.id || 0) - Number(right?.id || 0);
}

function formatHoldingLabel(holding) {
  const name = String(holding?.name || "").trim();
  const code = String(holding?.code || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "未命名资产";
}

function makeHoldingSnapshot(input = {}) {
  return {
    id: String(input?.id || "").trim(),
    name: String(input?.name || "").trim(),
    code: String(input?.code || "").trim(),
    units: Number.isFinite(Number(input?.units)) ? Number(input.units) : 0,
    cost: parseFloatSafe(input?.cost),
    manualAmount: parseFloatSafe(input?.manualAmount),
    manualAmountCurrency: normalizeCurrencyCode(input?.manualAmountCurrency) || "CNY",
    manualPrice: parseFloatSafe(input?.manualPrice),
    assetClass: normalizeAssetClass(input?.assetClass),
    groupName: normalizeGroupName(input?.groupName),
    sortOrder: Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : null,
  };
}

function applyHoldingPatch(baseHolding, before = {}, after = {}) {
  const patched = { ...makeHoldingSnapshot(baseHolding) };
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach((key) => {
    if (!(key in after)) return;
    patched[key] = cloneValue(after[key]);
  });
  return makeHoldingSnapshot(patched);
}

function updateLatestPriceBook(priceBook, payload) {
  const prices = payload?.prices && typeof payload.prices === "object" ? payload.prices : {};
  Object.entries(prices).forEach(([code, value]) => {
    if (!/^[0-9]{6}$/.test(String(code || "").trim())) return;
    priceBook[code] = {
      ...(priceBook[code] || {}),
      price: parseFloatSafe(value?.price),
      nav: parseFloatSafe(value?.nav),
      source: value?.source || priceBook[code]?.source || null,
      navDate: value?.navDate || priceBook[code]?.navDate || null,
      currency: normalizeCurrencyCode(value?.currency) || priceBook[code]?.currency || null,
      currencyLabel: value?.currencyLabel || priceBook[code]?.currencyLabel || null,
    };
  });
}

function canUseAccountLevelEvents(scope) {
  const normalizedScope = scope && typeof scope === "object" ? scope : { type: "portfolio" };
  return !normalizedScope.type || normalizedScope.type === "portfolio";
}

function readAccountValueSnapshot(event, fxRates, displayCurrencyCode) {
  const rawValue = parseFloatSafe(event?.payload?.totalAsset ?? event?.payload?.marketValue ?? event?.payload?.value);
  if (!Number.isFinite(rawValue)) return null;
  const currency = normalizeCurrencyCode(event?.payload?.currency) || "CNY";
  return convertAmount(rawValue, currency, displayCurrencyCode, fxRates);
}

function readAccountCashFlow(event, fxRates, displayCurrencyCode) {
  const rawAmount = parseFloatSafe(event?.payload?.amount);
  if (!Number.isFinite(rawAmount) || Math.abs(rawAmount) <= 1e-8) return 0;
  const currency = normalizeCurrencyCode(event?.payload?.currency) || "CNY";
  const converted = convertAmount(Math.abs(rawAmount), currency, displayCurrencyCode, fxRates);
  if (!Number.isFinite(converted)) return 0;
  return rawAmount < 0 ? -converted : converted;
}

function resolveHoldingCurrency(holding, priceEntry) {
  return (
    normalizeCurrencyCode(priceEntry?.currency) ||
    inferCurrencyCodeFromText(priceEntry?.currencyLabel) ||
    inferCurrencyCodeFromText(holding?.name) ||
    "CNY"
  );
}

function convertAmount(value, fromCurrency, toCurrency, fxRates) {
  if (!Number.isFinite(value)) return null;
  const from = normalizeCurrencyCode(fromCurrency) || "CNY";
  const to = normalizeCurrencyCode(toCurrency) || "CNY";
  if (from === to) return value;

  const usdBase = { USD: 1, ...(fxRates && typeof fxRates === "object" ? fxRates : {}) };

  let amountInUsd = null;
  if (from === "USD") {
    amountInUsd = value;
  } else {
    const usdToFrom = Number(usdBase[from]);
    if (!Number.isFinite(usdToFrom) || usdToFrom <= 0) return null;
    amountInUsd = value / usdToFrom;
  }

  if (to === "USD") return amountInUsd;

  const usdToTarget = Number(usdBase[to]);
  if (!Number.isFinite(usdToTarget) || usdToTarget <= 0) return null;
  return amountInUsd * usdToTarget;
}

function valueHolding(holding, priceBook, fxRates, displayCurrencyCode) {
  const manualAmount = parseFloatSafe(holding?.manualAmount);
  if (Number.isFinite(manualAmount)) {
    const converted = convertAmount(manualAmount, holding?.manualAmountCurrency || "CNY", displayCurrencyCode, fxRates);
    return {
      value: converted,
      estimated: false,
      source: "manual_amount",
    };
  }

  const units = parseFloatSafe(holding?.units);
  if (!Number.isFinite(units) || units <= 0) {
    return {
      value: 0,
      estimated: false,
      source: "empty",
    };
  }

  const code = String(holding?.code || "").trim();
  const priceEntry = code ? priceBook?.[code] || null : null;
  const marketPrice = parseFloatSafe(priceEntry?.price) ?? parseFloatSafe(priceEntry?.nav);
  const fallbackPrice = parseFloatSafe(holding?.manualPrice) ?? parseFloatSafe(holding?.cost);
  const price = Number.isFinite(marketPrice) ? marketPrice : fallbackPrice;
  if (!Number.isFinite(price)) {
    return {
      value: null,
      estimated: true,
      source: "missing",
    };
  }

  const currency = resolveHoldingCurrency(holding, priceEntry);
  const converted = convertAmount(units * price, currency, displayCurrencyCode, fxRates);
  return {
    value: converted,
    estimated: !Number.isFinite(marketPrice),
    source: Number.isFinite(marketPrice) ? "market" : parseFloatSafe(holding?.manualPrice) ? "manual_price" : "cost",
  };
}

function holdingMatchesScope(holding, scope) {
  const normalizedScope = scope && typeof scope === "object" ? scope : { type: "portfolio" };
  if (!holding) return false;

  switch (normalizedScope.type) {
    case "class":
      return normalizeAssetClass(holding.assetClass) === normalizeAssetClass(normalizedScope.classKey);
    case "group":
      return buildGroupCompositeKey(holding.assetClass, holding.groupName) === normalizedScope.groupKey;
    case "holding":
      return String(holding.id || "") === String(normalizedScope.holdingId || "");
    default:
      return true;
  }
}

function summarizeTransitionFlow(beforeHolding, afterHolding, scope, priceBook, fxRates, displayCurrencyCode) {
  const beforeInScope = holdingMatchesScope(beforeHolding, scope);
  const afterInScope = holdingMatchesScope(afterHolding, scope);
  if (!beforeInScope && !afterInScope) {
    return { inflow: 0, outflow: 0, estimated: false, unresolved: false };
  }

  const beforeValuation = beforeHolding ? valueHolding(beforeHolding, priceBook, fxRates, displayCurrencyCode) : null;
  const afterValuation = afterHolding ? valueHolding(afterHolding, priceBook, fxRates, displayCurrencyCode) : null;
  const beforeValue = beforeValuation?.value;
  const afterValue = afterValuation?.value;
  const codeChanged = String(beforeHolding?.code || "") !== String(afterHolding?.code || "");

  let inflow = 0;
  let outflow = 0;
  let unresolved = false;

  if (beforeInScope && afterInScope && !codeChanged) {
    if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) {
      unresolved = true;
    } else {
      const delta = afterValue - beforeValue;
      if (delta > 0) inflow += delta;
      if (delta < 0) outflow += Math.abs(delta);
    }
  } else {
    if (beforeInScope) {
      if (Number.isFinite(beforeValue)) {
        outflow += beforeValue;
      } else {
        unresolved = true;
      }
    }
    if (afterInScope) {
      if (Number.isFinite(afterValue)) {
        inflow += afterValue;
      } else {
        unresolved = true;
      }
    }
  }

  return {
    inflow,
    outflow,
    estimated: Boolean(beforeValuation?.estimated || afterValuation?.estimated),
    unresolved,
  };
}

function annualizeReturn(totalReturn, dayCount) {
  if (!Number.isFinite(totalReturn) || !Number.isFinite(dayCount) || dayCount <= 0 || totalReturn <= -1) return null;
  return Math.pow(1 + totalReturn, 365 / dayCount) - 1;
}

function xnpv(rate, cashflows) {
  const first = cashflows[0];
  const baseTime = new Date(`${first.date}T00:00:00`).getTime();
  return cashflows.reduce((sum, item) => {
    const itemTime = new Date(`${item.date}T00:00:00`).getTime();
    const days = (itemTime - baseTime) / (24 * 60 * 60 * 1000);
    return sum + item.amount / Math.pow(1 + rate, days / 365);
  }, 0);
}

function xnpvDerivative(rate, cashflows) {
  const first = cashflows[0];
  const baseTime = new Date(`${first.date}T00:00:00`).getTime();
  return cashflows.reduce((sum, item) => {
    const itemTime = new Date(`${item.date}T00:00:00`).getTime();
    const days = (itemTime - baseTime) / (24 * 60 * 60 * 1000);
    const exponent = days / 365;
    if (exponent === 0) return sum;
    return sum - (exponent * item.amount) / Math.pow(1 + rate, exponent + 1);
  }, 0);
}

function computeXirr(cashflows) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const hasPositive = cashflows.some((item) => Number(item.amount) > 0);
  const hasNegative = cashflows.some((item) => Number(item.amount) < 0);
  if (!hasPositive || !hasNegative) return null;

  let guess = 0.1;
  for (let index = 0; index < 60; index += 1) {
    const value = xnpv(guess, cashflows);
    const derivative = xnpvDerivative(guess, cashflows);
    if (!Number.isFinite(value) || !Number.isFinite(derivative) || Math.abs(derivative) < 1e-10) {
      break;
    }
    const next = guess - value / derivative;
    if (!Number.isFinite(next) || next <= -0.999999999) {
      break;
    }
    if (Math.abs(next - guess) < 1e-10) {
      return next;
    }
    guess = next;
  }

  let low = -0.9999;
  let high = 10;
  let lowValue = xnpv(low, cashflows);
  let highValue = xnpv(high, cashflows);

  let expandCount = 0;
  while (Number.isFinite(lowValue) && Number.isFinite(highValue) && lowValue * highValue > 0 && expandCount < 20) {
    high *= 2;
    highValue = xnpv(high, cashflows);
    expandCount += 1;
  }

  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    return null;
  }

  for (let index = 0; index < 100; index += 1) {
    const mid = (low + high) / 2;
    const value = xnpv(mid, cashflows);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-10) return mid;
    if (lowValue * value <= 0) {
      high = mid;
      highValue = value;
    } else {
      low = mid;
      lowValue = value;
    }
  }

  return (low + high) / 2;
}

function buildHoldingCatalogEntry(holding, previous = null) {
  return {
    id: String(holding?.id || previous?.id || "").trim(),
    label: formatHoldingLabel(holding?.name || holding?.code ? holding : previous),
    code: String(holding?.code || previous?.code || "").trim(),
    assetClass: normalizeAssetClass(holding?.assetClass || previous?.assetClass),
    groupName: normalizeGroupName(holding?.groupName || previous?.groupName),
    sortOrder: Number.isFinite(Number(holding?.sortOrder)) ? Number(holding.sortOrder) : Number(previous?.sortOrder) || null,
  };
}

export function buildPerformanceScopeCatalog({ account = null, events = [] } = {}) {
  const holdingMap = new Map();

  function collectHolding(rawHolding) {
    if (!rawHolding) return;
    const next = buildHoldingCatalogEntry(rawHolding, holdingMap.get(String(rawHolding?.id || "").trim()) || null);
    if (!next.id) return;
    const existing = holdingMap.get(next.id);
    if (!existing) {
      holdingMap.set(next.id, next);
      return;
    }
    holdingMap.set(next.id, {
      ...existing,
      ...next,
      label: next.label || existing.label,
      code: next.code || existing.code,
      sortOrder: next.sortOrder ?? existing.sortOrder,
    });
  }

  const allEvents = Array.isArray(events) ? [...events].sort(compareByTimeline) : [];
  allEvents.forEach((event) => {
    if (event?.type === "FULL_SNAPSHOT") {
      (Array.isArray(event?.payload?.holdings) ? event.payload.holdings : []).forEach(collectHolding);
      return;
    }

    if (event?.type !== "HOLDINGS_CHANGE") return;
    const action = String(event?.payload?.action || "").trim().toUpperCase();
    if (action === "ADD" || action === "RESTORE" || action === "DELETE") {
      collectHolding(event?.payload?.holding);
      return;
    }
    if (action === "UPDATE") {
      collectHolding({
        id: event?.payload?.holdingId,
        ...(event?.payload?.before || {}),
      });
      collectHolding({
        id: event?.payload?.holdingId,
        ...(event?.payload?.after || {}),
      });
    }
  });

  (Array.isArray(account?.holdings) ? account.holdings : []).forEach(collectHolding);

  const holdings = [...holdingMap.values()].sort((left, right) => {
    const byOrder = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
    if (byOrder !== 0) return byOrder;
    return left.label.localeCompare(right.label, "zh-CN");
  });

  const classMap = new Map();
  const groupMap = new Map();
  holdings.forEach((holding) => {
    const classKey = normalizeAssetClass(holding.assetClass);
    if (!classMap.has(classKey)) {
      classMap.set(classKey, {
        type: "class",
        classKey,
        label: ASSET_CLASS_LABELS[classKey] || classKey,
      });
    }

    const groupKey = buildGroupCompositeKey(classKey, holding.groupName);
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        type: "group",
        groupKey,
        classKey,
        groupName: normalizeGroupName(holding.groupName),
        label: `${ASSET_CLASS_LABELS[classKey] || classKey} / ${normalizeGroupName(holding.groupName)}`,
      });
    }
  });

  return {
    classes: [...classMap.values()].sort(
      (left, right) => ASSET_CLASS_ORDER.indexOf(left.classKey) - ASSET_CLASS_ORDER.indexOf(right.classKey),
    ),
    groups: [...groupMap.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
    holdings: holdings.map((holding) => ({
      type: "holding",
      holdingId: holding.id,
      label: holding.label,
      code: holding.code,
      classKey: holding.assetClass,
      groupName: holding.groupName,
    })),
  };
}

export function computePerformanceReport({
  accountId,
  events = [],
  scope = { type: "portfolio" },
  rangeStart,
  rangeEnd,
  displayCurrencyCode = "CNY",
} = {}) {
  const startDate = String(rangeStart || "").trim();
  const endDate = String(rangeEnd || "").trim();
  if (!accountId || !startDate || !endDate || startDate > endDate) {
    return {
      ok: false,
      reason: "请选择有效的收益率区间",
    };
  }

  const relevantEvents = [...(Array.isArray(events) ? events : [])]
    .filter((item) => item?.accountId === accountId && item?.date && item.date <= endDate)
    .sort(compareByTimeline);

  const useAccountLevelEvents = canUseAccountLevelEvents(scope);
  const baselineCandidates = relevantEvents.filter(
    (item) =>
      item?.date &&
      item.date <= endDate &&
      (item?.type === "FULL_SNAPSHOT" || (useAccountLevelEvents && item?.type === ACCOUNT_VALUE_SNAPSHOT)),
  );
  const baseline =
    [...baselineCandidates].reverse().find((item) => item.date <= startDate) ||
    baselineCandidates.find((item) => item.date >= startDate) ||
    null;

  if (!baseline) {
    return {
      ok: false,
      reason: "历史记录里还没有可用于收益率计算的基线快照",
    };
  }

  const holdings = new Map(
    (Array.isArray(baseline?.payload?.holdings) ? baseline.payload.holdings : [])
      .map((item) => makeHoldingSnapshot(item))
      .filter((item) => item.id)
      .map((item) => [item.id, item]),
  );

  let accountDeleted = false;
  const priceBook = {};
  let latestFx = null;

  relevantEvents
    .filter((item) => item?.type === "PRICE_SNAPSHOT" && compareByTimeline(item, baseline) <= 0)
    .forEach((event) => {
      updateLatestPriceBook(priceBook, event?.payload || {});
      if (event?.payload?.fx && typeof event.payload.fx === "object") {
        latestFx = cloneValue(event.payload.fx);
      }
    });

  const baselineAccountValue =
    useAccountLevelEvents && baseline?.type === ACCOUNT_VALUE_SNAPSHOT
      ? readAccountValueSnapshot(baseline, latestFx, displayCurrencyCode)
      : null;
  const recordsAfterBaseline = relevantEvents.filter((item) => compareByTimeline(item, baseline) > 0);
  const byDate = new Map();
  recordsAfterBaseline.forEach((event) => {
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  });

  const timelineDates = [...new Set([baseline.date, ...byDate.keys()])].sort((left, right) => left.localeCompare(right));
  const timeline = [];
  let lastKnownValue = null;
  let accountValueSnapshotCount = Number.isFinite(baselineAccountValue) ? 1 : 0;
  let accountCashFlowCount = 0;
  let carriedInflow = 0;
  let carriedOutflow = 0;

  timelineDates.forEach((date) => {
    const dayRecords = (byDate.get(date) || []).sort(compareByTimeline);
    const pendingTransitions = [];
    let forcedMarketValue = date === baseline.date && Number.isFinite(baselineAccountValue) ? baselineAccountValue : null;
    let directInflow = 0;
    let directOutflow = 0;

    dayRecords.forEach((event) => {
      if (useAccountLevelEvents && event?.type === ACCOUNT_VALUE_SNAPSHOT) {
        const value = readAccountValueSnapshot(event, latestFx, displayCurrencyCode);
        if (Number.isFinite(value)) {
          forcedMarketValue = value;
          accountValueSnapshotCount += 1;
        }
        return;
      }

      if (useAccountLevelEvents && event?.type === ACCOUNT_CASH_FLOW) {
        const amount = readAccountCashFlow(event, latestFx, displayCurrencyCode);
        if (amount > 0) {
          directInflow += amount;
          accountCashFlowCount += 1;
        } else if (amount < 0) {
          directOutflow += Math.abs(amount);
          accountCashFlowCount += 1;
        }
        return;
      }

      if (event?.type === "HOLDINGS_CHANGE") {
        const action = String(event?.payload?.action || "").trim().toUpperCase();

        if (action === "ADD" || action === "RESTORE") {
          const afterHolding = makeHoldingSnapshot(event?.payload?.holding || {});
          pendingTransitions.push({ before: null, after: afterHolding });
          if (afterHolding.id) {
            holdings.set(afterHolding.id, afterHolding);
          }
          return;
        }

        if (action === "DELETE") {
          const existing = holdings.get(String(event?.payload?.holdingId || "").trim()) || makeHoldingSnapshot(event?.payload?.holding || {});
          pendingTransitions.push({ before: existing, after: null });
          holdings.delete(existing.id);
          return;
        }

        if (action === "UPDATE") {
          const holdingId = String(event?.payload?.holdingId || "").trim();
          const beforeHolding = holdings.get(holdingId) || makeHoldingSnapshot({ id: holdingId, ...(event?.payload?.before || {}) });
          const afterHolding = applyHoldingPatch(beforeHolding, event?.payload?.before || {}, event?.payload?.after || {});
          pendingTransitions.push({ before: beforeHolding, after: afterHolding });
          if (holdingId) {
            holdings.set(holdingId, afterHolding);
          }
          return;
        }

        if (action === "ACCOUNT_DELETE") {
          accountDeleted = true;
          return;
        }

        if (action === "ACCOUNT_RESTORE" || action === "ACCOUNT_ADD") {
          accountDeleted = false;
        }
        return;
      }

      if (event?.type === "FULL_SNAPSHOT") {
        holdings.clear();
        (Array.isArray(event?.payload?.holdings) ? event.payload.holdings : [])
          .map((item) => makeHoldingSnapshot(item))
          .forEach((item) => {
            if (item.id) holdings.set(item.id, item);
          });
        return;
      }

      if (event?.type === "PRICE_SNAPSHOT") {
        updateLatestPriceBook(priceBook, event?.payload || {});
        if (event?.payload?.fx && typeof event.payload.fx === "object") {
          latestFx = cloneValue(event.payload.fx);
        }
      }
    });

    let inflow = directInflow;
    let outflow = directOutflow;
    let estimatedFlowCount = 0;
    let unresolvedFlowCount = 0;
    pendingTransitions.forEach((transition) => {
      const flow = summarizeTransitionFlow(transition.before, transition.after, scope, priceBook, latestFx, displayCurrencyCode);
      inflow += flow.inflow;
      outflow += flow.outflow;
      if (flow.estimated) estimatedFlowCount += 1;
      if (flow.unresolved) unresolvedFlowCount += 1;
    });
    inflow += carriedInflow;
    outflow += carriedOutflow;

    let marketValue = Number.isFinite(forcedMarketValue) ? forcedMarketValue : 0;
    let scopeHoldingCount = 0;
    let valuedHoldingCount = 0;
    let estimatedValueCount = 0;
    let missingValueCount = 0;

    if (!accountDeleted && !Number.isFinite(forcedMarketValue)) {
      [...holdings.values()].forEach((holding) => {
        if (!holdingMatchesScope(holding, scope)) return;
        scopeHoldingCount += 1;
        const valuation = valueHolding(holding, priceBook, latestFx, displayCurrencyCode);
        if (!Number.isFinite(valuation.value)) {
          missingValueCount += 1;
          return;
        }
        valuedHoldingCount += 1;
        if (valuation.estimated) estimatedValueCount += 1;
        marketValue += valuation.value;
      });
    }

    const hasMarketValue =
      Number.isFinite(forcedMarketValue) ||
      accountDeleted ||
      valuedHoldingCount > 0 ||
      (pendingTransitions.length > 0 && scopeHoldingCount === 0 && (inflow > 0 || outflow > 0));

    if (hasMarketValue) {
      carriedInflow = 0;
      carriedOutflow = 0;
    } else {
      carriedInflow = inflow;
      carriedOutflow = outflow;
    }

    const point = {
      date,
      marketValue,
      inflow,
      outflow,
      estimatedFlowCount,
      unresolvedFlowCount,
      estimatedValueCount,
      missingValueCount,
      hasMarketValue,
      usedFallbackValue: estimatedValueCount > 0,
      usedFallbackFlow: estimatedFlowCount > 0,
      fx: cloneValue(latestFx),
    };

    timeline.push(point);
    lastKnownValue = point.hasMarketValue ? point.marketValue : lastKnownValue;
  });

  const usableTimeline = timeline.filter((point) => point.hasMarketValue);
  const previousPoint = [...usableTimeline].reverse().find((point) => point.date < startDate) || null;
  const inRangePoints = usableTimeline.filter((point) => point.date >= startDate && point.date <= endDate);

  if (inRangePoints.length === 0) {
    return {
      ok: false,
      reason: "所选区间里还没有可用于绘制收益率曲线的历史价格记录",
      availableStartDate: usableTimeline[0]?.date || null,
      availableEndDate: usableTimeline[usableTimeline.length - 1]?.date || null,
    };
  }

  let nav = 1;
  let previousValue = previousPoint?.marketValue ?? null;
  const points = inRangePoints.map((point, index) => {
    let dailyReturn = null;
    if (Number.isFinite(previousValue)) {
      const denominator = previousValue + point.inflow;
      const numerator = point.marketValue + point.outflow;
      if (denominator > 0 && numerator >= 0) {
        dailyReturn = numerator / denominator - 1;
      }
    }

    if (Number.isFinite(dailyReturn) && dailyReturn > -1) {
      nav *= 1 + dailyReturn;
    } else if (index === 0) {
      nav = 1;
    }

    previousValue = point.marketValue;

    return {
      ...point,
      dailyReturn,
      nav,
      cumulativeReturn: nav - 1,
    };
  });

  const startPoint = previousPoint || points[0];
  const endPoint = points[points.length - 1];
  const totalInflow = points.reduce((sum, point) => sum + point.inflow, 0);
  const totalOutflow = points.reduce((sum, point) => sum + point.outflow, 0);
  const estimatedFlowCount = points.reduce((sum, point) => sum + point.estimatedFlowCount, 0);
  const unresolvedFlowCount = points.reduce((sum, point) => sum + point.unresolvedFlowCount, 0);
  const estimatedValueCount = points.reduce((sum, point) => sum + point.estimatedValueCount, 0);
  const missingValueCount = points.reduce((sum, point) => sum + point.missingValueCount, 0);
  const totalReturn = points[points.length - 1]?.cumulativeReturn ?? 0;
  const dayCount = Math.max(1, Math.round((toTime(`${endPoint.date}T00:00:00`) - toTime(`${startPoint.date}T00:00:00`)) / (24 * 60 * 60 * 1000)));

  const xirrCashflows = [];
  if (Number.isFinite(startPoint?.marketValue) && startPoint.marketValue > 0) {
    xirrCashflows.push({ date: startPoint.date, amount: -startPoint.marketValue });
  }
  points.forEach((point) => {
    const amount = point.outflow - point.inflow;
    if (Number.isFinite(amount) && Math.abs(amount) > 1e-8) {
      xirrCashflows.push({ date: point.date, amount });
    }
  });
  if (Number.isFinite(endPoint?.marketValue)) {
    xirrCashflows.push({ date: endPoint.date, amount: endPoint.marketValue });
  }

  const xirr =
    startPoint?.date &&
    endPoint?.date &&
    endPoint.date > startPoint.date &&
    xirrCashflows.length >= 2
      ? computeXirr(xirrCashflows)
      : null;
  const annualizedTwr = annualizeReturn(totalReturn, dayCount);
  const notes = [];
  if (points.length <= 1) {
    notes.push("所选区间内只有 1 个观测点，曲线和年化收益率的参考意义有限。");
  }
  if (estimatedFlowCount > 0) {
    notes.push("部分现金流由历史持仓变化和当日/最近价格快照估算得出。");
  }
  if (estimatedValueCount > 0) {
    notes.push("部分市值使用手动价格或成本价回退。");
  }
  if (missingValueCount > 0 || unresolvedFlowCount > 0) {
    notes.push("部分历史记录缺少完整价格，结果可能偏保守。");
  }
  if (accountValueSnapshotCount > 0) {
    notes.push("部分历史使用账户总账回填，只支持整个组合口径，不能拆分到大类、分组或单个资产。");
  }

  return {
    ok: true,
    scope: cloneValue(scope),
    rangeStart: startDate,
    rangeEnd: endDate,
    effectiveStartDate: startPoint?.date || points[0]?.date || null,
    effectiveEndDate: endPoint?.date || null,
    displayCurrencyCode: normalizeCurrencyCode(displayCurrencyCode) || "CNY",
    points,
    summary: {
      startValue: Number.isFinite(startPoint?.marketValue) ? startPoint.marketValue : null,
      endValue: Number.isFinite(endPoint?.marketValue) ? endPoint.marketValue : null,
      totalInflow,
      totalOutflow,
      netCashFlow: totalInflow - totalOutflow,
      totalReturn,
      annualizedTwr,
      xirr,
      pointCount: points.length,
      estimatedFlowCount,
      estimatedValueCount,
      unresolvedFlowCount,
      missingValueCount,
      accountValueSnapshotCount,
      accountCashFlowCount,
    },
    notes,
    availableStartDate: usableTimeline[0]?.date || null,
    availableEndDate: usableTimeline[usableTimeline.length - 1]?.date || null,
  };
}
