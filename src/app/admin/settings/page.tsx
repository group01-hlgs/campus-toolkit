"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, defaultSettings } from "@/types/settings";
import { logout } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HelpTooltip from "@/components/HelpTooltip";
import { builtinThemes } from "@/lib/themes";

interface FormField {
  id: keyof Settings;
  label: string;
  type: "text" | "number" | "select" | "email";
  placeholder?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

interface SettingGroup {
  title: string;
  icon: React.ReactNode;
  fields: FormField[];
}

const themeOptions = [
  { value: "", label: "不強制（用戶可自行選擇）" },
  ...builtinThemes.map((t) => ({ value: t.id, label: t.name })),
];

const settingGroups: SettingGroup[] = [
  {
    title: "基本資訊",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
    fields: [
      { id: "systemName", label: "系統自命名", type: "text", placeholder: "" },
      { id: "schoolFullName", label: "學校全稱", type: "text", placeholder: "" },
      { id: "schoolShortName", label: "學校簡稱", type: "text", placeholder: "" },
      { id: "schoolOtherNames", label: "學校其他別名", type: "text", placeholder: "" },
      { id: "academicYear", label: "學年度", type: "number" },
      {
        id: "semester",
        label: "學期",
        type: "select",
        options: [
          { value: "1", label: "第1學期" },
          { value: "2", label: "第2學期" },
        ],
      },
      { id: "schoolCode", label: "教育部學校代碼", type: "text", placeholder: "" },
    ],
  },
  {
    title: "承辦聯絡",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
    fields: [
      { id: "contactPerson", label: "系統承辦人員", type: "text", placeholder: "" },
      { id: "contactEmail", label: "承辦人員電子郵件", type: "email", placeholder: "" },
    ],
  },
  {
    title: "系統管理",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    fields: [
      {
        id: "systemEnabled",
        label: "系統狀態",
        type: "select",
        options: [
          { value: "true", label: "啟用" },
          { value: "false", label: "停用" },
        ],
      },
      {
        id: "oauthEnabled",
        label: "啟用 Google OAuth",
        type: "select",
        options: [
          { value: "true", label: "啟用" },
          { value: "false", label: "停用" },
        ],
      },
      {
        id: "sessionTimeout",
        label: "閒置逾時（分鐘）",
        type: "number",
        help: "登入後閒置不用逾時將自動登出",
      },
      {
        id: "emailChangeAllowed",
        label: "開放使用者更換電子郵件地址",
        type: "select",
        options: [
          { value: "true", label: "開放" },
          { value: "false", label: "不開放" },
        ],
        help: "適用所有身分：已有電子郵件地址者受此限制；尚無地址者僅能新增一次，新增時會提醒日後是否開放修改",
      },
    ],
  },
  {
    title: "總量管制",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    fields: [
      {
        id: "dataSaverEnabled",
        label: "省流開關",
        type: "select",
        options: [
          { value: "true", label: "啟用" },
          { value: "false", label: "停用" },
        ],
        help: "提供採用免費架構網站的夥伴勉強使用",
      },
    ],
  },
  {
    title: "外觀與顯示",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
    ),
    fields: [
      {
        id: "cssThemeId",
        label: "強制主題",
        type: "select",
        options: themeOptions,
      },
      {
        id: "copyrightNotice",
        label: "原創版權宣告",
        type: "select",
        options: [
          { value: "true", label: "顯示" },
          { value: "false", label: "隱藏" },
        ],
      },
      {
        id: "sponsorAdEnabled",
        label: "贊助廣告",
        type: "select",
        options: [
          { value: "true", label: "顯示" },
          { value: "false", label: "隱藏" },
        ],
      },
    ],
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  // 是否可設定：僅超級管理員；一般管理員與其他身分只有入口、頁內無可用設定項目
  const [manageable, setManageable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.success && data.settings) {
          setManageable(Boolean(data.manageable));
          const mergedSettings = { ...defaultSettings, ...data.settings };
          setSettings(mergedSettings);

          // 同步強制主題到 localStorage
          if (mergedSettings.cssThemeId) {
            localStorage.setItem("campusToolkitForcedTheme", mergedSettings.cssThemeId);
          } else {
            localStorage.removeItem("campusToolkitForcedTheme");
          }
        }
      }
    } catch (error: unknown) {
      console.error("載入設定失敗:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setModalMessage("載入失敗: " + errMsg);
      setShowModal(true);
      setTimeout(() => setShowModal(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!manageable || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "儲存失敗");
      }
      if (data.settings) setSettings({ ...defaultSettings, ...data.settings });

      // 同步強制主題到 localStorage
      if (settings.cssThemeId) {
        localStorage.setItem("campusToolkitForcedTheme", settings.cssThemeId);
      } else {
        localStorage.removeItem("campusToolkitForcedTheme");
      }

      setModalMessage("設定已儲存！");
      setShowModal(true);
      setTimeout(() => setShowModal(false), 3000);
    } catch (error: unknown) {
      console.error("儲存設定失敗:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setModalMessage("儲存失敗: " + errMsg);
      setShowModal(true);
      setTimeout(() => setShowModal(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    router.push("/admin");
  }

  function handleLogout() {
    void logout();
    router.push("/");
  }

  function getFieldValue(id: keyof Settings): string {
    const val = settings[id];
    if (typeof val === "boolean") return val ? "true" : "false";
    return String(val);
  }

  function handleChange(id: keyof Settings, value: string) {
    const booleanFields: (keyof Settings)[] = [
      "systemEnabled", "oauthEnabled", "emailChangeAllowed",
      "copyrightNotice", "sponsorAdEnabled", "dataSaverEnabled",
    ];
    const numberFields: (keyof Settings)[] = [
      "academicYear", "semester", "sessionTimeout",
    ];

    if (booleanFields.includes(id)) {
      setSettings({ ...settings, [id]: value === "true" });
    } else if (numberFields.includes(id)) {
      let numVal = Number(value);
      if (id === "sessionTimeout") numVal = Math.max(1, numVal);
      setSettings({ ...settings, [id]: numVal });
    } else {
      setSettings({ ...settings, [id]: value });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-t3">載入中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-page px-4 pt-[20px]">
      {/* 標題區域 */}
      <div className="text-center mb-2">
        <h1 className="text-4xl font-bold mb-2">{settings.systemName || "數位校園工具箱"}</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      {/* 功能標題 */}
      <div className="w-full max-w-2xl mt-4 mb-2 text-center">
        <h2 className="text-2xl font-bold text-t1">系統設定</h2>
      </div>

      {/* 操作按鈕 */}
      <div className="w-full max-w-2xl flex justify-end gap-3 mb-4">
        {manageable && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
          >
            {saving ? "儲存中..." : "儲存設定"}
          </button>
        )}
        <button
          onClick={handleBack}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回功能首頁
        </button>
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      <hr className="w-full max-w-2xl border-themed mb-4" />

      {/* 設定分組卡片：僅超級管理員可設定，其餘顯示「尚無可用設定項目」 */}
      {manageable ? (
        <div className="w-full max-w-2xl space-y-4 mb-8">
          {settingGroups.map((group) => (
            <div key={group.title} className="border border-themed rounded-lg p-5 bg-card">
              {/* 分組標題 */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-t3">{group.icon}</span>
                <h3 className="text-lg font-bold text-t1">{group.title}</h3>
              </div>

              {/* 欄位列表 */}
              <div className="space-y-4">
                {group.fields.map((field) => (
                  <div key={field.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <label className="text-t2 sm:w-48 shrink-0 flex items-center gap-1.5">
                      <span>{field.label}</span>
                      {field.help && <HelpTooltip text={field.help} />}
                    </label>
                    {field.type === "select" ? (
                      <select
                        value={getFieldValue(field.id)}
                        onChange={(e) => handleChange(field.id, e.target.value)}
                        className="flex-1 input-theme rounded px-3 py-2"
                      >
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        value={String(settings[field.id])}
                        onChange={(e) => handleChange(field.id, e.target.value)}
                        placeholder={field.placeholder}
                        className="flex-1 input-theme rounded px-3 py-2"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full max-w-2xl border border-themed rounded-lg p-8 bg-card text-center space-y-2 mb-8">
          <p className="text-lg font-bold text-t1">尚無可用設定項目</p>
          <p className="text-sm text-t2">
            此帳號目前沒有可使用的系統設定項目；如需調整系統設定，請洽超級管理員。
          </p>
        </div>
      )}

      <hr className="w-full max-w-2xl border-themed mb-4" />

      {/* 底部操作按鈕 */}
      <div className="w-full max-w-2xl flex justify-start gap-3 mb-8">
        {manageable && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
          >
            {saving ? "儲存中..." : "儲存設定"}
          </button>
        )}
        <button
          onClick={handleBack}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          返回功能首頁
        </button>
        <button
          onClick={handleLogout}
          className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
        >
          登出
        </button>
      </div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-2xl">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="w-full max-w-2xl mt-auto">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {/* Modal 訊息視窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}>
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in">
            <div className="flex justify-center">
              {modalMessage.includes("失敗") ? (
                <svg className="w-12 h-12 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              ) : (
                <svg className="w-12 h-12 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <p className={`text-lg font-semibold ${modalMessage.includes("失敗") ? "text-danger" : "text-t1"}`}>
              {modalMessage}
            </p>
            <p className="text-xs text-t3">視窗將自動關閉</p>
          </div>
        </div>
      )}
    </div>
  );
}
