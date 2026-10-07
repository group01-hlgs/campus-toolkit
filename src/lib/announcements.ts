import "server-only";
import { getAdminDb } from "@/lib/firebase-admin";
import { cachedRead, cachedSettingDoc, invalidateReadCache } from "@/lib/read-cache";
import { invalidateAdminListCache } from "@/lib/list-cache";
import { getCurrentPeriod } from "@/lib/settings-server";
import {
  ANNOUNCEMENTS_COLLECTION,
  ANNOUNCEMENT_REMINDERS_COLLECTION,
  ANNOUNCEMENT_SETTINGS_DOC_ID,
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementDisplayMethod,
  AnnouncementRecord,
  AnnouncementReminderItem,
  AnnouncementSettings,
  announcementCategoryName,
  announcementToFirestore,
  audienceClassScoped,
  DEFAULT_ANNOUNCEMENT_CATEGORIES,
  DEFAULT_ANNOUNCEMENT_SETTINGS,
  isAnnouncementReadable,
  isExpiringSoon,
  readAnnouncementRecord,
  readAnnouncementSettings,
  validateAnnouncementInput,
  type AnnouncementInboxItem,
} from "@/types/announcements";
import { UserRole } from "@/types/users";

/**
 * 公告功能模組（server-only）。
 *
 * 跨模組公告接口協議（其他模組請照此呼叫，勿自開平行集合）：
 * 1. 只寫 `announcements` 集合；
 * 2. `sourceModule` 必填（公告頁自己發文＝"announcements"）；
 * 3. 受眾必須明確（roles＋必要時 classCodes），不可無界；
 * 4. 寫入成功後呼叫 `invalidateAnnouncementsCache()`（本函式已內建）。
 *
 * 讀取：管理端清單直讀＋排序；收件匣走 15 秒 cachedRead，
 * 寫入後以 invalidateReadCache("announcements:") 清本機（跨實例上限＝TTL）。
 */

const INBOX_CACHE_PREFIX = "announcements:inbox:";
const INBOX_TTL_MS = 15_000;
const ADMIN_LIST_LIMIT = 100;
const INBOX_LIMIT = 50;

/** 讀取公告模組設定（settings/announcements，30 秒快取） */
export async function getAnnouncementSettings(): Promise<AnnouncementSettings> {
  try {
    const raw = await cachedSettingDoc(ANNOUNCEMENT_SETTINGS_DOC_ID, async () => {
      const snap = await getAdminDb()
        .collection("settings")
        .doc(ANNOUNCEMENT_SETTINGS_DOC_ID)
        .get();
      return snap.exists ? (snap.data() ?? null) : null;
    });
    return readAnnouncementSettings(raw);
  } catch {
    return {
      ...DEFAULT_ANNOUNCEMENT_SETTINGS,
      categories: [...DEFAULT_ANNOUNCEMENT_CATEGORIES],
    };
  }
}

/** 公告變更後：清收件匣快取＋管理端清單（epoch） */
export function invalidateAnnouncementsCache(): void {
  invalidateReadCache(INBOX_CACHE_PREFIX);
  // 管理端清單若日後改用 cachedListRead，epoch 遞增會一併涵蓋；
  // 目前管理清單直讀＋短 TTL，此呼叫同步清 settings 相關無害
  void invalidateAdminListCache();
}

export interface PublishFromModuleInput {
  sourceModule: string;
  sourceRef?: string;
  title: string;
  body: string;
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  audience: AnnouncementAudience;
  categoryId?: string;
  publishAt?: number;
  expireAt?: number | null;
  pinned?: boolean;
}

/**
 * 跨模組發佈公告：其他功能模組（補修、行事曆…）在伺服器端直接呼叫。
 * 校驗失敗拋錯；成功回傳新公告 id。
 */
