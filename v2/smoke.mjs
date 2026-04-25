import { chromium } from "playwright";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readIndexedDbState(page) {
  return page.evaluate(async () => {
    const DB_NAME = "qdii-vault-db";

    function requestToPromise(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("request failed"));
      });
    }

    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("open failed"));
    });

    const tx = db.transaction(["vault", "events", "daily_nav", "config"], "readonly");
    const vaultRecord = await requestToPromise(tx.objectStore("vault").get("current"));
    const eventRows = await requestToPromise(tx.objectStore("events").getAll());
    const dailyNavRows = await requestToPromise(tx.objectStore("daily_nav").getAll());
    const configRows = await requestToPromise(tx.objectStore("config").getAll());

    return {
      hasBundle: Boolean(vaultRecord?.bundle),
      eventCount: eventRows.length,
      dailyNavCount: dailyNavRows.length,
      configKeys: configRows.map((item) => item.key).sort(),
      latestEventTypes: eventRows.slice(-5).map((item) => item.type),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  console.log("[smoke] goto page");
  await page.goto("http://127.0.0.1:3001/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#unlock-open-btn", { timeout: 10000 });

  const title = await page.title();
  await page.click("#tab-config-btn");
  await page.waitForSelector("#import-btn", { state: "visible", timeout: 5000 });
  const lockedUi = await page.evaluate(() => {
    const importBtn = document.querySelector("#import-btn");
    const gistToken = document.querySelector("#gist-token-input");
    const styles = importBtn ? window.getComputedStyle(importBtn) : null;
    const tokenStyles = gistToken ? window.getComputedStyle(gistToken) : null;
    return {
      importDisabledAttr: importBtn?.hasAttribute("disabled") || false,
      importPointerEvents: styles?.pointerEvents || null,
      importOpacity: styles?.opacity || null,
      tokenPointerEvents: tokenStyles?.pointerEvents || null,
    };
  });
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.click("#import-btn");
  const fileChooser = await fileChooserPromise;
  const lockedImportClickWorked = Boolean(fileChooser);
  await page.click("#tab-view-btn");
  console.log("[smoke] open unlock modal");
  await page.click("#unlock-open-btn");
  await page.fill("#passphrase-input", "testpass123");
  console.log("[smoke] submit unlock");
  await page.click("#unlock-btn");

  await page.waitForFunction(() => {
    const text = document.querySelector("#vault-status")?.textContent || "";
    return text.includes("已解锁");
  }, { timeout: 10000 });

  await page.waitForFunction(() => {
    const modal = document.querySelector("#unlock-modal");
    return Boolean(modal?.hasAttribute("hidden"));
  }, { timeout: 5000 });

  console.log("[smoke] waiting first refresh window");
  await sleep(12000);

  const firstPass = {
    title,
    vaultStatus: await page.textContent("#vault-status"),
    priceStatus: await page.textContent("#status-text"),
    syncMeta: await page.textContent("#sync-meta"),
    lastRefresh: await page.textContent("#last-refresh"),
    totalAsset: await page.textContent("#total-asset"),
    totalCost: await page.textContent("#total-cost"),
    totalPnl: await page.textContent("#total-pnl"),
    storage: await readIndexedDbState(page),
  };

  console.log("[smoke] lock and unlock again");
  await page.click("#lock-btn");
  await page.click("#unlock-open-btn");
  await page.fill("#passphrase-input", "testpass123");
  await page.click("#unlock-btn");

  await page.waitForFunction(() => {
    const text = document.querySelector("#vault-status")?.textContent || "";
    return text.includes("已解锁");
  }, { timeout: 10000 });

  await sleep(2000);

  const today = new Date().toISOString().slice(0, 10);
  console.log("[smoke] run history replay");
  await page.click("#tab-config-btn");
  await page.waitForSelector("#history-replay-date-input", { state: "visible", timeout: 5000 });
  await page.fill("#history-replay-date-input", today);
  await page.click("#history-replay-btn");
  await page.waitForFunction(() => {
    const text = document.querySelector("#history-replay-output")?.textContent || "";
    return text.includes("基线日期：") || text.includes("还没有可用的全量基线快照");
  }, { timeout: 5000 });

  const secondPass = {
    vaultStatus: await page.textContent("#vault-status"),
    priceStatus: await page.textContent("#status-text"),
    replayText: await page.textContent("#history-replay-output"),
    storage: await readIndexedDbState(page),
  };

  console.log("[smoke] verify performance tab");
  await page.click("#tab-performance-btn");
  await page.waitForFunction(() => {
    const text = document.querySelector("#performance-status")?.textContent || "";
    return text.includes("收益率曲线已更新") || text.includes("暂无可用于绘制曲线");
  }, { timeout: 5000 });

  const performanceInitial = await page.evaluate(() => ({
    status: document.querySelector("#performance-status")?.textContent?.trim() || "",
    totalReturn: document.querySelector("#performance-total-return")?.textContent?.trim() || "",
    xirr: document.querySelector("#performance-xirr")?.textContent?.trim() || "",
    endValue: document.querySelector("#performance-end-value")?.textContent?.trim() || "",
    netFlow: document.querySelector("#performance-net-flow")?.textContent?.trim() || "",
    rangeMeta: document.querySelector("#performance-range-meta")?.textContent?.trim() || "",
    formulaMeta: document.querySelector("#performance-formula-meta")?.textContent?.trim() || "",
    scopeType: document.querySelector("#performance-scope-type")?.value || "",
    scopeOptionCount: document.querySelector("#performance-scope-target")?.options.length || 0,
  }));

  await page.selectOption("#performance-scope-type", "holding");
  await page.waitForTimeout(300);
  const performanceHolding = await page.evaluate(() => ({
    scopeType: document.querySelector("#performance-scope-type")?.value || "",
    scopeValue: document.querySelector("#performance-scope-target")?.value || "",
    scopeOptionCount: document.querySelector("#performance-scope-target")?.options.length || 0,
    firstScopeLabel: document.querySelector("#performance-scope-target option")?.textContent?.trim() || "",
  }));

  await page.click('[data-performance-preset="all"]');
  await page.waitForTimeout(300);
  const performanceAllRange = await page.evaluate(() => ({
    start: document.querySelector("#performance-start-date-input")?.value || "",
    end: document.querySelector("#performance-end-date-input")?.value || "",
    status: document.querySelector("#performance-status")?.textContent?.trim() || "",
    rangeMeta: document.querySelector("#performance-range-meta")?.textContent?.trim() || "",
  }));

  console.log("[smoke] verify backup guard and downloads");
  await page.click("#tab-config-btn");
  await page.fill("#gist-token-input", "");
  await page.click("#sync-btn");
  await page.waitForFunction(() => {
    const text = document.querySelector("#vault-status")?.textContent || "";
    return text.includes("GitHub Token");
  }, { timeout: 5000 });
  const missingTokenStatus = await page.textContent("#vault-status");

  const [encryptedBackupDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-btn"),
  ]);
  const [historyJsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-history-btn"),
  ]);
  const [dailyNavCsvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-daily-nav-btn"),
  ]);

  const configActions = {
    vaultStatusAfterMissingToken: missingTokenStatus,
    downloadNames: [
      encryptedBackupDownload.suggestedFilename(),
      historyJsonDownload.suggestedFilename(),
      dailyNavCsvDownload.suggestedFilename(),
    ],
  };

  const result = {
    ok: true,
    lockedUi,
    lockedImportClickWorked,
    firstPass,
    secondPass,
    performance: {
      initial: performanceInitial,
      holdingScope: performanceHolding,
      allRange: performanceAllRange,
    },
    configActions,
    pageErrors,
    consoleErrors,
  };

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
