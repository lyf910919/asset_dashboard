const JSONP_TIMEOUT_MS = 8000;
const FX_TIMEOUT_MS = 5000;
const OVERSEAS_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const SUPPORTED_CURRENCY_CODES = ["USD", "CNY", "HKD", "EUR", "GBP", "JPY", "AUD", "CAD", "SGD"];

const pingzhongCache = new Map();
let overseasFundListCache = null;
let overseasFundListExpiresAt = 0;
let estimateChain = Promise.resolve();
let pingzhongChain = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function formatDateYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getOverseasFundDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  return {
    startDate: formatDateYmd(start),
    endDate: formatDateYmd(end),
  };
}

function parseFloatSafe(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFundCode(code) {
  return /^[0-9]{6}$/.test(String(code || "").trim());
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

function cleanupGlobal(key) {
  try {
    delete window[key];
  } catch {
    window[key] = undefined;
  }
}

function loadScript(src, { timeoutMs = JSONP_TIMEOUT_MS, charset = null } = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeoutId = setTimeout(() => {
      script.remove();
      reject(new Error("脚本加载超时"));
    }, timeoutMs);

    script.async = true;
    if (charset) {
      script.charset = charset;
    }
    script.src = src;
    script.onload = () => {
      clearTimeout(timeoutId);
      resolve();
      script.remove();
    };
    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("脚本加载失败"));
      script.remove();
    };

    document.head.appendChild(script);
  });
}

function loadJsonp(url, callbackParam = "callback", { timeoutMs = JSONP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `_qdii_jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeoutId = setTimeout(() => {
      cleanupGlobal(callbackName);
      script.remove();
      reject(new Error("JSONP 请求超时"));
    }, timeoutMs);

    window[callbackName] = (payload) => {
      clearTimeout(timeoutId);
      cleanupGlobal(callbackName);
      script.remove();
      resolve(payload);
    };

    script.async = true;
    script.src = url.includes("?") ? `${url}&${callbackParam}=${callbackName}` : `${url}?${callbackParam}=${callbackName}`;
    script.onerror = () => {
      clearTimeout(timeoutId);
      cleanupGlobal(callbackName);
      script.remove();
      reject(new Error("JSONP 脚本加载失败"));
    };

    document.head.appendChild(script);
  });
}

function enqueueSerial(kind, task) {
  if (kind === "estimate") {
    const next = estimateChain.catch(() => {}).then(task);
    estimateChain = next.catch(() => {});
    return next;
  }

  const next = pingzhongChain.catch(() => {}).then(task);
  pingzhongChain = next.catch(() => {});
  return next;
}

function isLikelyExchangeFundCode(code) {
  return /^(5\d{5}|15\d{4}|18\d{4})$/.test(String(code || "").trim());
}

function isSupportedQuoteSource(value) {
  return ["ESTIMATE", "EXCHANGE", "NAV", "OVERSEAS"].includes(String(value || "").trim().toUpperCase());
}

function getSourceOrder(preferredSource, code) {
  const source = String(preferredSource || "").trim().toUpperCase();
  const exchangeFund = isLikelyExchangeFundCode(code);

  switch (source) {
    case "NAV":
      return ["NAV", "OVERSEAS", "ESTIMATE", "EXCHANGE"];
    case "OVERSEAS":
      return ["OVERSEAS", "NAV", "ESTIMATE", "EXCHANGE"];
    case "EXCHANGE":
      return ["EXCHANGE", "ESTIMATE", "NAV", "OVERSEAS"];
    case "ESTIMATE":
      return exchangeFund ? ["EXCHANGE", "ESTIMATE", "NAV", "OVERSEAS"] : ["ESTIMATE", "NAV", "OVERSEAS", "EXCHANGE"];
    default:
      return exchangeFund ? ["EXCHANGE", "ESTIMATE", "NAV", "OVERSEAS"] : ["ESTIMATE", "NAV", "OVERSEAS", "EXCHANGE"];
  }
}

async function fetchEstimateJsonp(code) {
  return enqueueSerial("estimate", () =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeoutId = setTimeout(() => {
        cleanupGlobal("jsonpgz");
        script.remove();
        reject(new Error("估值请求超时"));
      }, JSONP_TIMEOUT_MS);

      window.jsonpgz = (payload) => {
        clearTimeout(timeoutId);
        cleanupGlobal("jsonpgz");
        script.remove();
        resolve(payload || null);
      };

      script.async = true;
      script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
      script.onerror = () => {
        clearTimeout(timeoutId);
        cleanupGlobal("jsonpgz");
        script.remove();
        reject(new Error("估值脚本加载失败"));
      };
      document.head.appendChild(script);
    }),
  );
}

async function fetchNavJsonp(code) {
  const payload = await loadJsonp(
    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1&startDate=&endDate=`,
    "callback",
  );
  const item = payload?.Data?.LSJZList?.[0] || null;
  if (!item) return null;

  return {
    nav: parseFloatSafe(item.DWJZ),
    navDate: item.FSRQ || null,
    navAcc: parseFloatSafe(item.LJJZ),
    navChangePct: parseFloatSafe(item.JZZZL),
  };
}

