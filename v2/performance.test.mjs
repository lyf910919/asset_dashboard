import assert from "node:assert/strict";
import { computePerformanceReport } from "./lib/performance.js";

const accountId = "account-a";
const holding = {
  id: "holding-1",
  name: "Test Fund",
  code: "510310",
  units: 100,
  assetClass: "stock",
  groupName: "Test",
  sortOrder: 1,
};

const events = [
  {
    type: "FULL_SNAPSHOT",
    accountId,
    date: "2026-04-26",
    timestamp: "2026-04-26T00:00:00.000Z",
    payload: { holdings: [holding], settings: {} },
  },
  {
    type: "PRICE_SNAPSHOT",
    accountId,
    date: "2026-04-26",
    timestamp: "2026-04-26T01:00:00.000Z",
    payload: {
      prices: {
        "510310": { price: 1, navDate: "2026-04-26", currency: "CNY" },
      },
      fx: { USD: 1, CNY: 7 },
    },
  },
  {
    type: "FULL_SNAPSHOT",
    accountId,
    date: "2026-04-27",
    timestamp: "2026-04-27T00:00:00.000Z",
    payload: { holdings: [holding], settings: {} },
  },
  {
    type: "PRICE_SNAPSHOT",
    accountId,
    date: "2026-04-27",
    timestamp: "2026-04-27T01:00:00.000Z",
    payload: {
      prices: {
        "510310": { price: 1.1, navDate: "2026-04-27", currency: "CNY" },
      },
      fx: { USD: 1, CNY: 7 },
    },
  },
];

const report = computePerformanceReport({
  accountId,
  events,
  rangeStart: "2026-04-26",
  rangeEnd: "2026-04-27",
  scope: { type: "portfolio" },
  displayCurrencyCode: "CNY",
});

assert.equal(report.ok, true);
assert.equal(report.summary.pointCount, 2);
assert.deepEqual(
  report.points.map((point) => point.date),
  ["2026-04-26", "2026-04-27"],
);

const backfillEvents = [
  {
    type: "ACCOUNT_VALUE_SNAPSHOT",
    accountId,
    date: "2024-12-29",
    timestamp: "2024-12-29T07:00:00.000Z",
    payload: { totalAsset: 1000, currency: "CNY", source: "youzhiyouxing-ledger" },
  },
  {
    type: "ACCOUNT_CASH_FLOW",
    accountId,
    date: "2025-01-05",
    timestamp: "2025-01-05T06:00:00.000Z",
    payload: { amount: 100, currency: "CNY", source: "youzhiyouxing-ledger" },
  },
  {
    type: "FULL_SNAPSHOT",
    accountId,
    date: "2025-01-05",
    timestamp: "2025-01-05T07:00:00.000Z",
    previewTag: "qdii-performance-preview-history-meta-v1",
    payload: {
      holdings: [{ ...holding, code: "", manualAmount: 999999, manualAmountCurrency: "CNY" }],
      settings: {},
    },
  },
  {
    type: "ACCOUNT_VALUE_SNAPSHOT",
    accountId,
    date: "2025-01-10",
    timestamp: "2025-01-10T07:00:00.000Z",
    payload: { totalAsset: 1210, currency: "CNY", source: "youzhiyouxing-ledger" },
  },
  {
    type: "FULL_SNAPSHOT",
    accountId,
    date: "2026-04-26",
    timestamp: "2026-04-26T00:00:00.000Z",
    payload: {
      holdings: [{ ...holding, code: "", manualAmount: 1331, manualAmountCurrency: "CNY" }],
      settings: {},
    },
  },
];

const backfillReport = computePerformanceReport({
  accountId,
  events: backfillEvents,
  rangeStart: "2024-12-29",
  rangeEnd: "2026-04-26",
  scope: { type: "portfolio" },
  displayCurrencyCode: "CNY",
});

assert.equal(backfillReport.ok, true);
assert.deepEqual(
  backfillReport.points.map((point) => point.date),
  ["2024-12-29", "2025-01-10", "2026-04-26"],
);
assert.equal(backfillReport.summary.accountValueSnapshotCount, 2);
assert.equal(backfillReport.summary.accountCashFlowCount, 1);
assert.ok(Math.abs(backfillReport.summary.totalReturn - 0.21) < 1e-10);

console.log("performance baseline regression: ok");
