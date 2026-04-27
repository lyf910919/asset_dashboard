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

console.log("performance baseline regression: ok");
