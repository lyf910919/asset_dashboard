import assert from "node:assert/strict";
import {
  chooseLatestNavSnapshot,
  getQuoteSourceOrder,
  isLikelyExchangeFundCode,
  normalizeSinaEstimateResponse,
} from "./lib/market.js";

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

assert.deepEqual(
  normalizeSinaEstimateResponse("005827", {
    result: {
      data: {
        worth: "1.5145",
        worth_date: "20260720",
        networth: [
          {
            symbol: "005827",
            pre_nav: "1.5483",
            growthrate: "0.022317596566524",
            pre_date: "2026-07-21",
            min_time: "16:04:00",
          },
        ],
      },
    },
  }),
  {
    name: "005827",
    gsz: 1.5483,
    gszzl: 2.2317596566524,
    dwjz: "1.5145",
    jzrq: "2026-07-20",
    gztime: "2026-07-21 16:04:00",
    sourceLabel: "新浪盘中估值",
  },
);
assert.equal(
  normalizeSinaEstimateResponse("000001", {
    result: { data: { networth: [{ symbol: "005827", pre_nav: "1.5483" }] } },
  }),
  null,
);

console.log("market source order regression: ok");
