"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";
import { fetchSettings } from "@/lib/settings-client";
import { clipText } from "@/types/announcements";
import type {
  AnnouncementSurfaceMethod,
  AnnouncementInboxItem,
} from "@/types/announcements";
import { ROLE_LABELS, type UserRole } from "@/types/users";

type Flash = { type: "success" | "error"; text: string } | null;

type FontSize = "small" | "medium" | "large";

const FONT_SIZE_LABELS: Record<FontSize, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 字級對照：原尺寸為基準，小=+15%、中=+40%、大=+90% */
const FONT_SIZE_CLASSES: Record<FontSize, { heading: string; title: string; body: string; meta: string }> = {
  small: {
    heading: "text-base",
    title: "text-base",
    body: "text-sm",
    meta: "text-sm",
  },
  medium: {
    heading: "text-lg",
    title: "text-lg",
    body: "text-base",
    meta: "text-base",
  },
  large: {
    heading: "text-xl",
    title: "text-2xl",
    body: "text-xl",
    meta: "text-xl",
  },
};

const STORAGE_KEY = "announcement-font-size";

function readStoredFontSize(): FontSize {
  if (typeof window === "undefined") return "small";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "medium" || raw === "large" ? raw : "small";
}

interface InboxResponse {
  success?: boolean;
  message?: string;
  items?: AnnouncementInboxItem[];
  classCode?: string | null;
  displayName?: string;
  displayMethod?: AnnouncementSurfaceMethod;
  enablePinned?: boolean;
  remindersEnabled?: boolean;
}

