"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup, signInWithCredential, GoogleAuthProvider } from "firebase/auth";
import { auth, googleProvider, ensureSignedOut } from "@/lib/firebase";
import { requestGoogleIdToken } from "@/lib/google-identity";
import { Settings, defaultSettings } from "@/types/settings";
import { UserRole, ROLE_HOME, isUserRole } from "@/types/users";
import { fetchSession, setCachedSession, UserSession } from "@/lib/session";
import Copyright from "@/components/Copyright";
import AdSense from "@/components/AdSense";
import HomepageCornerWrench from "@/components/HomepageCornerWrench";
import HomepageCornerChangE from "@/components/HomepageCornerChangE";
import HomepageCornerExam from "@/components/HomepageCornerExam";
import AnnouncementSurface from "@/components/AnnouncementSurface";
import CalendarSurface from "@/components/CalendarSurface";
import { fetchSettings } from "@/lib/settings-client";

/** 本頁生命週期內 GIS 已確定不可用（冷卻／封鎖／交換失敗）：後續點擊直接走彈窗 */
let gisUnavailable = false;

type ApiResponse = {
  success?: boolean;
  message?: string;
  /** 帳密驗證通過但需完成第二階段驗證（email_otp / totp） */
  requires2FA?: string;
  /** 帳號同時存在於多個身分且未設定慣用身分：需先選擇要登入的身分（密碼已驗證） */
  requiresRoleChoice?: string[];
  maskedEmail?: string;
  user?: {
    uid?: string;
    email?: string;
    account?: string;
    displayName?: string;
    role?: string;
    roles?: string[];
    /** 首次登入須先改密碼（管理員代設的預設密碼） */
    mustChangePassword?: boolean;
  };
};

/** 第二階段驗證方式 → 對應驗證頁路徑（非第二階段回 null） */
function twoFactorPage(requires: string | undefined): string | null {
  if (requires === "email_otp") return "/verify-code";
  if (requires === "totp") return "/verify-totp";
  return null;
}

async function parseApiResponse(response: Response): Promise<ApiResponse | null> {
  const raw = await response.text();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ApiResponse;
  } catch (error) {
    console.error("API JSON 解析失敗:", error);
    return null;
  }
}

function getErrorMessage(data: ApiResponse | null, fallback: string): string {
  return typeof data?.message === "string" && data.message ? data.message : fallback;
}

/** 多身分回應：登入（含兩階段驗證）已通過，需到選擇身分頁決定要進入的身分 */
function needsRoleChoice(data: ApiResponse | null): boolean {
  return Array.isArray(data?.requiresRoleChoice) && data.requiresRoleChoice.length > 0;
}

const LAST_GOOGLE_EMAIL_STORAGE_KEY = "lastGoogleLoginEmail";

function getLastGoogleLoginEmail(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_GOOGLE_EMAIL_STORAGE_KEY) || "";
}

function setLastGoogleLoginEmail(email: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_GOOGLE_EMAIL_STORAGE_KEY, email);
}

