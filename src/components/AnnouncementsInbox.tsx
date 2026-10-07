"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSession } from "@/lib/session";
import { fetchSettings } from "@/lib/settings-client";
import type {
  AnnouncementDisplayMethod,
  AnnouncementInboxItem,
} from "@/types/announcements";
import { ROLE_LABELS, type UserRole } from "@/types/users";

type Flash = { type: "success" | "error"; text: string } | null;

interface InboxResponse {
  success?: boolean;
  message?: string;
  items?: AnnouncementInboxItem[];
  classCode?: string | null;
  displayName?: string;
  displayMethod?: AnnouncementDisplayMethod;
  remindersEnabled?: boolean;
}

/** 各身分公告收件匣（學生／家長／教職員共用；教職員另可發佈） */
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
  const [displayMethod, setDisplayMethod] = useState<AnnouncementDisplayMethod>("list");
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Flash>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roles, setRoles] = useState<UserRole[]>(
    role === "staff" ? ["student", "parent"] : [role]
  );
  const [classScoped, setClassScoped] = useState(false);
  const [posting, setPosting] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState<string[]>([]);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [togglingReminder, setTogglingReminder] = useState<string | null>(null);

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
          roles,
          classCodes: classScoped && classCode ? [classCode] : [],
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
              <span className="block text-xs text-t2 mb-1">對象身分</span>
              <div className="flex flex-wrap gap-3">
                {(role === "staff"
                  ? (["student", "parent", "staff"] as UserRole[])
                  : [role]
                ).map((r) => (
                  <label key={r} className="inline-flex items-center gap-1.5 text-sm text-t1">
                    <input
                      type="checkbox"
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
            </div>
            {role === "staff" && classCode && (
              <label className="inline-flex items-center gap-1.5 text-sm text-t1">
                <input
                  type="checkbox"
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
        <h3 className="text-lg font-bold text-t1 mb-1">收件匣</h3>
        <p className="text-xs text-t3 mb-3">
          顯示方式：
          {displayMethod === "banner"
            ? "置頂公告以橫幅顯示"
            : displayMethod === "pinnedTop"
              ? "置頂公告優先"
              : "清單"}
          ；過期公告已自動隱藏
        </p>
        {loading ? (
          <p className="text-t3 text-sm">載入中...</p>
        ) : items.length === 0 ? (
          <p className="text-t3 text-sm">目前沒有公告</p>
        ) : (
          <>
            {/* 橫幅模式：置頂公告以醒目橫幅顯示（可於本機關閉橫幅，不影響他人） */}
            {displayMethod === "banner" &&
              items
                .filter((item) => item.pinned && !dismissedBanners.includes(item.id))
                .map((item) => (
                  <div
                    key={`banner-${item.id}`}
                    className="mb-3 border-l-4 border-success bg-card border border-themed rounded-lg p-4 shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-t1">📌 {item.title}</h4>
                      <button
                        type="button"
                        className="text-xs text-t3 hover:text-t1 cursor-pointer shrink-0"
                        onClick={() =>
                          setDismissedBanners((prev) => [...prev, item.id])
                        }
                      >
                        關閉
                      </button>
                    </div>
                    <p className="text-xs text-t3 mt-1">
                      {item.categoryName}｜{item.authorName}
                      {item.classScoped ? "｜班級" : "｜校級"}
                    </p>
                    <p className="text-sm text-t2 mt-2 whitespace-pre-wrap">{item.body}</p>
                  </div>
                ))}

            {/* 置頂區（pinnedTop 模式；banner 模式下若未關閉橫幅則不重複列出置頂） */}
            {displayMethod === "pinnedTop" &&
              items.filter((item) => item.pinned).length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-bold text-success mb-2">置頂公告</h4>
                  <ul className="space-y-3">
                    {items
                      .filter((item) => item.pinned)
                      .map((item) => (
                        <AnnouncementCard
                          key={item.id}
                          item={item}
                          remindersEnabled={remindersEnabled}
                          toggling={togglingReminder === item.id}
                          onToggleReminder={toggleReminder}
                        />
                      ))}
                  </ul>
                </div>
              )}

            {/* 一般清單：置頂優先（伺服器已排序）；banner 模式過濾已顯示於橫幅者 */}
            <ul className="space-y-3">
              {items
                .filter((item) => {
                  if (displayMethod === "banner" && item.pinned) {
                    return dismissedBanners.includes(item.id);
                  }
                  if (displayMethod === "pinnedTop" && item.pinned) return false;
                  return true;
                })
                .map((item) => (
                  <AnnouncementCard
                    key={item.id}
                    item={item}
                    remindersEnabled={remindersEnabled}
                    toggling={togglingReminder === item.id}
                    onToggleReminder={toggleReminder}
                  />
                ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function AnnouncementCard({
  item,
  remindersEnabled,
  toggling,
  onToggleReminder,
}: {
  item: AnnouncementInboxItem;
  remindersEnabled: boolean;
  toggling: boolean;
  onToggleReminder: (id: string) => void;
}) {
  return (
    <li className="border border-themed rounded-lg bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-bold text-t1">{item.title}</h4>
        <div className="flex shrink-0 gap-1.5">
          {item.pinned && (
            <span className="text-xs text-success border border-success rounded px-1.5 py-0.5">
              置頂
            </span>
          )}
          {item.expiringSoon && (
            <span className="text-xs text-danger border border-danger rounded px-1.5 py-0.5">
              即將到期
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-t3 mt-1">
        {item.categoryName}｜{item.authorName}
        {item.classScoped ? `｜班級公告` : "｜校級"}
        {item.publishAt ? `｜${new Date(item.publishAt).toLocaleString("zh-TW")}` : ""}
      </p>
      <p className="text-sm text-t2 mt-2 whitespace-pre-wrap">{item.body}</p>
      {remindersEnabled && (
        <div className="mt-3">
          <button
            type="button"
            disabled={toggling}
            onClick={() => onToggleReminder(item.id)}
            className={
              item.reminded
                ? "btn-danger rounded px-2.5 py-1 text-xs cursor-pointer disabled:opacity-50"
                : "btn-soft rounded px-2.5 py-1 text-xs cursor-pointer disabled:opacity-50"
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
