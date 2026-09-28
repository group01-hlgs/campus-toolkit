/* eslint-disable no-console */
/**
 * 重置並種子化使用者資料。
 *
 *   node --env-file=.env.local scripts/reset-users-roster.mjs
 *
 * 流程：
 *   1.（預設）將使用者、名冊、舊集合匯出到 backups/<時間戳>/；加 --no-backup 跳過
 *   2. 刪除五個舊集合（students/parents/staff/admins/roster）與 passwordResetTokens
 *   3. 清空 users 與四張身分名冊
 *   4. 種入測試帳號 takan003（一檔 users 文件＋當期四張名冊各一筆）
 *
 *   node --env-file=.env.local scripts/reset-users-roster.mjs --no-backup
 *
 * 直接以 Admin SDK 連線 Firestore，不經過 HTTP，因此不提供對應 API。
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import bcrypt from "bcryptjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LEGACY_COLLECTIONS = ["students", "parents", "staff", "admins", "roster"];
const ROSTER_COLLECTIONS = ["rosterStudents", "rosterParents", "rosterStaff", "rosterAdmins"];
const AUX_COLLECTIONS = ["passwordResetTokens"];
const ALL_COLLECTIONS = ["users", ...ROSTER_COLLECTIONS, ...LEGACY_COLLECTIONS, ...AUX_COLLECTIONS];
const SKIP_BACKUP = process.argv.includes("--no-backup");

const SEED = {
  uid: "seed-takan003",
  email: "takan003@gms.hlgs.hlc.edu.tw",
  account: "takan003",
  password: "111zzzZZZ",
  name: "林測試",
};

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

function detectPeriod(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 9 ? year : year - 1;
  return { academicYear: startYear - 1911, semester: month >= 9 || month === 1 ? 1 : 2 };
}

async function readPeriod(db) {
  try {
    const snap = await db.collection("settings").doc("system").get();
    const raw = snap.exists ? snap.data() : undefined;
    const academicYear = Number(raw?.academicYear);
    const semester = Number(raw?.semester);
    if (Number.isFinite(academicYear) && academicYear > 0 && (semester === 1 || semester === 2)) {
      return { academicYear, semester };
    }
  } catch (error) {
    console.warn("讀取 settings/system 失敗，改用日期推算:", error.message);
  }
  return detectPeriod();
}

async function dumpCollection(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

async function deleteCollection(db, name) {
  // 以 450 筆一批刪除，避開 500 寫入上限
  let total = 0;
  for (;;) {
    const snap = await db.collection(name).limit(450).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    total += snap.size;
    if (snap.size < 450) break;
  }
  return total;
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    console.error("缺少 FIREBASE_SERVICE_ACCOUNT_KEY（用 node --env-file=.env.local 執行）");
    process.exit(1);
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(parseServiceAccount(raw)) });
  const db = getFirestore(app);

  if (SKIP_BACKUP) {
    console.log("依 --no-backup 跳過備份");
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = join(process.cwd(), "backups", stamp);
    mkdirSync(backupDir, { recursive: true });

    console.log(`備份到 ${backupDir} ...`);
    for (const name of ALL_COLLECTIONS) {
      const docs = await dumpCollection(db, name);
      writeFileSync(join(backupDir, `${name}.json`), JSON.stringify(docs, null, 2), "utf8");
      console.log(`  ${name}: ${docs.length} 筆`);
    }
  }

  console.log("刪除舊集合與重設權杖...");
  for (const name of [...LEGACY_COLLECTIONS, ...AUX_COLLECTIONS]) {
    const removed = await deleteCollection(db, name);
    console.log(`  ${name}: 刪除 ${removed} 筆`);
  }

  console.log("清空使用者與身分名冊...");
  for (const name of ["users", ...ROSTER_COLLECTIONS]) {
    const removed = await deleteCollection(db, name);
    console.log(`  ${name}: 刪除 ${removed} 筆`);
  }

  const period = await readPeriod(db);
  console.log(`種子期間：${period.academicYear} 學年度 第${period.semester}學期`);

  const passwordHash = await bcrypt.hash(SEED.password, 12);
  const now = Date.now();
  const user = {
    email: SEED.email,
    account: SEED.account,
    passwordHash,
    name: SEED.name,
    status: "有效",
    loginRecords: [],
    lastLoginMethod: "",
    loginCount: 0,
    cssThemeId: "",
    installedThemes: "[]",
    lockedUntil: 0,
    lockIp: "",
    failedAttempts: 0,
    tokenVersion: 1,
    createdAt: now,
    twoFactor: "off",
  };
  await db.collection("users").doc(SEED.uid).set(user);

  const entryBase = (extra) => ({
    uid: SEED.uid,
    status: "有效",
    email: SEED.email,
    name: SEED.name,
    academicYear: period.academicYear,
    semester: period.semester,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });

  const rosterDocId = `${SEED.uid}_${period.academicYear}_${period.semester}`;
  const entries = [
    ["rosterStudents", entryBase({ studentId: "1110001", grade: "1", classCode: "101", className: "一年一班", seatNo: "01", rollNo: "01" })],
    ["rosterParents", entryBase({ studentEmail: SEED.email, studentId: "1110001", grade: "1", classCode: "101", className: "一年一班", seatNo: "01", rollNo: "01", relation: "父親" })],
    ["rosterStaff", entryBase({ attribute: "行政", unit: "教務處", title: "組長", classCode: "", className: "" })],
    ["rosterAdmins", entryBase({ attribute: "超級", modules: ["roster", "settings", "account", "activity"] })],
  ];
  for (const [name, data] of entries) {
    await db.collection(name).doc(rosterDocId).set(data);
    console.log(`  ${name}: 已寫入 ${rosterDocId}`);
  }

  console.log(`完成。測試帳號：${SEED.account} / ${SEED.password}`);
}

try {
  await main();
} catch (error) {
  console.error("失敗:", error.message);
  process.exitCode = 1;
}
