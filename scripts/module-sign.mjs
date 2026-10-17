/**
 * module-sign.mjs —— 模組套件 ed25519 簽章工具（市集文件 §4.6【E17】）
 *
 * 用法（Node 內建 node:crypto，零新依賴）：
 *   node scripts/module-sign.mjs keygen <名稱>          產生金鑰對（私鑰存 .module-signing/<名稱>.key，公鑰列印）
 *   node scripts/module-sign.mjs sign <zip> <私鑰檔>    對 zip 的 sha256 簽章，輸出 { sha256, signature, publicKey }
 *   node scripts/module-sign.mjs verify <zip> <公鑰(base64 SPKI)> <簽章(base64)>
 *
 * 流程（§4.6）：作者 keygen → 投稿時公鑰綁定市集 → 每次發佈 sign →
 * 市集存 signature+publicKey → 安裝端有簽章即驗證（無簽章按 sha256 流程放行）。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_DIR = path.join(ROOT, ".module-signing");

function fail(message) {
  console.error(`[module-sign] 錯誤：${message}`);
  process.exit(1);
}

function keygen(name) {
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) fail("名稱需為英數字／底線／連字號");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const keyPath = path.join(KEY_DIR, `${name}.key`);
  if (fs.existsSync(keyPath)) fail(`私鑰已存在：${keyPath}（如需換鑰請先移除）`);
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const pubBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  process.stdout.write(`[module-sign] 私鑰：${keyPath}（勿提交 git）\n`);
  process.stdout.write(`[module-sign] 公鑰（註冊市集用，base64 SPKI）：\n${pubBase64}\n`);
}

function sign(zipPath, keyPath) {
  if (!fs.existsSync(zipPath)) fail(`套件不存在：${zipPath}`);
  if (!fs.existsSync(keyPath)) fail(`私鑰不存在：${keyPath}`);
  const zip = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const signature = crypto.sign(null, Buffer.from(sha256, "hex"), privateKey).toString("base64");
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  process.stdout.write(`${JSON.stringify({ sha256, signature, publicKey }, null, 2)}\n`);
}

function verify(zipPath, publicKeyBase64, signatureBase64) {
  if (!fs.existsSync(zipPath)) fail(`套件不存在：${zipPath}`);
  const zip = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  const ok = crypto.verify(null, Buffer.from(sha256, "hex"), publicKey, Buffer.from(signatureBase64, "base64"));
  if (!ok) fail("簽章驗證失敗（來源不符）");
  process.stdout.write("[module-sign] 簽章驗證通過\n");
}

const [command, ...args] = process.argv.slice(2);
if (command === "keygen") keygen(args[0]);
else if (command === "sign") {
  if (args.length < 2) fail("用法：sign <zip> <私鑰檔>");
  sign(args[0], args[1]);
} else if (command === "verify") {
  if (args.length < 3) fail("用法：verify <zip> <公鑰 base64> <簽章 base64>");
  verify(args[0], args[1], args[2]);
} else {
  fail("用法：module-sign.mjs <keygen|sign|verify> …");
}
