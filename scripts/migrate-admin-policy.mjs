/* eslint-disable no-console */
/**
 * 不同身分管理政策——管理員屬性／指定功能模組退役遷移（政策修改書決議二／五）。
 *
 *   node --env-file=.env.local scripts/migrate-admin-policy.mjs
 *   node --env-file=.env.local scripts/migrate-admin-policy.mjs --apply
 *
 * 行為：
 *   1.（預設 dry-run）掃描當期 rosterAdmins，列出仍有 attribute／modules 欄位的條目，
 *      產出待辦清單（哪些「一般」管理員曾被逐模組指派——新制下已恆全權，無需再維護）。
 *   2. --apply：將上述條目的 attribute／modules 欄位移除（欄位退役；管理員恆全權）。
 *      不動 managedModules（那是非管理員身分的新欄位）。
 *   3. 匯出 CSV 備份至 backups/admin-policy-migration-<時間戳>.csv（含 --apply 前後皆可）。
 *
 * 註：Firestore 舊欄位不刪除也不影響正確性（讀取端已忽略）；本腳本僅做整潔化與稽核盤點。
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROSTER_ADMINS = "rosterAdmins";

function parseServiceAccount(raw) {
  let text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  if (!text.startsWith("{")) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8");
      if (decoded.trim().startsWith("{")) text = decoded;
    } catch {
      // 不是 base64，維持原文給 JSON.parse 報錯
    }
  }
  const parsed = JSON.parse(text);
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY 缺少 client_email 或 private_key");
  }
  return parsed;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const keyRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "";
  if (!keyRaw && getApps().length === 0) {
    throw new Error("需要 FIREBASE_SERVICE_ACCOUNT_KEY（Service Account JSON）");
  }
  if (getApps().length === 0) {
    const cred = keyRaw.trim().startsWith("{")
      ? cert(parseServiceAccount(keyRaw))
      : cert(parseServiceAccount(await (await import("node:fs/promises")).readFile(keyRaw, "utf8")));
    initializeApp({ credential: cred });
  } else {
    initializeApp();
  }
  const db = getFirestore();

  const snap = await db.collection(ROSTER_ADMINS).get();
  const rows = [];
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const attribute = typeof data.attribute === "string" ? data.attribute : "";
    const modules = Array.isArray(data.modules) ? data.modules : [];
    if (!attribute && modules.length === 0) continue;
    rows.push({
      docId: doc.id,
      uid: typeof data.uid === "string" ? data.uid : "",
      name: typeof data.name === "string" ? data.name : "",
      academicYear: typeof data.academicYear === "number" ? data.academicYear : "",
      semester: typeof data.semester === "number" ? data.semester : "",
      attribute,
      modules: modules.join("|"),
      status: typeof data.status === "string" ? data.status : "",
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const csvPath = join(dir, `admin-policy-migration-${stamp}.csv`);
  const header = "docId,uid,name,academicYear,semester,attribute,modules,status";
  const csv = [
    header,
    ...rows.map((row) =>
      [row.docId, row.uid, row.name, row.academicYear, row.semester, row.attribute, row.modules, row.status]
        .map(csvCell)
        .join(",")
    ),
  ].join("\n");
  writeFileSync(csvPath, csv, "utf8");

  console.log(`掃描 ${ROSTER_ADMINS}：共 ${snap.size} 筆條目，其中 ${rows.length} 筆仍有 attribute／modules 欄位。`);
  console.log(`CSV 備份：${csvPath}`);

  if (rows.length === 0) {
    console.log("無需遷移。");
    return;
  }

  for (const row of rows) {
    console.log(
      `  - ${row.docId}｜${row.name || "(無姓名)"}｜attribute=${row.attribute || "(無)"}｜modules=${row.modules || "(無)"}`
    );
  }

  if (!APPLY) {
    console.log("\n[dry-run] 未寫入。加 --apply 移除上述條目的 attribute／modules 欄位（管理員恆全權）。");
    return;
  }

  let updated = 0;
  for (const row of rows) {
    await db.collection(ROSTER_ADMINS).doc(row.docId).update({
      attribute: null,
      modules: null,
      updatedAt: Date.now(),
    });
    updated += 1;
  }
  console.log(`\n已套用：更新 ${updated} 筆條目（attribute／modules 設為 null）。`);
  console.log("注意：本腳本不改動其他集合；非管理員身分的 managedModules 指派請於 /admin/modules 設定。");
}

main().catch((error) => {
  console.error("遷移失敗：", error instanceof Error ? error.message : error);
  process.exit(1);
});
