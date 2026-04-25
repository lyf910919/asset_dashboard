import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { webcrypto } from "crypto";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const subtle = webcrypto.subtle;
const KDF_NAME = "PBKDF2";
const CIPHER_NAME = "AES-GCM";

function printUsage() {
  console.log(`用法:
  node tools/decrypt-backup.mjs --file <备份文件>
  node tools/decrypt-backup.mjs --file <备份文件> --passphrase <口令>
  node tools/decrypt-backup.mjs --file <备份文件> --passphrase <口令1> --passphrase <口令2>
  node tools/decrypt-backup.mjs --file <备份文件> --passphrase-file <候选口令文件>
  node tools/decrypt-backup.mjs --file <备份文件> --passphrase-file <候选口令文件> --output <输出JSON路径>

参数:
  --file             必填，v1/v2 导出的密文备份 JSON
  --passphrase       可重复传入多个候选口令
  --passphrase-file  每行一个候选口令
  --output           成功解密后将明文写入该文件
  --summary-only     仅输出摘要，不打印明文对象
  --help             查看帮助
`);
}

function parseArgs(argv) {
  const options = {
    passphrases: [],
    summaryOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--summary-only") {
      options.summaryOnly = true;
      continue;
    }
    if (arg === "--file") {
      options.file = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--passphrase") {
      options.passphrases.push(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--passphrase-file") {
      options.passphraseFile = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  return options;
}

function base64ToBytes(text) {
  return new Uint8Array(Buffer.from(String(text || ""), "base64"));
}

async function decryptBundle(bundle, passphrase) {
  const salt = base64ToBytes(bundle?.kdf?.salt);
  const iv = base64ToBytes(bundle?.enc?.iv);
  const ciphertext = base64ToBytes(bundle?.enc?.ciphertext);
  const iterations = Number.parseInt(String(bundle?.kdf?.iter || 200000), 10) || 200000;

  if (!salt.length || !iv.length || !ciphertext.length) {
    throw new Error("密文结构不完整");
  }

  const encoder = new TextEncoder();
  const material = await subtle.importKey("raw", encoder.encode(passphrase), KDF_NAME, false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    {
      name: KDF_NAME,
      hash: bundle?.kdf?.hash || "SHA-256",
      salt,
      iterations,
    },
    material,
    {
      name: CIPHER_NAME,
      length: 256,
    },
    false,
    ["decrypt"],
  );

  const plaintext = await subtle.decrypt({ name: CIPHER_NAME, iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function summarizeVault(vault) {
  const accounts = Array.isArray(vault?.accounts)
    ? vault.accounts
    : Array.isArray(vault?.holdings)
      ? [{ name: "默认账户", holdings: vault.holdings }]
      : [];

  const activeAccounts = accounts.filter((account) => !account?.deleted);
  const holdings = activeAccounts.flatMap((account) =>
    Array.isArray(account?.holdings) ? account.holdings.filter((holding) => !holding?.deleted) : [],
  );

  return {
    version: vault?.version ?? 1,
    accountCount: activeAccounts.length,
    holdingCount: holdings.length,
    accountNames: activeAccounts.map((account) => account?.name || "未命名账户"),
    sampleHoldings: holdings.slice(0, 10).map((holding) => ({
      name: holding?.name || "",
      code: holding?.code || "",
      units: holding?.units ?? null,
      groupName: holding?.groupName || "",
    })),
  };
}

async function loadPassphrases(options) {
  const set = new Set(options.passphrases.filter((item) => item !== ""));

  if (options.passphraseFile) {
    const text = await readFile(resolve(options.passphraseFile), "utf-8");
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => set.add(line));
  }

  if (set.size > 0) {
    return [...set];
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("请输入要尝试的口令: ");
    return answer ? [answer] : [];
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.file) {
    printUsage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const raw = await readFile(resolve(options.file), "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("备份文件不是合法 JSON");
  }

  const bundle = parsed?.bundle || parsed;
  if (!bundle?.kdf?.salt || !bundle?.enc?.iv || !bundle?.enc?.ciphertext) {
    throw new Error("文件中未找到合法的密文 bundle");
  }

  const candidates = await loadPassphrases(options);
  if (candidates.length === 0) {
    throw new Error("没有收到任何可尝试的口令");
  }

  for (const passphrase of candidates) {
    try {
      const vault = await decryptBundle(bundle, passphrase);
      const summary = summarizeVault(vault);

      console.log(`\n解密成功，口令为: ${passphrase}`);
      console.log(JSON.stringify(summary, null, 2));

      if (options.output) {
        const outputPath = resolve(options.output);
        await writeFile(outputPath, JSON.stringify(vault, null, 2), "utf-8");
        console.log(`\n明文已写入: ${outputPath}`);
      } else if (!options.summaryOnly) {
        console.log("\n明文内容:");
        console.log(JSON.stringify(vault, null, 2));
      }

      return;
    } catch {
      console.log(`口令错误: ${passphrase}`);
    }
  }

  throw new Error("所有候选口令都未能解密该备份");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