/** 各身分公告頁（學生／家長／教職員共用；教職員另可發佈） */
export default function AnnouncementsInbox({
  role,
  canPublish,
}: {
  role: UserRole;
  canPublish?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<AnnouncementInboxItem[]>([]);
  const [classCode, setClassCode] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [displayMethod, setDisplayMethod] = useState<AnnouncementSurfaceMethod>("list");
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Flash>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roles, setRoles] = useState<UserRole[]>(
    role === "staff" ? ["student", "parent"] : [role]
  );
  /** 閱讀權限＝「無」（公開，不需登入可見） */
  const [isPublic, setIsPublic] = useState(false);
  const [classScoped, setClassScoped] = useState(false);
  const [posting, setPosting] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState<string[]>([]);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [togglingReminder, setTogglingReminder] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<FontSize>("small");
  const [enablePinned, setEnablePinned] = useState(true);

  useEffect(() => {
    setFontSize(readStoredFontSize());
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const [session, settingsData] = await Promise.all([
        fetchSession(true),
        fetchSettings(),
      ]);
      if (cancelled) return;
      if (!session || session.role !== role) {
        router.push("/");
        return;
      }
      setDisplayName(session.displayName);
      // 設定快取的 visibleModules：公告未提供或被關閉時提示（頁面仍可直接網址進入，API 會把關名冊）
      const visible = settingsData?.visibleModules;
      if (Array.isArray(visible) && !visible.includes("announcements")) {
        setFlash({ type: "error", text: "公告功能目前對此身分關閉顯示" });
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [role, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements", { cache: "no-store" });
      const data: InboxResponse | null = await res.json().catch(() => null);
      if (data?.success) {
        setItems(data.items ?? []);
        setClassCode(data.classCode ?? null);
        if (data.displayMethod) setDisplayMethod(data.displayMethod);
        setEnablePinned(data.enablePinned !== false);
        if (typeof data.remindersEnabled === "boolean") {
          setRemindersEnabled(data.remindersEnabled);
        }
      } else if (data?.message) {
        setFlash({ type: "error", text: data.message });
      }
    } catch {
      setFlash({ type: "error", text: "載入公告失敗" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitPost(event: React.FormEvent) {
    event.preventDefault();
    if (posting) return;
    setPosting(true);
    setFlash(null);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          isPublic,
          roles: isPublic ? [] : roles,
          classCodes: isPublic ? [] : classScoped && classCode ? [classCode] : [],
        }),
      });
      const data: InboxResponse | null = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || "發佈失敗");
      setTitle("");
      setBody("");
      setFlash({ type: "success", text: data.message || "公告已發佈" });
      if (data.displayMethod) setDisplayMethod(data.displayMethod);
      if (data.items) setItems(data.items);
      else await load();
    } catch (error) {
      setFlash({ type: "error", text: error instanceof Error ? error.message : "發佈失敗" });
    } finally {
      setPosting(false);
    }
  }

  async function toggleReminder(announcementId: string) {
    if (togglingReminder) return;
    setTogglingReminder(announcementId);
    try {
      const res = await fetch("/api/announcements/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcementId }),
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        reminded?: boolean;
      } | null;
      if (!res.ok || !data?.success) throw new Error(data?.message || "提醒設定失敗");
      setItems((prev) =>
        prev.map((item) =>
          item.id === announcementId ? { ...item, reminded: data.reminded === true } : item
        )
      );
      setFlash({
        type: "success",
        text: data.message || (data.reminded ? "已加入提醒" : "已取消提醒"),
      });
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "提醒設定失敗",
      });
    } finally {
      setTogglingReminder(null);
    }
  }

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    try {
      window.localStorage.setItem(STORAGE_KEY, size);
    } catch {
      // localStorage 不可用時僅本次生效
    }
  }

  // 橫幅模式的橫幅來源：置頂公告優先；完全沒有置頂時改用最新一則
  //（items 由伺服器排序＝置頂在前、再依發布時間新到舊；
  // 已按「關閉」的橫幅不重複顯示，該則改回一般清單）
  // 置頂原則關閉時：一律以清單樣式呈現
  const effectiveMethod = enablePinned ? displayMethod : "list";
  const bannerSource =
    effectiveMethod === "marquee"
      ? items.some((item) => item.pinned)
        ? items.filter((item) => item.pinned)
        : items.slice(0, 1)
      : [];
  const bannerItems = bannerSource.filter((item) => !dismissedBanners.includes(item.id));
  const bannerIds = new Set(bannerItems.map((item) => item.id));

  return (
    <div className="w-full max-w-3xl mb-8 space-y-6">
      {flash && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white"
          style={{ background: `var(${flash.type === "success" ? "--success" : "--danger"})` }}
          role="status"
        >
          {flash.text}
        </div>
      )}

      <div className="content-width text-center">
        <h2 className="text-2xl font-bold text-t1">公告</h2>
        {displayName && <p className="text-t2 mt-1">{displayName}，您好</p>}
        {classCode && <p className="text-xs text-t3 mt-0.5">班級：{classCode}</p>}
        <button
          type="button"
          onClick={() => router.push(`/${role}`)}
          className="mt-2 btn-soft rounded px-3 py-1 text-xs cursor-pointer"
        >
          ← 返回功能首頁
        </button>
      </div>

      {canPublish && (
        <section className="border border-themed rounded-lg bg-card p-5">
          <h3 className="text-lg font-bold text-t1 mb-3">發佈公告</h3>
          <form onSubmit={submitPost} className="space-y-3">
            <div>
              <label className="block text-xs text-t2 mb-1" htmlFor="post-title">
                標題
              </label>
              <input
                id="post-title"
                className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div>
              <label className="block text-xs text-t2 mb-1" htmlFor="post-body">
                內容
              </label>
              <textarea
                id="post-body"
                className="w-full border border-themed rounded px-3 py-2 text-sm bg-card text-t1 min-h-24"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                maxLength={5000}
              />
            </div>
            <div>
              <span className="block text-xs text-t2 mb-1">閱讀權限</span>
              <div className="flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => {
                      setIsPublic(e.target.checked);
                      if (e.target.checked) setClassScoped(false);
                    }}
                  />
                  無（公開，不需登入即可看見）
                </label>
                {(role === "staff"
                  ? (["student", "parent", "staff"] as UserRole[])
                  : [role]
                ).map((r) => (
                  <label
                    key={r}
                    className={`inline-flex items-center gap-1.5 text-sm ${
                      isPublic ? "text-t3" : "text-t1"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={isPublic}
                      checked={roles.includes(r)}
                      onChange={() =>
                        setRoles((prev) =>
                          prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
                        )
                      }
                    />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-t3 mt-1">
                勾選「無」＝任何人均可看見、不需先登入；勾選身分＝僅該身分可見（可多選）。
              </p>
            </div>
            {role === "staff" && classCode && (
              <label
                className={`inline-flex items-center gap-1.5 text-sm ${
                  isPublic ? "text-t3" : "text-t1"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={isPublic}
                  checked={classScoped}
                  onChange={(e) => setClassScoped(e.target.checked)}
                />
                僅發佈至我的導師班（{classCode}）
              </label>
            )}
            <button
              type="submit"
              disabled={posting}
              className="btn-theme rounded px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
            >
              {posting ? "處理中..." : "發佈"}
            </button>
          </form>
        </section>
      )}

      <section>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-bold text-t1">公告</h3>
          <div className="flex items-center gap-1" role="group" aria-label="公告字級">
            {(Object.keys(FONT_SIZE_LABELS) as FontSize[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => changeFontSize(key)}
                aria-pressed={fontSize === key}
                className={`px-2 py-0.5 text-sm rounded border cursor-pointer transition-colors ${
                  fontSize === key
                    ? "border-primary text-primary font-medium"
                    : "border-themed text-t3 hover:text-t1"
                }`}
              >
                {FONT_SIZE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-t3 mb-3">
          顯示方式：
          {effectiveMethod === "marquee"
            ? "置頂公告以橫幅顯示（無置頂時取最新一則）"
            : effectiveMethod === "pinnedTop"
              ? "置頂公告以橫幅三行顯示，其餘為單行清單（點擊展開）"
              : "清單（全文展開）"}
          ；過期公告已自動隱藏
        </p>
        {loading ? (
          <p className="text-t3 text-sm">載入中...</p>
        ) : items.length === 0 ? (
          <p className="text-t3 text-sm">目前沒有公告</p>
        ) : (
          <>
            {/* 橫幅模式：置頂公告以醒目橫幅顯示；完全沒有置頂時改用最新一則
                （可於本機關閉橫幅，該則回到一般清單，不影響他人） */}
            {effectiveMethod === "marquee" &&
              bannerItems.map((item) => (
                <div
                  key={`banner-${item.id}`}
                  className="mb-3 border-l-4 border-success bg-card border border-themed rounded-lg p-4 shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className={`${FONT_SIZE_CLASSES[fontSize].title} font-bold text-t1 flex items-center gap-1.5`}>
                      {item.pinned && <span aria-hidden="true">📌</span>}
                      <span>{item.title}</span>
                      {!item.pinned && (
                        <span className="text-sm font-normal text-t2 border border-themed rounded px-1.5 py-0.5 shrink-0">
                          最新
                        </span>
                      )}
                    </h4>
                    <button
                      type="button"
                      className="text-sm text-t3 hover:text-t1 cursor-pointer shrink-0"
                      onClick={() => setDismissedBanners((prev) => [...prev, item.id])}
                    >
                      關閉
                    </button>
                  </div>
                  <p className={`${FONT_SIZE_CLASSES[fontSize].meta} text-t3 mt-1`}>
                    {item.categoryName}｜{item.authorName}
                    {item.classScoped ? "｜班級" : "｜校級"}
                  </p>
                  <p className={`${FONT_SIZE_CLASSES[fontSize].body} text-t2 mt-2 whitespace-pre-wrap`}>
                    {item.body}
                  </p>
                </div>
              ))}

            {/* 置頂區（pinnedTop 模式）：置頂公告以橫幅三行卡顯示——
                第 1 行標題 20 字內、第 2 行內容摘要 40 字內、第 3 行公告資訊（分類｜作者｜日期） */}
            {effectiveMethod === "pinnedTop" &&
              items.filter((item) => item.pinned).length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-primary mb-2">置頂公告</h4>
                  <ul className="space-y-3">
                    {items
                      .filter((item) => item.pinned)
                      .map((item) => (
                        <PinnedBannerRow key={item.id} item={item} sizes={FONT_SIZE_CLASSES[fontSize]} />
                      ))}
                  </ul>
                </div>
              )}

            {/* 一般清單：
                list／marquee＝全文卡片（marquee 已顯示於橫幅者不重複列出）；
                pinnedTop＝其餘公告收為單行（日期｜分類｜標題 20 字內），點擊展開內文 */}
            {effectiveMethod === "pinnedTop" ? (
              <ul className="space-y-2">
                {items
                  .filter((item) => !item.pinned)
                  .map((item) => (
                    <AnnouncementCompactRow
                      key={item.id}
                      item={item}
                      remindersEnabled={remindersEnabled}
                      toggling={togglingReminder === item.id}
                      onToggleReminder={toggleReminder}
                      sizes={FONT_SIZE_CLASSES[fontSize]}
                    />
                  ))}
              </ul>
            ) : (
              <ul className="space-y-3">
                {items
                  .filter((item) => !bannerIds.has(item.id))
                  .map((item) => (
                    <AnnouncementCard
                      key={item.id}
                      item={item}
                      remindersEnabled={remindersEnabled}
                      toggling={togglingReminder === item.id}
                      onToggleReminder={toggleReminder}
                      sizes={FONT_SIZE_CLASSES[fontSize]}
                    />
                  ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * 置頂橫幅卡（pinnedTop 模式的置頂公告）：三行——
 * 第 1 行標題 20 字內、第 2 行內容摘要 40 字內、第 3 行公告資訊（分類｜作者｜日期）；
 * 置頂小標與左側粗邊套用主題主色（--primary）。
 */
function PinnedBannerRow({
  item,
  sizes,
}: {
  item: AnnouncementInboxItem;
  sizes: { title: string; body: string; meta: string };
}) {
  return (
    <li className="border border-themed border-l-4 border-l-primary bg-card rounded-lg p-4 shadow">
      <div className="flex items-center gap-1.5">
        <span className={`${sizes.meta} text-primary border border-current rounded px-1.5 py-0.5 shrink-0`}>
          置頂
        </span>
        <span className={`${sizes.title} font-bold text-t1 truncate`}>{clipText(item.title, 20)}</span>
      </div>
      <p className={`${sizes.body} text-t2 mt-1 truncate`}>{clipText(item.body, 40)}</p>
      <p className={`${sizes.meta} text-t3 mt-1.5`}>
        {item.categoryName}｜{item.authorName}｜
        {new Date(item.publishAt).toLocaleDateString("zh-TW")}
      </p>
    </li>
  );
}

function AnnouncementCard({
  item,
  remindersEnabled,
  toggling,
  onToggleReminder,
  sizes,
}: {
  item: AnnouncementInboxItem;
  remindersEnabled: boolean;
  toggling: boolean;
  onToggleReminder: (id: string) => void;
  sizes: { title: string; body: string; meta: string };
}) {
  return (
    <li className="border border-themed rounded-lg bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className={`${sizes.title} font-bold text-t1`}>{item.title}</h4>
        <div className="flex shrink-0 gap-1.5">
          {item.isPublic && (
            <span className="text-sm text-t2 border border-themed rounded px-1.5 py-0.5">
              公開
            </span>
          )}
          {item.pinned && (
            <span className="text-sm text-primary border border-current rounded px-1.5 py-0.5">
              置頂
            </span>
          )}
          {item.expiringSoon && (
            <span className="text-sm text-danger border border-danger rounded px-1.5 py-0.5">
              即將到期
            </span>
          )}
        </div>
      </div>
      <p className={`${sizes.meta} text-t3 mt-1`}>
        {item.categoryName}｜{item.authorName}
        {item.classScoped ? `｜班級公告` : "｜校級"}
        {item.publishAt ? `｜${new Date(item.publishAt).toLocaleString("zh-TW")}` : ""}
      </p>
      <p className={`${sizes.body} text-t2 mt-2 whitespace-pre-wrap`}>{item.body}</p>
      {remindersEnabled && (
        <div className="mt-3">
          <button
            type="button"
            disabled={toggling}
            onClick={() => onToggleReminder(item.id)}
            className={
              item.reminded
                ? "btn-danger rounded px-2.5 py-1 text-sm cursor-pointer disabled:opacity-50"
                : "btn-soft rounded px-2.5 py-1 text-sm cursor-pointer disabled:opacity-50"
            }
            title="個人提醒：於首頁鈴鐺與本頁提醒區顯示（非系統推播）"
          >
            {toggling
              ? "處理中..."
              : item.reminded
                ? "已設定提醒"
                : "提醒我"}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * 單行清單（pinnedTop 模式的非置頂公告）：
 * 預設單行顯示「日期｜分類｜標題（20 字內，超出加 ...）」，點擊展開看完整內文與資訊——
 * 與「清單，置頂公告橫幅」的置頂橫幅形成明顯層級差異。
 */
function AnnouncementCompactRow({
  item,
  remindersEnabled,
  toggling,
  onToggleReminder,
  sizes,
}: {
  item: AnnouncementInboxItem;
  remindersEnabled: boolean;
  toggling: boolean;
  onToggleReminder: (id: string) => void;
  sizes: { title: string; body: string; meta: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border border-themed rounded-lg bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left cursor-pointer"
      >
        <svg
          className={`w-4 h-4 shrink-0 text-t3 transition-transform ${
            open ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`flex-1 min-w-0 truncate ${sizes.body} text-t2`}>
          <span className="text-t3">
            {item.publishAt ? new Date(item.publishAt).toLocaleDateString("zh-TW") : ""}
          </span>
          ｜{item.categoryName}｜
          <span className="font-medium text-t1">{clipText(item.title, 20)}</span>
        </span>
        {item.expiringSoon && (
          <span className="text-sm text-danger border border-danger rounded px-1.5 py-0.5 shrink-0">
            即將到期
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-themed px-4 py-3">
          <p className={`${sizes.meta} text-t3 mb-2`}>
            {item.categoryName}｜{item.authorName}
            {item.classScoped ? "｜班級公告" : "｜校級"}
            {item.publishAt ? `｜${new Date(item.publishAt).toLocaleString("zh-TW")}` : ""}
            {item.isPublic ? (
              <span className="ml-1.5 text-t2 border border-themed rounded px-1.5 py-0.5">
                公開
              </span>
            ) : null}
          </p>
          <p className={`${sizes.body} text-t2 whitespace-pre-wrap`}>{item.body}</p>
          {remindersEnabled && (
            <div className="mt-3">
              <button
                type="button"
                disabled={toggling}
                onClick={() => onToggleReminder(item.id)}
                className={
                  item.reminded
                    ? "btn-danger rounded px-2.5 py-1 text-sm cursor-pointer disabled:opacity-50"
                    : "btn-soft rounded px-2.5 py-1 text-sm cursor-pointer disabled:opacity-50"
                }
                title="個人提醒：於首頁鈴鐺與本頁提醒區顯示（非系統推播）"
              >
                {toggling
                  ? "處理中..."
                  : item.reminded
                    ? "已設定提醒"
                    : "提醒我"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