export async function publishFromModule(input: PublishFromModuleInput): Promise<{ id: string }> {
  const sourceModule = typeof input.sourceModule === "string" ? input.sourceModule.trim() : "";
  if (!sourceModule) {
    throw new Error("publishFromModule: sourceModule 必填");
  }
  const validation = validateAnnouncementInput({
    title: input.title,
    body: input.body,
    categoryId: input.categoryId,
    audience: input.audience,
    publishAt: input.publishAt,
    expireAt: input.expireAt ?? null,
    pinned: input.pinned,
  });
  if (!validation.ok) {
    throw new Error(`publishFromModule: ${validation.message}`);
  }

  const period = await getCurrentPeriod();
  const now = Date.now();
  const record: Omit<AnnouncementRecord, "id"> = {
    title: validation.value.title,
    body: validation.value.body,
    categoryId: validation.value.categoryId,
    sourceModule,
    sourceRef: input.sourceRef,
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorRole: input.authorRole,
    audience: validation.value.audience,
    status: "published",
    publishAt: validation.value.publishAt,
    expireAt: validation.value.expireAt,
    academicYear: period.academicYear,
    semester: period.semester === 2 ? 2 : 1,
    pinned: validation.value.pinned,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await getAdminDb()
    .collection(ANNOUNCEMENTS_COLLECTION)
    .add(announcementToFirestore(record));
  invalidateAnnouncementsCache();
  return { id: ref.id };
}

export interface CreateAnnouncementInput extends PublishFromModuleInput {
  /** 管理端可覆寫狀態；教職員發佈固定 published */
  status?: "published" | "archived";
}

/** 管理端／教職員建立公告（內部共用） */
export async function createAnnouncement(input: CreateAnnouncementInput): Promise<{ id: string }> {
  return publishFromModule(input);
}

/** 更新公告（僅改可編輯欄位；id 固定） */
export async function updateAnnouncement(
  id: string,
  patch: {
    title?: string;
    body?: string;
    categoryId?: string;
    audience?: AnnouncementAudience;
    publishAt?: number;
    expireAt?: number | null;
    pinned?: boolean;
    status?: "published" | "archived";
  }
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection(ANNOUNCEMENTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("查無此公告");
  const current = readAnnouncementRecord(id, snap.data());
  if (!current) throw new Error("公告資料毀損");

  const validation = validateAnnouncementInput({
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    categoryId: patch.categoryId ?? current.categoryId,
    audience: patch.audience ?? current.audience,
    publishAt: patch.publishAt ?? current.publishAt,
    expireAt: patch.expireAt === undefined ? (current.expireAt ?? null) : patch.expireAt,
    pinned: patch.pinned ?? current.pinned,
    academicYear: current.academicYear,
    semester: current.semester,
  });
  if (!validation.ok) throw new Error(validation.message);

  const next: Omit<AnnouncementRecord, "id"> = {
    ...current,
    title: validation.value.title,
    body: validation.value.body,
    categoryId: validation.value.categoryId,
    audience: validation.value.audience,
    publishAt: validation.value.publishAt,
    expireAt: validation.value.expireAt,
    pinned: validation.value.pinned,
    status: patch.status ?? current.status,
    updatedAt: Date.now(),
  };
  await ref.update(announcementToFirestore(next));
  invalidateAnnouncementsCache();
}

/** 封存公告 */
export async function archiveAnnouncement(id: string): Promise<void> {
  await updateAnnouncement(id, { status: "archived" });
}

export interface AdminAnnouncementRow extends AnnouncementRecord {
  categoryName: string;
}

/** 管理端清單（含封存；不做受眾過濾） */
export async function listAdminAnnouncements(
  options?: { includeArchived?: boolean }
): Promise<AdminAnnouncementRow[]> {
  const settings = await getAnnouncementSettings();
  const snap = await getAdminDb()
    .collection(ANNOUNCEMENTS_COLLECTION)
    .limit(ADMIN_LIST_LIMIT)
    .get();
  const rows: AdminAnnouncementRow[] = [];
  for (const doc of snap.docs) {
    const record = readAnnouncementRecord(doc.id, doc.data());
    if (!record) continue;
    if (!options?.includeArchived && record.status === "archived") continue;
    rows.push({
      ...record,
      categoryName: announcementCategoryName(settings, record.categoryId),
    });
  }
  rows.sort((a, b) => b.publishAt - a.publishAt || b.createdAt - a.createdAt);
  return rows;
}

export interface InboxQuery {
  role: UserRole;
  classCode?: string | null;
}

/**
 * 角色收件匣：role 等值＋status published 查詢（過濾下推），
 * 班級／到期在記憶體過濾（校園公告量級可接受；避免複合索引）。
 */
export async function listInboxAnnouncements(
  query: InboxQuery
): Promise<AnnouncementInboxItem[]> {
  const { role, classCode } = query;
  const cacheKey = `${INBOX_CACHE_PREFIX}${role}:${classCode || "*"}`;
  return cachedRead(cacheKey, INBOX_TTL_MS, async () => {
    const settings = await getAnnouncementSettings();
    const snap = await getAdminDb()
      .collection(ANNOUNCEMENTS_COLLECTION)
      .where("status", "==", "published")
      .where("audienceRoles", "array-contains", role)
      .limit(INBOX_LIMIT)
      .get();
    const now = Date.now();
    const items: AnnouncementInboxItem[] = [];
    for (const doc of snap.docs) {
      const record = readAnnouncementRecord(doc.id, doc.data());
      if (!record) continue;
      if (!isAnnouncementReadable(record, now)) continue;
      if (!record.audience.roles.includes(role)) continue;
      const scoped = audienceClassScoped(record.audience);
      if (scoped) {
        if (!classCode) continue;
        if (!record.audience.classCodes.includes(classCode)) continue;
      }
      items.push({
        id: record.id,
        title: record.title,
        body: record.body,
        categoryId: record.categoryId,
        categoryName: announcementCategoryName(settings, record.categoryId),
        sourceModule: record.sourceModule,
        authorName: record.authorName,
        authorRole: record.authorRole,
        audienceRoles: record.audience.roles,
        classScoped: scoped,
        classCodes: record.audience.classCodes,
        publishAt: record.publishAt,
        expireAt: record.expireAt,
        pinned: record.pinned === true,
        expiringSoon: isExpiringSoon(record, now),
      });
    }
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.publishAt - a.publishAt;
    });
    return items;
  });
}

