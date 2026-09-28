/**
 * 一次性遷移：把學生／家長／教職員帳號文件上的名冊欄位（學號、班級、年級、職稱…）
 * 搬進身分名冊集合 `roster`（文件 id：`${uid}_${學年度}_${學期}`，期間取自 settings/system，
 * 欄位缺漏時依日期推算），並從帳號文件移除這些欄位、補上 active: true。
 * 四種身分都進名冊：管理員條目只有學年度學期標記、不含名冊欄位。
 *
 * 用法：
 *   node --env-file=.env.local scripts/migrate-roster-split.mjs --dry-run   # 只列出將進行的變更
 *   node --env-file=.env.local scripts/migrate-roster-split.mjs             # 執行
 *
 * 可重複執行：已存在的名冊條目不會被覆寫；已存在的 active 欄位不動。
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const DRY_RUN = process.argv.includes("--dry-run");

const ROSTER_COLLECTION = "roster";
const ROLES = {
  student: "students",
  parent: "parents",
  staff: "staff",
  admin: "admins",
};

/** 名冊欄位（會從帳號文件搬到 roster 條目） */
const ENTRY_FIELDS = {
  student: ["studentId", "grade", "className", "classNumber"],
  parent: ["studentName", "studentId", "className", "classNumber"],
  staff: ["className", "title", "attribute"],
  admin: [],
};

/** 與 src/lib/firebase-admin.ts 的 parseServiceAccount 同邏輯：支援外層引號與 base64 編碼的 JSON */
function parseServiceAccount(raw) {
  let text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  if (!text.startsWith("{")) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8");
      if (decoded.trim().startsWith("{")) text = decoded;
    } catch {
      // 不是 base64，維持原文給下面 JSON.parse 報錯
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

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("缺少 FIREBASE_SERVICE_ACCOUNT_KEY（請用 node --env-file=.env.local 執行）");
  initializeApp({
    credential: cert(parseServiceAccount(raw)),
  });
  return getFirestore();
}

/** 與 src/lib/settings-server.ts 的 detectPeriod 同邏輯：9-1 月第1學期、2-8 月第2學期 */
function detectPeriod() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const semester = month >= 9 || month === 1 ? 1 : 2;
  const startYear = semester === 1 ? now.getFullYear() - 1 : now.getFullYear();
  return { academicYear: startYear - 1911, semester };
}

async function getCurrentPeriod(db) {
  const snap = await db.collection("settings").doc("system").get();
  const data = snap.exists ? snap.data() : {};
  const fallback = detectPeriod();
  const academicYear =
    Number.isFinite(Number(data?.academicYear)) && Number(data.academicYear) > 0
      ? Number(data.academicYear)
      : fallback.academicYear;
  const semester = Number(data?.semester) === 2 || Number(data?.semester) === 1
    ? Number(data.semester)
    : fallback.semester;
  return { academicYear, semester };
}

function flushBatch(db, ops) {
  if (ops.length === 0) return Promise.resolve();
  const batch = db.batch();
  for (const op of ops) {
    if (op.type === "set") batch.set(op.ref, op.data, { merge: false });
    else batch.update(op.ref, op.data);
  }
  ops.length = 0;
  return batch.commit();
}

async function migrateRole(db, role, period, stats) {
  const collectionName = ROLES[role];
  const fields = ENTRY_FIELDS[role];
  const snapshot = await db.collection(collectionName).get();
  const ops = [];
  const now = Date.now();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const uid = doc.id;
    const entryId = `${uid}_${period.academicYear}_${period.semester}`;
    const entryRef = db.collection(ROSTER_COLLECTION).doc(entryId);

    const entryExists = (await entryRef.get()).exists;
    if (!entryExists) {
      const entry = {
        uid,
        role,
        academicYear: period.academicYear,
        semester: period.semester,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
        updatedAt: now,
      };
      for (const key of fields) entry[key] = typeof data[key] === "string" ? data[key] : "";
      if (DRY_RUN) {
        console.log(`[dry-run] 建立名冊條目 ${entryId}`);
      } else {
        ops.push({ type: "set", ref: entryRef, data: entry });
      }
      stats.entriesCreated += 1;
    } else {
      stats.entriesSkipped += 1;
    }

    const patch = {};
    const notes = [];
    for (const key of fields) {
      if (key in data) {
        patch[key] = FieldValue.delete();
      }
    }
    if (fields.some((key) => key in data)) notes.push("移除名冊欄位");
    if (!("active" in data)) {
      patch.active = true;
      notes.push("補 active");
    }
    const hasPatch = Object.keys(patch).length > 0;
    if (hasPatch) {
      if (DRY_RUN) {
        console.log(`[dry-run] 更新帳號 ${collectionName}/${uid}：${notes.join("、")}`);
      } else {
        ops.push({ type: "update", ref: doc.ref, data: patch });
      }
      stats.accountsUpdated += 1;
    }
  }

  if (!DRY_RUN) await flushBatch(db, ops);
}

async function main() {
  const db = initFirebase();
  const period = await getCurrentPeriod(db);
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}期間：${period.academicYear} 學年度 第${period.semester}學期`
  );

  const stats = { entriesCreated: 0, entriesSkipped: 0, accountsUpdated: 0 };
  for (const role of ["student", "parent", "staff", "admin"]) {
    await migrateRole(db, role, period, stats);
  }

  console.log(
    `完成：建立名冊條目 ${stats.entriesCreated} 筆（已存在略過 ${stats.entriesSkipped} 筆），更新帳號 ${stats.accountsUpdated} 筆`
  );
}

main().catch((error) => {
  console.error("遷移失敗：", error);
  process.exit(1);
});
