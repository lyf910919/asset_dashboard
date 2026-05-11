import assert from "node:assert/strict";
import { chooseLatestNavSnapshot, getQuoteSourceOrder, isLikelyExchangeFundCode } from "./lib/market.js";

assert.equal(isLikelyExchangeFundCode("510300"), true);
assert.equal(isLikelyExchangeFundCode("159919"), true);
assert.equal(isLikelyExchangeFundCode("018738"), false);

assert.deepEqual(getQuoteSourceOrder("NAV", "510300").slice(0, 2), ["EXCHANGE", "NAV"]);
assert.deepEqual(getQuoteSourceOrder("NAV", "018738").slice(0, 2), ["NAV", "OVERSEAS"]);
assert.deepEqual(getQuoteSourceOrder("ESTIMATE", "510300").slice(0, 2), ["EXCHANGE", "ESTIMATE"]);

assert.deepEqual(
  chooseLatestNavSnapshot(
    { nav: 1.01, navDate: "2026-05-10" },
    { nav: 1.02, navDate: "2026-05-11" },
  ),
  { nav: 1.02, navDate: "2026-05-11" },
);
assert.deepEqual(
  chooseLatestNavSnapshot(
    { nav: 1.03, navDate: "2026-05-11" },
    { nav: 1.02, navDate: "2026-05-10" },
  ),
  { nav: 1.03, navDate: "2026-05-11" },
);

console.log("market source order regression: ok");
