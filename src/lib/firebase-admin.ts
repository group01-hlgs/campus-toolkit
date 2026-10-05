import "server-only";
import { initializeApp, getApps, cert, App, ServiceAccount } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";

let adminApp: App | null = null;
let adminDb: Firestore | null = null;
let adminAuth: Auth | null = null;

/** 解析 `FIREBASE_SERVICE_ACCOUNT_KEY`（純 JSON／引號包覆 JSON／base64 皆可）；「統計儀表板」取用以呼叫 Cloud Monitoring */
export function parseServiceAccount(raw: string): ServiceAccount {
  let text = raw.trim();

  // 去掉可能包在外面的一層引號
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }

  // 允許 base64 編碼的 JSON
  if (!text.startsWith("{")) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8");
      if (decoded.trim().startsWith("{")) text = decoded;
    } catch {
      // 不是 base64，維持原文給下面 JSON.parse 報錯
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY 不是有效 JSON（請貼上完整服務帳號金鑰，或使用 base64）"
    );
  }

  // env 中 private_key 常被存成字面 \n
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY 缺少 client_email 或 private_key"
    );
  }

  return parsed as unknown as ServiceAccount;
}

function ensureAdminApp(): App {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY 未設定，無法存取 Firestore（請加入 .env / Vercel 環境變數）"
    );
  }
  try {
    const serviceAccount = parseServiceAccount(raw);
    adminApp = initializeApp({ credential: cert(serviceAccount) });
    return adminApp;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Firebase Admin SDK 初始化失敗: ${msg}`);
  }
}

export function getAdminDb(): Firestore {
  if (adminDb) return adminDb;
  adminDb = getFirestore(ensureAdminApp());
  return adminDb;
}

export function getAdminAuth(): Auth {
  if (adminAuth) return adminAuth;
  adminAuth = getAuth(ensureAdminApp());
  return adminAuth;
}

export { FieldValue } from "firebase-admin/firestore";
