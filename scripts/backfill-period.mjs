/* eslint-disable no-console */
// 舊名冊回填學年度／學期：node --env-file=.env.local scripts/backfill-period.mjs [--dry-run]
// 依各文件 createdAt 推算所屬學年度與學期（規則與 src/types/settings.ts 的 detectPeriod 一致）；
// createdAt 缺漏時以 settings/system 目前的學年度學期補上並列入報告。
// 本檔刻意維持純 JS（無法 import 專案 TS），修改推算規則時請同步更新 src/types/settings.ts。
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Buffer } from "node:buffer";

const DRY_RUN = process.argv.includes("--dry-run");
const COLLECTIONS = ["students", "parents", "staff", "admins"];
const BATCH_SIZE = 400;

function parseServiceAccount(raw) {
  let text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  if (!text.startsWith("{")) {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    if (decoded.trim().startsWith("{")) text = decoded;
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

function periodFromTimestamp(ts) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 9 ? year : year - 1;
  return {
    academicYear: startYear - 1911,
    semester: month >= 9 || month === 1 ? 1 : 2,
  };
}

function hasPeriod(data) {
  return (
    typeof data.academicYear === "number" &&
    Number.isFinite(data.academicYear) &&
    (data.semester === 1 || data.semester === 2)
  );
}

const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!rawKey) {
  console.error("缺少 FIREBASE_SERVICE_ACCOUNT_KEY（請用 node --env-file=.env.local 執行）");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(parseServiceAccount(rawKey)) });
}
const db = getFirestore();

const settingsSnap = await db.collection("settings").doc("system").get();
const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
const fallback = periodFromTimestamp(Date.now());
const currentPeriod = {
  academicYear:
    typeof settingsData.academicYear === "number" && settingsData.academicYear > 0
      ? settingsData.academicYear
      : fallback.academicYear,
  semester: settingsData.semester === 1 || settingsData.semester === 2 ? settingsData.semester : fallback.semester,
};

console.log(`${DRY_RUN ? "[試跑] " : ""}回填目標期間（createdAt 缺漏時使用）：${currentPeriod.academicYear} 學年度 第${currentPeriod.semester}學期`);

let totalUpdated = 0;
let totalSkipped = 0;
let totalFallback = 0;
const missingCreatedAt = [];

for (const name of COLLECTIONS) {
  const snap = await db.collection(name).get();
  const updates = [];
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (hasPeriod(data)) {
      skipped += 1;
      continue;
    }
    const createdAt = typeof data.createdAt === "number" && data.createdAt > 0 ? data.createdAt : null;
    const period = createdAt ? periodFromTimestamp(createdAt) : currentPeriod;
    if (!createdAt) {
      missingCreatedAt.push(`${name}/${doc.id}`);
      totalFallback += 1;
    }
    updates.push({ ref: doc.ref, data: period });
  }

  if (!DRY_RUN && updates.length > 0) {
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const chunk = updates.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const item of chunk) batch.update(item.ref, item.data);
      await batch.commit();
    }
  }

  totalUpdated += updates.length;
  totalSkipped += skipped;
  console.log(
    `${name}: 共 ${snap.size} 筆，${DRY_RUN ? "待回填" : "已回填"} ${updates.length} 筆，已具備標記 ${skipped} 筆`
  );
}

if (missingCreatedAt.length > 0) {
  console.log(`⚠ 以目前期間補上（無 createdAt）${missingCreatedAt.length} 筆：`);
  for (const id of missingCreatedAt.slice(0, 20)) console.log(`   - ${id}`);
  if (missingCreatedAt.length > 20) console.log(`   …其餘 ${missingCreatedAt.length - 20} 筆省略`);
}

console.log(
  `${DRY_RUN ? "[試跑完成] 預計回填" : "完成"} ${totalUpdated} 筆、跳過 ${totalSkipped} 筆` +
    `${totalFallback > 0 ? `，其中 ${totalFallback} 筆無 createdAt` : ""}`
);
