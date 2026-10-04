const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * 版本號更新（僅供開發機手動執行：`npm run version:bump`，通常在 commit 前）。
 *
 * 為什麼 dev/build 不再執行本檔：
 * 版本號與日期以「已 commit 的 src/version.json」為唯一真相，各環境 build 直接讀它，
 * 於是本機與任何分支部署顯示完全相同。過去 build 前會重跑本檔，用「當地 git 歷史」
 * 重算版本號；CI（Vercel 等）多為 shallow clone、歷史不完整，算出來會偏小（例如 0.23），
 * 造成各站版本號不一致。
 *
 * 安全規則：算出的版本不得低於現有值（永不倒退）；git 不可用或歷史不完整時一律不寫入。
 */
const filePath = path.join(__dirname, "..", "src", "version.json");

/** "0.261" → 261；無法解析回 -1 */
function versionOrder(value) {
  const minor = parseInt(String(value).split(".")[1], 10);
  return Number.isNaN(minor) ? -1 : minor;
}

function readCurrent() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      version: typeof raw.version === "string" ? raw.version : "",
      date: typeof raw.date === "string" ? raw.date : "",
    };
  } catch {
    return { version: "", date: "" };
  }
}

const current = readCurrent();

try {
  const shallow = execSync("git rev-parse --is-shallow-repository", {
    encoding: "utf-8",
  }).trim();
  if (shallow === "true") {
    console.warn(
      `跳過版本更新：此 git 歷史不完整（shallow clone），保留 ${current.version || "（無）"}。` +
        "請改在完整歷史的開發機上執行 npm run version:bump。"
    );
    process.exit(0);
  }

  const count = execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim();
  const date = execSync('git log -1 --format=%cd --date=short', { encoding: "utf-8" }).trim();
  const version = `0.${parseInt(count) + 1}`;

  if (versionOrder(version) < versionOrder(current.version)) {
    console.warn(
      `跳過版本更新：算出的 ${version} 低於現有 ${current.version}（git 歷史可能不完整），保留 ${current.version}。`
    );
    process.exit(0);
  }

  fs.writeFileSync(filePath, JSON.stringify({ version, date }, null, 2));
  console.log(`Version: ${version}, Date: ${date}`);
} catch (e) {
  console.warn(
    `Git failed，未更新版本號，保留 ${current.version || "（無）"}：${e.message}`
  );
}