async function fetchOverseasFundListJsonp() {
  const now = Date.now();
  if (Array.isArray(overseasFundListCache) && now < overseasFundListExpiresAt) {
    return overseasFundListCache;
  }

  const { startDate, endDate } = getOverseasFundDateRange();
  const payload = await loadJsonp(
    `https://overseas.1234567.com.cn/overseasapi/OpenApiHander.ashx?api=HKFDApi&m=MethodFundList&action=1&pageindex=0&pagesize=5000&dy=1&date1=${encodeURIComponent(startDate)}&date2=${encodeURIComponent(endDate)}&sortfield=Y&sorttype=-1&isbuy=0`,
    "callback",
  );
  const items = Array.isArray(payload?.Data) ? payload.Data : [];
  if (String(payload?.Code || "") !== "1" && items.length === 0) {
    throw new Error(String(payload?.Message || "海外基金列表获取失败"));
  }

  overseasFundListCache = items;
  overseasFundListExpiresAt = now + OVERSEAS_LIST_CACHE_TTL_MS;
  return items;
}

async function fetchOverseasFundItem(code) {
  const items = await fetchOverseasFundListJsonp();
  return items.find((item) => String(item?.FCODE || "").trim() === code) || null;
}

function parseTencentExchangeQuote(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const fields = text.split("~");
  if (fields.length < 33) return null;

  const name = String(fields[1] || "").trim() || null;
  const price = parseFloatSafe(fields[3]);
  const prevClose = parseFloatSafe(fields[4]);
  const quoteTimeRaw = String(fields[30] || "").trim();
  const changeAmount = parseFloatSafe(fields[31]);
  const changePct = parseFloatSafe(fields[32]);
  if (!Number.isFinite(price) || price <= 0) return null;

  const quoteTime =
    quoteTimeRaw && quoteTimeRaw.length >= 14
      ? `${quoteTimeRaw.slice(0, 4)}-${quoteTimeRaw.slice(4, 6)}-${quoteTimeRaw.slice(6, 8)} ${quoteTimeRaw.slice(8, 10)}:${quoteTimeRaw.slice(10, 12)}:${quoteTimeRaw.slice(12, 14)}`
      : null;

  return {
    name,
    price,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    changeAmount: Number.isFinite(changeAmount) ? changeAmount : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    quoteTime,
  };
}

