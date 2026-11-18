import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";

const url = process.env.DASHBOARD_URL || "http://127.0.0.1:3001/";
const engine = process.env.DASHBOARD_WEBKIT === "1" ? webkit : chromium;
const browser = await engine.launch();
try {
  const page = await browser.newPage({ ...devices["iPhone 13"], serviceWorkers: "block" });
  await page.route("**/*", (route) =>
    route.request().url().startsWith(new URL(url).origin + "/") ? route.continue() : route.abort(),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const visible = (selector) => page.locator(selector).waitFor({ state: "visible" });
  const fill = async (selector, value) => {
    const input = page.locator(selector);
    await input.tap();
    assert.ok(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), selector);
    assert.equal(await page.evaluate(() => window.visualViewport.scale), 1, selector);
    await input.fill(value);
  };
  const noOverflow = async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  };

  await page.goto(url);
  await page.tap("#unlock-open-btn");
  await fill("#passphrase-input", "testpass123");
  await page.tap("#unlock-btn");
  await visible("#lock-btn:enabled");
  await noOverflow();

  await page.tap("#add-holding-quick-btn");
  await visible("#holding-modal");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("role")), "dialog");
  await fill("#holding-name-input", "移动端测试基金");
  await fill("#holding-units-input", "100");
  await fill("#holding-manual-price-input", "2");
  await page.tap("#holding-save-btn");
  await page.locator("#holding-modal").waitFor({ state: "hidden" });
  await page.tap("#tab-config-btn");
  const holding = page.locator(".config-item").filter({ hasText: "移动端测试基金" });
  await holding.locator(".edit-btn").tap();
  assert.equal(await page.inputValue("#holding-units-input"), "100");
  await fill("#holding-units-input", "125");
  await page.tap("#holding-save-btn");
  await holding.getByText(/份额 125/).waitFor();

  await page.tap("#tab-pie-btn");
  await visible("#allocation-pie");
  await page.tap("[data-target-scope=fund]");
  await page.locator(".is-fund-target").filter({ hasText: "移动端测试基金" }).waitFor();
  await noOverflow();
  await page.tap("#tab-performance-btn");
  await visible("#performance-chart");

  await page.locator(".app-nav").getByText("趋势交易").tap();
  await visible("#ovAssetBar select");
  await page.tap("[data-view=position-calc]");
  await fill("#planPrice", "2");
  await visible("#positionOutputs");
  await noOverflow();

  await page.locator(".app-nav").getByText("养老金").tap();
  await fill("#newMoney", "15000");
  assert.match(await page.textContent("#allocationHint"), /15,000/);
  await page.tap("[data-tab=settings]");
  await visible("#fundRows");
  await noOverflow();
  await page.reload();
  assert.equal(await page.inputValue("#newMoney"), "15000");
  assert.deepEqual(errors, []);
  console.log("mobile layout: add/edit holdings, allocation, performance, trend and pension passed");
} finally {
  await browser.close();
}
