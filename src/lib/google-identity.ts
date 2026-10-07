/**
 * Google Identity Services（GIS）前端輔助：不開彈出視窗取得 Google ID token。
 *
 * 為什麼不用 signInWithPopup：Firebase 的 popup 流程不論是否授權過，每次都會開一個視窗；
 * GIS 則在原頁以瀏覽器內建帳號選擇（FedCM）或自動登入（auto_select）完成，
 * 已授權過的使用者通常「不會看到任何視窗」，行為與一般 PHP 網站的 Google 登入一致。
 *
 * 流程：requestGoogleIdToken() 取得 Google ID token → 呼叫端以
 * `signInWithCredential(auth, GoogleAuthProvider.credential(token))` 換成 Firebase ID token，
 * 其後與原本一致送 /api/auth/google（伺服端驗證不變）。
 *
 * 需要設定 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`（Firebase 的 Google 登入用的 Web client ID），
 * 且該 OAuth 用戶端的「已授權的 JavaScript 來源」須包含網站網域。未設定或 GIS 不可用時回
 * `unavailable`，呼叫端應退回 signInWithPopup。
 */

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GsiNotification {
  isNotDisplayed(): boolean;
  isSkippedMoment(): boolean;
  isDismissedMoment(): boolean;
  getDismissedReason?(): string;
}

interface GsiCredentialResponse {
  credential?: string;
}

interface GsiId {
  initialize(config: {
    client_id: string;
    callback: (response: GsiCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  prompt(listener?: (notification: GsiNotification) => void): void;
  cancel(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

export type GoogleIdentityResult =
  | { status: "ok"; idToken: string }
  /** 使用者主動關閉帳號選擇：不應再退回彈窗 */
  | { status: "cancelled" }
  /** GIS 無法使用（未設定、載入失敗、被冷卻／封鎖）：呼叫端退回彈窗登入 */
  | { status: "unavailable" };

let scriptPromise: Promise<void> | null = null;
let initializedClientId: string | null = null;
let pendingResolve: ((result: GoogleIdentityResult) => void) | null = null;

function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("GIS script load failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** 使用者主動結束（而非系統略過）的關閉原因 */
const USER_CANCEL_REASONS = ["user_cancel", "tap_outside", "cancel_called"];

export async function requestGoogleIdToken(clientId: string): Promise<GoogleIdentityResult> {
  if (!clientId || typeof window === "undefined") return { status: "unavailable" };
  try {
    await loadGsiScript();
  } catch {
    return { status: "unavailable" };
  }
  const gsi = window.google?.accounts?.id;
  if (!gsi) return { status: "unavailable" };

  if (initializedClientId !== clientId) {
    gsi.initialize({
      client_id: clientId,
      callback: (response) => {
        const resolve = pendingResolve;
        pendingResolve = null;
        if (!resolve) return;
        resolve(
          response.credential
            ? { status: "ok", idToken: response.credential }
            : { status: "unavailable" }
        );
      },
      // 已授權且僅有一個 Google 工作階段時自動完成，不需點選
      auto_select: true,
      cancel_on_tap_outside: false,
      // 以瀏覽器內建（FedCM）帳號選擇取代 One Tap 浮層／彈窗
      use_fedcm_for_prompt: true,
    });
    initializedClientId = clientId;
  }

  return new Promise<GoogleIdentityResult>((resolve) => {
    // 取消上一次尚未完成的請求
    pendingResolve?.({ status: "unavailable" });
    pendingResolve = resolve;

    gsi.prompt((notification) => {
      if (pendingResolve !== resolve) return;

      if (notification.isDismissedMoment()) {
        const reason = notification.getDismissedReason?.() ?? "";
        // credential_returned：callback 會接手，這裡不處理
        if (reason === "credential_returned") return;
        pendingResolve = null;
        resolve(
          USER_CANCEL_REASONS.includes(reason)
            ? { status: "cancelled" }
            : { status: "unavailable" }
        );
        return;
      }

      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        pendingResolve = null;
        resolve({ status: "unavailable" });
      }
    });
  });
}