export default function Home() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSession(true).then((session) => {
      if (cancelled) return;
      if (session && isUserRole(session.role)) {
        router.push(ROLE_HOME[session.role]);
        return;
      }
      setCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const data = await fetchSettings();
        if (cancelled) return;
        if (data?.success && data.settings) {
          setSettings({ ...defaultSettings, ...data.settings });
        }
      } catch (error) {
        console.error("載入設定失敗:", error);
      }
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 帳密登入。身分由伺服器查找；
   * 多身分且未設定慣用身分時伺服器回 requiresRoleChoice，導向選擇身分頁。
   */
  async function handleLogin() {
    if (!account || !password) {
      setError("請輸入帳號與密碼");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password }),
      });
      const data = await parseApiResponse(res);

      // 同一帳號具備多個身分：登入已通過，導向選擇身分頁
      if (needsRoleChoice(data)) {
        router.push("/choose-role");
        return;
      }

      // 需要第二階段驗證：驗證頁接手，此處不建立前端 session 快取
      const verifyPage = twoFactorPage(data?.requires2FA);
      if (verifyPage) {
        router.push(verifyPage);
        return;
      }

      if (!res.ok || !data?.success || !data.user) {
        setError(getErrorMessage(data, `登入失敗（HTTP ${res.status}）`));
        setLoading(false);
        return;
      }

      if (typeof data.user.uid !== "string" || !data.user.uid) {
        setError("登入回應格式錯誤，請稍後再試");
        setLoading(false);
        return;
      }

      if (!isUserRole(data.user.role)) {
        setError("登入回應格式錯誤，請稍後再試");
        setLoading(false);
        return;
      }

      const user: UserSession = {
        uid: data.user.uid,
        email: data.user.email || "",
        account: data.user.account || "",
        displayName: data.user.displayName || "",
        role: data.user.role,
        roles: Array.isArray(data.user.roles)
          ? (data.user.roles.filter(isUserRole) as UserRole[])
          : [data.user.role],
        // 首次登入須先改密碼：登入後立即顯示全螢幕遮罩
        mustChangePassword: data.user.mustChangePassword === true,
      };
      setCachedSession(user);

      const home = ROLE_HOME[user.role] || "/";
      router.push(home);
    } catch {
      setError("系統錯誤，請稍後再試");
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleLogin();
    }
  }

  /** 開啟 Google 登入視窗取得 ID token；失敗時自行處理錯誤並回 null */
  async function acquireGoogleToken(): Promise<{ idToken: string; email: string } | null> {
    if (!auth) {
      setError("Firebase API Key 未設定或無效，無法使用 Google 登入");
      return null;
    }

    // 優先走 Google Identity Services：已授權者不開彈出視窗（原頁自動／內建帳號選擇完成）。
    // 未設定 client id、GIS 不可用或交換失敗時，退回下方原本的 signInWithPopup。
    const googleClientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();
    if (googleClientId && !gisUnavailable) {
      const gis = await requestGoogleIdToken(googleClientId);
      if (gis.status === "cancelled") {
        setError("");
        return null;
      }
      if (gis.status === "ok") {
        try {
          const result = await signInWithCredential(
            auth,
            GoogleAuthProvider.credential(gis.idToken)
          );
          const email = result.user.email?.toLowerCase().trim();
          if (!email) {
            await ensureSignedOut();
            setError("無法取得 Google 帳號資訊");
            return null;
          }
          return { idToken: await result.user.getIdToken(), email };
        } catch (err) {
          // 常見原因：OAuth client id 與 Firebase 的 Google 登入設定不一致 → 本次退回彈窗
          console.error("GIS credential exchange failed, fallback to popup:", err);
          gisUnavailable = true;
          await ensureSignedOut();
        }
      } else {
        // GIS 被冷卻或不可用：本頁後續點擊直接走彈窗，避免失去使用者手勢
        gisUnavailable = true;
      }
    }

    const originalOpen = window.open;
    const openedWindows: Window[] = [];
    window.open = ((...args: Parameters<typeof window.open>) => {
      const win = originalOpen(...args);
      if (win) openedWindows.push(win);
      return win;
    }) as typeof window.open;

    const closeOpenedWindows = () => {
      for (const win of openedWindows) {
        try {
          if (!win.closed) win.close();
        } catch {
          // 忽略跨來源無法關閉的視窗
        }
      }
      openedWindows.length = 0;
    };

    try {
      const isMobileBrowser = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
      const initialProvider = isMobileBrowser ? new GoogleAuthProvider() : googleProvider;
      if (isMobileBrowser) {
        const hintEmail = getLastGoogleLoginEmail();
        if (hintEmail) {
          initialProvider.setCustomParameters({ login_hint: hintEmail });
        }
      }

      let result;
      try {
        result = await signInWithPopup(auth, initialProvider);
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (
          e?.code === "auth/popup-failed-user-cancelled-login-flow" ||
          e?.code === "auth/invalid-credential"
        ) {
          await ensureSignedOut();
          const retryProvider = new GoogleAuthProvider();
          retryProvider.setCustomParameters({ prompt: "select_account" });
          result = await signInWithPopup(auth, retryProvider);
        } else {
          throw err;
        }
      }
      closeOpenedWindows();
      const email = result.user.email?.toLowerCase().trim();

      if (!email) {
        await ensureSignedOut();
        setError("無法取得 Google 帳號資訊");
        return null;
      }

      const idToken = await result.user.getIdToken();
      return { idToken, email };
    } catch (err: unknown) {
      // 細節只留在 console；對外一律一般化訊息，避免揭露 Firebase 錯誤碼／設定
      console.error("Google login error:", err);
      const e = err as { code?: string };
      const code = e?.code || "";

      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setError("");
      } else if (code === "auth/popup-blocked") {
        setError("彈出視窗被瀏覽器封鎖，請允許後重試");
      } else if (code === "auth/network-request-failed") {
        setError("網路錯誤，無法連線，請稍後再試");
      } else if (code === "auth/invalid-credential") {
        setError("Google 登入失敗，請改用 Chrome / Safari 內建瀏覽器後重試");
      } else {
        setError("Google 登入失敗，請稍後再試");
      }
      return null;
    } finally {
      closeOpenedWindows();
      window.open = originalOpen;
    }
  }

  /** 以 ID token 向伺服器換取 session */
  async function postGoogleLogin(idToken: string, email: string) {
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await parseApiResponse(res);

      // 同一帳號具備多個身分：登入已通過，導向選擇身分頁
      if (needsRoleChoice(data)) {
        router.push("/choose-role");
        return;
      }

      // 需要第二階段驗證：驗證頁接手，此處不建立前端 session 快取
      const verifyPage = twoFactorPage(data?.requires2FA);
      if (verifyPage) {
        router.push(verifyPage);
        return;
      }

      if (!res.ok || !data?.success || !data.user) {
        await ensureSignedOut();
        setError(getErrorMessage(data, `Google 登入失敗（HTTP ${res.status}）`));
        setGoogleLoading(false);
        return;
      }

      if (typeof data.user.uid !== "string" || !data.user.uid) {
        await ensureSignedOut();
        setError("Google 登入回應格式錯誤，請稍後再試");
        setGoogleLoading(false);
        return;
      }

      if (!isUserRole(data.user.role)) {
        await ensureSignedOut();
        setError("Google 登入回應格式錯誤，請稍後再試");
        setGoogleLoading(false);
        return;
      }

      const user: UserSession = {
        uid: data.user.uid,
        email: data.user.email || "",
        account: data.user.account || "",
        displayName: data.user.displayName || "",
        role: data.user.role,
        roles: Array.isArray(data.user.roles)
          ? (data.user.roles.filter(isUserRole) as UserRole[])
          : [data.user.role],
        // 首次登入須先改密碼（Google 登入也可能帶旗標）：立即顯示全螢幕遮罩
        mustChangePassword: data.user.mustChangePassword === true,
      };
      setCachedSession(user);
      if (email) setLastGoogleLoginEmail(email);

      router.push(ROLE_HOME[user.role]);
    } catch {
      setError("系統錯誤，請稍後再試");
      setGoogleLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    setError("");

    const acquired = await acquireGoogleToken();
    if (!acquired) {
      setGoogleLoading(false);
      return;
    }

    await postGoogleLogin(acquired.idToken, acquired.email);
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-t3">載入中...</p>
      </div>
    );
  }

  // 系統停用（維護模式）不在此換掉整張登入卡：
  // 伺服器端（dal.verifySession、login/2fa/google 的 adminsOnly）已只放行管理員，
  // 若連登入表單都隱藏，管理員就再也進不來、無法把開關打開（自爆按鈕）。
  // 因此首頁一律保留登入入口，僅在表單上方加一行文字提醒。
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-page px-4 pt-[20px]">
      <HomepageCornerWrench />
      <HomepageCornerChangE />
      <HomepageCornerExam />
      {/* 標題區域 */}
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold mb-2">數位校園工具箱</h1>
        <p className="text-xl text-t2">{settings.schoolFullName || "學校名稱"}</p>
        <p className="text-lg text-t3">{settings.academicYear} 學年度 第{settings.semester}學期</p>
      </div>

      <hr className="w-full max-w-md border-themed mb-6" />

      {/* 系統停用提醒：僅提示、不阻擋登入，讓管理員仍可登入後到「系統設定」重新啟用 */}
      {!settings.systemEnabled && (
        <div className="w-full max-w-md border border-themed rounded-lg bg-card px-4 py-3 mb-4 text-center">
          <p className="text-t1 font-medium">系統目前暫停服務</p>
          <p className="text-t2 text-sm mt-1">目前僅有管理員登入後可以使用</p>
        </div>
      )}

      {/* 系統公告（閱讀權限＝「無」者顯示；不需登入即可閱讀） */}
      <AnnouncementSurface surface="login" className="w-full max-w-md mb-4" />

      {/* 行程（閱讀權限＝「無」者顯示；不需登入即可查閱；單一行、尚未結束的第 1 則） */}
      <CalendarSurface surface="login" className="w-full max-w-md mb-4" />

      {/* 登入表單 */}
      <div className="w-full max-w-md border border-themed rounded-lg p-8">
        <p className="text-center text-t2 mb-4">歡迎使用，請輸入帳號與密碼登入</p>

        {/* 多身分：登入通過後改以「選擇身分」專頁決定要進入的身分 */}
        <hr className="border-themed mb-6" />

        {/* 帳號密碼 */}
        <input
          type="text"
          placeholder="帳號 / 電子郵件"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full input-theme rounded px-4 py-3 mb-4"
        />
        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full input-theme rounded px-4 py-3 pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t1"
          >
            {showPassword ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>

        {error && (
          <p className="text-danger text-sm text-center mb-4">{error}</p>
        )}

        <button
          onClick={() => void handleLogin()}
          disabled={loading}
          className="w-full btn-primary rounded py-3 font-medium transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "登入中..." : "登入"}
        </button>

        <a
          href="/forgot-password"
          className="block text-center text-sm text-t3 mt-3 cursor-pointer hover:underline"
        >
          忘記密碼（同時重設驗證碼）
        </a>

        {/* Google 登入入口：依系統設定「啟用 Google OAuth」顯示；停用時連同分隔線一併隱藏 */}
        {settings.oauthEnabled && (
          <>
            {/* 分隔線 */}
            <div className="flex items-center gap-3 my-6">
              <hr className="flex-1 border-themed" />
              <span className="text-t3 text-sm">或</span>
              <hr className="flex-1 border-themed" />
            </div>

            {/* Google 登入 */}
            <button
              onClick={() => void handleGoogleLogin()}
              disabled={googleLoading || loading}
              className="w-full btn-theme rounded py-3 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.33-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {googleLoading ? "Google 登入中..." : "以 Google 帳號登入"}
            </button>
          </>
        )}
      </div>

      {/* 廣告區域 */}
      {settings.sponsorAdEnabled && (
        <div className="w-full max-w-md mt-8">
          <AdSense />
        </div>
      )}

      {/* 版權宣告 */}
      <div className="w-full max-w-md mt-8">
        <Copyright mode={settings.copyrightNotice ? "啟用" : "關閉"} />
      </div>

      {/* 登入Loading遮罩 */}
      {(loading || googleLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}>
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg">
            <div className="flex justify-center">
              <svg className="animate-spin" viewBox="0 0 24 24" width={40} height={40} fill="none" stroke="var(--t1)" strokeWidth={2} strokeLinecap="round">
                <circle cx="12" cy="12" r="10" stroke="var(--bd)" strokeWidth={2} fill="none" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth={2} />
              </svg>
            </div>
            <p className="text-base font-semibold text-t1">登入中，請稍候…</p>
            <p className="text-xs text-t3">{googleLoading ? "正在透過 Google 驗證" : "正在驗證身分"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