async function fetchExchangeQuote(code) {
  const markets = code.startsWith("5") ? ["sh", "sz"] : ["sz", "sh"];
  const errors = [];

  for (const market of markets) {
    try {
      const variableName = `v_${market}${code}`;
      cleanupGlobal(variableName);
      await loadScript(`https://qt.gtimg.cn/q=${market}${code}`, {
        charset: "gb18030",
        timeoutMs: JSONP_TIMEOUT_MS,
      });
      const parsed = parseTencentExchangeQuote(window[variableName]);
      cleanupGlobal(variableName);
      if (parsed) return parsed;
    } catch (error) {
      errors.push(`${market}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`场内行情接口异常: ${errors.join("；")}`);
  }
  return null;
}

function parsePingzhongTrend(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const latest = [...list]
    .reverse()
    .find((item) => Number.isFinite(parseFloatSafe(item?.y)) && Number.isFinite(Number(item?.x)));
  if (!latest) return null;

  const date = new Date(Number(latest.x));
  return {
    nav: parseFloatSafe(latest.y),
    navDate: Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10),
    navChangePct: parseFloatSafe(latest.equityReturn),
  };
}

function parseAccumulatedWorth(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const latest = [...list].reverse().find((item) => Array.isArray(item) && Number.isFinite(parseFloatSafe(item[1])));
  return latest ? parseFloatSafe(latest[1]) : null;
}

function readPingzhongSnapshotFromWindow(code) {
  const name = typeof window.fS_name === "string" ? window.fS_name.trim() : "";
  const resolvedCode = typeof window.fS_code === "string" ? window.fS_code.trim() : "";
  const netWorth = parsePingzhongTrend(window.Data_netWorthTrend);
  const navAcc = parseAccumulatedWorth(window.Data_ACWorthTrend);

  if (resolvedCode && resolvedCode !== code) {
    throw new Error("基金脚本返回代码不匹配");
  }

  if (!name && !netWorth) {
    return null;
  }

  return {
    name: name || null,
    nav: netWorth?.nav ?? null,
    navDate: netWorth?.navDate ?? null,
    navAcc,
    navChangePct: netWorth?.navChangePct ?? null,
  };
}

async function fetchPingzhongSnapshot(code) {
  if (pingzhongCache.has(code)) {
    return pingzhongCache.get(code);
  }

  const snapshot = await enqueueSerial("pingzhong", async () => {
    await loadScript(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
    const parsed = readPingzhongSnapshotFromWindow(code);
    cleanupGlobal("fS_name");
    cleanupGlobal("fS_code");
    cleanupGlobal("Data_netWorthTrend");
    cleanupGlobal("Data_ACWorthTrend");
    return parsed;
  });

  pingzhongCache.set(code, snapshot);
  return snapshot;
}

function buildSnapshotFromEstimate(code, payload) {
  const price = parseFloatSafe(payload?.gsz);
  if (!Number.isFinite(price)) return null;

  const name = String(payload?.name || "").trim();
  const resolvedName = name || code;
  const currency = inferCurrencyCodeFromText(resolvedName) || "CNY";

  return {
    code,
    name: resolvedName,
    currency,
    currencyLabel: null,
    source: "ESTIMATE",
    sourceLabel: "盘中估值",
    price,
    estimateNav: price,
    estimateDate: String(payload?.gztime || "").trim() || null,
    estimateChangePct: parseFloatSafe(payload?.gszzl),
    nav: parseFloatSafe(payload?.dwjz),
    navDate: String(payload?.jzrq || "").trim() || null,
    navAcc: null,
    navChangePct: null,
    fetchedAt: nowIso(),
  };
}

function isMirrorEstimatePayload(payload, navSnapshot = null) {
  const estimate = parseFloatSafe(payload?.gsz);
  const estimateChangePct = parseFloatSafe(payload?.gszzl);
  const payloadNav = parseFloatSafe(payload?.dwjz);
  const resolvedNav = parseFloatSafe(navSnapshot?.nav) ?? payloadNav;

  if (!Number.isFinite(estimate) || !Number.isFinite(resolvedNav)) return false;
  if (Math.abs(estimate - resolvedNav) > 1e-8) return false;
  return !Number.isFinite(estimateChangePct) || Math.abs(estimateChangePct) < 1e-8;
}

function buildSnapshotFromNav(code, nav, name) {
  const price = parseFloatSafe(nav?.nav);
  if (!Number.isFinite(price)) return null;
  const resolvedName = String(name || code).trim() || code;
  const currency = inferCurrencyCodeFromText(resolvedName) || "CNY";

  return {
    code,
    name: resolvedName,
    currency,
    currencyLabel: null,
    source: "NAV",
    sourceLabel: "最新净值",
    price,
    estimateNav: null,
    estimateDate: null,
    estimateChangePct: null,
    nav: price,
    navDate: String(nav?.navDate || "").trim() || null,
    navAcc: parseFloatSafe(nav?.navAcc),
    navChangePct: parseFloatSafe(nav?.navChangePct),
    fetchedAt: nowIso(),
  };
}

function buildSnapshotFromExchange(code, exchange, { estimatePayload = null, nav = null, name = null } = {}) {
  const price = parseFloatSafe(exchange?.price);
  if (!Number.isFinite(price)) return null;

  const resolvedName = String(exchange?.name || name || code).trim() || code;
  const currency = inferCurrencyCodeFromText(resolvedName) || "CNY";

  return {
    code,
    name: resolvedName,
    currency,
    currencyLabel: null,
    source: "EXCHANGE",
    sourceLabel: "场内最新价",
    price,
    estimateNav: parseFloatSafe(estimatePayload?.gsz),
    estimateDate: String(estimatePayload?.gztime || exchange?.quoteTime || "").trim() || null,
    estimateChangePct: parseFloatSafe(estimatePayload?.gszzl) ?? parseFloatSafe(exchange?.changePct),
    nav: parseFloatSafe(nav?.nav) ?? parseFloatSafe(estimatePayload?.dwjz),
    navDate: String(nav?.navDate || estimatePayload?.jzrq || exchange?.quoteTime || "").trim() || null,
    navAcc: parseFloatSafe(nav?.navAcc),
    navChangePct: parseFloatSafe(nav?.navChangePct),
    fetchedAt: nowIso(),
  };
}

function buildSnapshotFromOverseas(code, item, fallbackName = null) {
  const price = parseFloatSafe(item?.NAV);
  if (!Number.isFinite(price)) return null;

  const resolvedName = String(item?.SHORTNAME || item?.FULLNAME || fallbackName || code).trim() || code;
  const currencyLabel = String(item?.CURRENCY || "").trim() || null;
  const currency = inferCurrencyCodeFromText(currencyLabel) || inferCurrencyCodeFromText(resolvedName) || "CNY";

  return {
    code,
    name: resolvedName,
    currency,
    currencyLabel,
    source: "OVERSEAS",
    sourceLabel: "海外基金净值",
    price,
    estimateNav: null,
    estimateDate: null,
    estimateChangePct: null,
    nav: price,
    navDate: String(item?.JZRQ || "").trim() || null,
    navAcc: null,
    navChangePct: parseFloatSafe(item?.NAVCHGRT),
    fetchedAt: nowIso(),
  };
}

async function fetchSingleFundSnapshot(code, { preferredSource = "ESTIMATE", knownName = null } = {}) {
  if (!isFundCode(code)) {
    throw new Error("基金代码必须是 6 位数字");
  }

  const sourceOrder = getSourceOrder(isSupportedQuoteSource(preferredSource) ? preferredSource : null, code);
  const cachedName = String(knownName || "").trim() || null;
  const errors = [];
  let estimatePayload = null;
  let exchange = null;
  let nav = null;
  let pingzhong = null;
  let overseas = undefined;

  async function loadEstimate() {
    if (estimatePayload) {
      return buildSnapshotFromEstimate(code, estimatePayload);
    }
    try {
      estimatePayload = await fetchEstimateJsonp(code);
      if (isMirrorEstimatePayload(estimatePayload, nav)) {
        await loadNav();
        if (Number.isFinite(parseFloatSafe(nav?.nav))) {
          const navSnapshot = buildSnapshotFromNav(
            code,
            nav,
            cachedName || pingzhong?.name || String(estimatePayload?.name || "").trim() || code,
          );
          if (navSnapshot) {
            return navSnapshot;
          }
        }
      }
      const estimateSnapshot = buildSnapshotFromEstimate(code, estimatePayload);
      if (estimateSnapshot) {
        if (cachedName) {
          estimateSnapshot.name = cachedName;
        }
        return estimateSnapshot;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return null;
  }

  async function loadExchange() {
    if (!isLikelyExchangeFundCode(code)) return null;
    try {
      exchange = await fetchExchangeQuote(code);
      if (exchange) {
        return buildSnapshotFromExchange(code, exchange, {
          estimatePayload,
          nav,
          name: cachedName || exchange?.name || null,
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return null;
  }

  async function loadNav() {
    if (!nav) {
      try {
        nav = await fetchNavJsonp(code);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const needsName = !cachedName;
    const needsPingzhongFallback = !Number.isFinite(parseFloatSafe(nav?.nav));
    if ((needsName || needsPingzhongFallback) && !pingzhong) {
      try {
        pingzhong = await fetchPingzhongSnapshot(code);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const resolvedNav = Number.isFinite(parseFloatSafe(nav?.nav)) ? nav : pingzhong;
    const resolvedName = cachedName || pingzhong?.name || code;
    return buildSnapshotFromNav(code, resolvedNav, resolvedName);
  }

  async function loadOverseas() {
    if (overseas === undefined) {
      try {
        overseas = await fetchOverseasFundItem(code);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        overseas = null;
      }
    }

    return buildSnapshotFromOverseas(code, overseas, cachedName);
  }

  for (const candidate of sourceOrder) {
    if (candidate === "EXCHANGE") {
      const exchangeSnapshot = await loadExchange();
      if (exchangeSnapshot) return exchangeSnapshot;
      continue;
    }

    if (candidate === "ESTIMATE") {
      const estimateSnapshot = await loadEstimate();
      if (estimateSnapshot) return estimateSnapshot;
      continue;
    }

    if (candidate === "NAV") {
      const navSnapshot = await loadNav();
      if (navSnapshot) return navSnapshot;
      continue;
    }

    if (candidate === "OVERSEAS") {
      const overseasSnapshot = await loadOverseas();
      if (overseasSnapshot) return overseasSnapshot;
    }
  }

  throw new Error(errors.filter(Boolean).join("；") || "未获取到有效基金数据");
}

export async function fetchFundSnapshots(codes, { preferredSources = {}, knownNames = {} } = {}) {
  const uniqueCodes = [...new Set((Array.isArray(codes) ? codes : []).map((item) => String(item || "").trim()))].filter(Boolean);

  const results = await Promise.allSettled(
    uniqueCodes.map((code) =>
      fetchSingleFundSnapshot(code, {
        preferredSource: preferredSources?.[code],
        knownName: knownNames?.[code],
      }),
    ),
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return {
        code: uniqueCodes[index],
        ok: true,
        data: result.value,
      };
    }

    return {
      code: uniqueCodes[index],
      ok: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FX_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeFrankfurterPayload(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("汇率接口返回为空");
  }

  const rates = { USD: 1 };
  let latestDate = null;

  payload.forEach((item) => {
    const quote = normalizeCurrencyCode(item?.quote);
    const rate = parseFloatSafe(item?.rate);
    if (!quote || !Number.isFinite(rate) || rate <= 0) return;
    rates[quote] = rate;
    if (item?.date && (!latestDate || String(item.date) > latestDate)) {
      latestDate = String(item.date);
    }
  });

  if (!Number.isFinite(rates.CNY) || rates.CNY <= 0) {
    throw new Error("缺少 USD/CNY 汇率");
  }

  return {
    base: "USD",
    provider: "ECB",
    date: latestDate,
    fetchedAt: nowIso(),
    stale: false,
    rates,
  };
}

function normalizeErApiPayload(payload) {
  const rates = { USD: 1 };
  Object.entries(payload?.rates || {}).forEach(([currency, rate]) => {
    const normalizedCurrency = normalizeCurrencyCode(currency);
    const normalizedRate = parseFloatSafe(rate);
    if (!normalizedCurrency || !Number.isFinite(normalizedRate) || normalizedRate <= 0) return;
    rates[normalizedCurrency] = normalizedRate;
  });

  if (!Number.isFinite(rates.CNY) || rates.CNY <= 0) {
    throw new Error("缺少 USD/CNY 汇率");
  }

  return {
    base: "USD",
    provider: "open.er-api.com",
    date: String(payload?.time_last_update_utc || "").trim() || null,
    fetchedAt: nowIso(),
    stale: false,
    rates,
  };
}

function normalizeJsdelivrPayload(payload) {
  const usdRates = payload?.usd || payload?.rates || {};
  const rates = { USD: 1 };

  Object.entries(usdRates || {}).forEach(([currency, rate]) => {
    const normalizedCurrency = normalizeCurrencyCode(currency);
    const normalizedRate = parseFloatSafe(rate);
    if (!normalizedCurrency || !Number.isFinite(normalizedRate) || normalizedRate <= 0) return;
    rates[normalizedCurrency] = normalizedRate;
  });

  if (!Number.isFinite(rates.CNY) || rates.CNY <= 0) {
    throw new Error("缺少 USD/CNY 汇率");
  }

  return {
    base: "USD",
    provider: "jsdelivr",
    date: null,
    fetchedAt: nowIso(),
    stale: false,
    rates,
  };
}

export async function fetchDirectFxSnapshot() {
  const providers = [
    async () => {
      const response = await fetchWithTimeout(
        "https://api.frankfurter.dev/v2/rates?base=USD&quotes=AUD,CAD,CNY,EUR,GBP,HKD,JPY,SGD&providers=ECB",
      );
      if (!response.ok) throw new Error(`汇率接口 HTTP ${response.status}`);
      return normalizeFrankfurterPayload(await response.json());
    },
    async () => {
      const response = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD");
      if (!response.ok) throw new Error(`备用汇率接口 HTTP ${response.status}`);
      return normalizeErApiPayload(await response.json());
    },
    async () => {
      const response = await fetchWithTimeout(
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
      );
      if (!response.ok) throw new Error(`CDN 汇率接口 HTTP ${response.status}`);
      return normalizeJsdelivrPayload(await response.json());
    },
  ];

  let lastError = null;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("汇率获取失败");
}