/** 讀取單則公告（管理端編輯用） */
export async function getAnnouncement(id: string): Promise<AnnouncementRecord | null> {
  const snap = await getAdminDb().collection(ANNOUNCEMENTS_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return readAnnouncementRecord(id, snap.data());
}

/** 儲存模組設定（管理端；整份覆寫 settings/announcements） */
export async function saveAnnouncementSettings(input: {
  categories?: AnnouncementCategory[];
  displayMethod?: AnnouncementDisplayMethod;
  defaultRemindersEnabled?: boolean;
}): Promise<AnnouncementSettings> {
  const current = await getAnnouncementSettings();
  const categories = Array.isArray(input.categories)
    ? input.categories
        .map((item, index) => ({
          id: typeof item.id === "string" ? item.id.trim().slice(0, 64) : "",
          name: typeof item.name === "string" ? item.name.trim().slice(0, 64) : "",
          sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : index,
          enabled: item.enabled !== false,
        }))
        .filter((item) => item.id && item.name)
    : current.categories;
  const next: AnnouncementSettings = {
    categories: categories.length > 0 ? categories : [...DEFAULT_ANNOUNCEMENT_CATEGORIES],
    displayMethod: input.displayMethod ?? current.displayMethod,
    defaultRemindersEnabled:
      typeof input.defaultRemindersEnabled === "boolean"
        ? input.defaultRemindersEnabled
        : current.defaultRemindersEnabled,
  };
  await getAdminDb()
    .collection("settings")
    .doc(ANNOUNCEMENT_SETTINGS_DOC_ID)
    .set(next, { merge: false });
  // 設定快取失效（cachedSettingDoc key＝setting-doc:announcements）
  invalidateReadCache("setting-doc:");
  invalidateAnnouncementsCache();
  return next;
}

const REMINDER_LIMIT = 50;

function reminderDocId(announcementId: string, uid: string): string {
  return `${announcementId}_${uid}`;
}

/**
 * 切換個人公告提醒：已設定則取消，未設定則建立。
 * 回傳 `reminded=true` 表示目前為「已設定」。
 */
export async function toggleAnnouncementReminder(
  uid: string,
  announcementId: string
): Promise<{ reminded: boolean }> {
  if (!uid || !announcementId) {
    throw new Error("缺少使用者或公告識別");
  }
  const ann = await getAnnouncement(announcementId);
  if (!ann || !isAnnouncementReadable(ann)) {
    throw new Error("公告不存在或已無法提醒");
  }
  const db = getAdminDb();
  const ref = db
    .collection(ANNOUNCEMENT_REMINDERS_COLLECTION)
    .doc(reminderDocId(announcementId, uid));
  const snap = await ref.get();
  if (snap.exists) {
    await ref.delete();
    return { reminded: false };
  }
  await ref.set({
    announcementId,
    uid,
    createdAt: Date.now(),
  });
  return { reminded: true };
}

/** 使用者已設定提醒的公告 id 清單（不做跨請求快取：提醒變動頻繁） */
export async function listMyReminderIds(uid: string): Promise<string[]> {
  if (!uid) return [];
  const snap = await getAdminDb()
    .collection(ANNOUNCEMENT_REMINDERS_COLLECTION)
    .where("uid", "==", uid)
    .limit(REMINDER_LIMIT)
    .get();
  return snap.docs.map((doc) => doc.data().announcementId).filter((id): id is string => !!id);
}

/**
 * 個人提醒列表（首頁鈴鐺／提醒區）：
 * 讀提醒文件 → 批次讀公告（getAll）→ 確認仍可閱讀（發布中、未過期、受眾涵蓋身分＋班級）。
 */
export async function listMyReminders(
  uid: string,
  role: UserRole,
  classCode?: string | null
): Promise<AnnouncementReminderItem[]> {
  if (!uid) return [];
  const settings = await getAnnouncementSettings();
  const snap = await getAdminDb()
    .collection(ANNOUNCEMENT_REMINDERS_COLLECTION)
    .where("uid", "==", uid)
    .limit(REMINDER_LIMIT)
    .get();
  const reminderRows = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      announcementId: typeof data.announcementId === "string" ? data.announcementId : "",
      createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    };
  });
  const ids = [...new Set(reminderRows.map((row) => row.announcementId).filter(Boolean))];
  if (ids.length === 0) return [];

  const db = getAdminDb();
  const snaps = await db.getAll(
    ...ids.map((id) => db.collection(ANNOUNCEMENTS_COLLECTION).doc(id))
  );
  const annMap = new Map<string, AnnouncementRecord>();
  snaps.forEach((snapItem, index) => {
    if (!snapItem.exists) return;
    const record = readAnnouncementRecord(ids[index], snapItem.data());
    if (record) annMap.set(ids[index], record);
  });

  const now = Date.now();
  const items: AnnouncementReminderItem[] = [];
  for (const row of reminderRows) {
    const ann = annMap.get(row.announcementId);
    if (!ann || !isAnnouncementReadable(ann, now)) continue;
    if (!ann.audience.roles.includes(role)) continue;
    if (audienceClassScoped(ann.audience)) {
      if (!classCode || !ann.audience.classCodes.includes(classCode)) continue;
    }
    items.push({
      announcementId: ann.id,
      title: ann.title,
      body: ann.body,
      categoryName: announcementCategoryName(settings, ann.categoryId),
      authorName: ann.authorName,
      publishAt: ann.publishAt,
      expireAt: ann.expireAt,
      expiringSoon: isExpiringSoon(ann, now),
      classScoped: audienceClassScoped(ann.audience),
      createdAt: row.createdAt,
    });
  }
  items.sort((a, b) => b.publishAt - a.publishAt);
  return items;
}
