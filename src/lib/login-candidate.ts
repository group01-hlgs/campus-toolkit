import "server-only";
import type { DocumentReference, DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { verifyPassword } from "@/lib/auth";
import { getCurrentPeriod } from "@/lib/settings-server";
import { entryRoleOf, getRosterEntry } from "@/lib/roster";
import { ALL_ROLES, isAccountActive, isUserRole, ROLE_COLLECTIONS, UserRole } from "@/types/users";

/** 使用者帳號的一筆候選（身分 × 帳號文件） */
export interface AccountCandidate {
  role: UserRole;
  /** 帳號文件 id（即 uid） */
  id: string;
  ref: DocumentReference;
  data: DocumentData;
}

/**
 * 依欄位（email／account）同時查找四種身分的使用者帳號。
 * 登入頁不再選身分，身分由伺服器端查找決定；回傳順序固定為 ALL_ROLES。
 */
export async function findAccountsBy(
  field: "email" | "account",
  value: string
): Promise<AccountCandidate[]> {
  const db = getAdminDb();
  const snapshots = await Promise.all(
    ALL_ROLES.map((role) =>
      db.collection(ROLE_COLLECTIONS[role]).where(field, "==", value).limit(1).get()
    )
  );

  const candidates: AccountCandidate[] = [];
  snapshots.forEach((snapshot, index) => {
    if (snapshot.empty) return;
    const doc = snapshot.docs[0];
    candidates.push({ role: ALL_ROLES[index], id: doc.id, ref: doc.ref, data: doc.data() });
  });
  return candidates;
}

/**
 * 多個候選時取出慣用身分：彙整候選文件上的 preferredRole（僅承認候選中真實存在的身分），
 * 剛好只有一個選擇才生效；沒有設定或多個互斥設定都回 null（交由選擇步驟處理）。
 */
export function preferredRoleAmong(
  candidates: readonly { role: UserRole; data: DocumentData }[]
): UserRole | null {
  const roles = new Set(candidates.map((candidate) => candidate.role));
  const preferred = new Set<UserRole>();
  for (const candidate of candidates) {
    const value = candidate.data.preferredRole;
    if (isUserRole(value) && roles.has(value)) preferred.add(value);
  }
  return preferred.size === 1 ? [...preferred][0] : null;
}

/**
 * 以密碼篩出有效的候選：相同密碼雜湊只比對一次（種子帳號等多身分共用同一組密碼時只跑一次 bcrypt）。
 * 回傳通過驗證的候選，順序維持 ALL_ROLES。
 */
export async function filterByPassword(
  password: string,
  candidates: AccountCandidate[]
): Promise<AccountCandidate[]> {
  const byHash = new Map<string, AccountCandidate[]>();
  for (const candidate of candidates) {
    const hash = typeof candidate.data.passwordHash === "string" ? candidate.data.passwordHash : "";
    const group = byHash.get(hash);
    if (group) group.push(candidate);
    else byHash.set(hash, [candidate]);
  }

  const valid: AccountCandidate[] = [];
  for (const [hash, group] of byHash) {
    // 雜湊缺漏／格式錯誤直接視為不通過，不送進 bcrypt
    if (!hash || !hash.startsWith("$")) continue;
    if (await verifyPassword(password, hash)) valid.push(...group);
  }
  return valid;
}

/** 多身分選擇回應的身分清單（固定 ALL_ROLES 順序） */
export function orderRoles(roles: UserRole[]): UserRole[] {
  return ALL_ROLES.filter((role) => roles.includes(role));
}

/**
 * 多身分偵測：以 primary 的電子郵件地址去找其他身分，符合以下條件才算數——
 * ①同一組電子郵件地址 ②帳號狀態有效 ③具備當期（同學年度學期）的身分名冊條目。
 * primary（已通過帳密／Google 驗證的帳號）恆列為候選之首，不受名冊條目影響。
 * scoped＝以登入識別（email 或 account）查出的候選，順序固定 ALL_ROLES。
 */
export async function detectRoleCandidates(
  primary: AccountCandidate,
  scoped: AccountCandidate[]
): Promise<AccountCandidate[]> {
  const email = typeof primary.data.email === "string" ? primary.data.email : "";
  const others = email
    ? scoped.filter(
        (candidate) =>
          candidate.role !== primary.role && candidate.data.email === email
      )
    : [];
  if (others.length === 0) return [primary];

  const period = await getCurrentPeriod();
  const checked = await Promise.all(
    others.map(async (candidate) => ({
      candidate,
      ok:
        isAccountActive(candidate.data) &&
        (await getRosterEntry(candidate.id, entryRoleOf(candidate.role), period)) !== null,
    }))
  );
  return [primary, ...checked.filter((item) => item.ok).map((item) => item.candidate)];
}
