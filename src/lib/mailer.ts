import "server-only";
import nodemailer, { Transporter } from "nodemailer";
import { DEFAULT_SYSTEM_NAME } from "@/types/settings";

/**
 * SMTP 寄信模組（Gmail 應用程式密碼 / 任何 SMTP 服務皆可）。
 * 必要環境變數：
 *   SMTP_HOST  例如 smtp.gmail.com
 *   SMTP_USER  寄信帳號
 *   SMTP_PASS  應用程式密碼（Google 帳號 → 登入與安全性 → 應用程式密碼）
 * 選用：
 *   SMTP_PORT  預設 465（SMTP_SECURE=true 時）或 587
 *   SMTP_SECURE "true"/"false"，未設時以 port===465 判斷
 *   SMTP_FROM  寄件者顯示名稱，預設 "數位校園工具箱 <SMTP_USER>"
 */

export function isMailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

let transportPromise: Promise<Transporter> | null = null;

async function getTransport(): Promise<Transporter> {
  if (!transportPromise) {
    transportPromise = (async () => {
      const host = process.env.SMTP_HOST;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      if (!host || !user || !pass) {
        throw new Error("SMTP 環境變數未設定（SMTP_HOST / SMTP_USER / SMTP_PASS）");
      }
      const port = Number(process.env.SMTP_PORT) || (process.env.SMTP_SECURE === "false" ? 587 : 465);
      const secure =
        process.env.SMTP_SECURE !== undefined
          ? process.env.SMTP_SECURE === "true"
          : port === 465;

      return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        // 校園 Gmail 常見需要；其他 SMTP 若不支援 STARTTLS 會被忽略
        requireTLS: secure || port === 587,
      });
    })();
    // 設定錯誤時清除快取，讓修正環境變數後不需重啟
    transportPromise.catch(() => {
      transportPromise = null;
    });
  }
  return transportPromise;
}

/** 跳脫使用者可控字串，避免 displayName / 學校名稱夾帶 HTML 造成信件注入 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 信件抬頭識別：系統（程式）名稱與學校名稱併列，
 * 例如「數位校園工具箱｜臺一國小」，讓收件人一眼看出信件來自哪個系統。
 * 學校名稱未填時只顯示系統名稱。
 */
function brandLabel(systemName?: string, schoolName?: string): string {
  const system = systemName?.trim() || DEFAULT_SYSTEM_NAME;
  const school = schoolName?.trim() || "";
  return school && school !== system ? `${system}｜${school}` : system;
}

export interface PasswordResetMailOptions {
  /** 收件人（已正規化的電子郵件） */
  to: string;
  /** 收件人顯示名稱，可為空 */
  displayName?: string;
  /**
   * 本次要重設的身分（學生／家長／教職員／管理員）。
   * 同一信箱可能同時存在多個身分（種子帳號即共用一個信箱），
   * 信件列出身分讓收件人確認這封信要重設的是哪個帳號。
   */
  roleLabel?: string;
  /** 一次性重設連結（含 token） */
  resetUrl: string;
  /** 有效期限（分鐘） */
  expiresMinutes: number;
  /** 系統（程式）名稱，未提供時用預設系統名稱 */
  systemName?: string;
  /** 學校名稱，與系統名稱併列於信件抬頭（可為空） */
  schoolName?: string;
}

export async function sendPasswordResetEmail(
  options: PasswordResetMailOptions
): Promise<void> {
  const transport = await getTransport();
  const brand = brandLabel(options.systemName, options.schoolName);
  const brandHtml = escapeHtml(brand);
  const from =
    process.env.SMTP_FROM?.trim() ||
    `${brand} <${process.env.SMTP_USER}>`;

  const greeting = options.displayName ? `${options.displayName} 您好` : "您好";
  const resetUrl = escapeHtml(options.resetUrl);
  const expiresMinutes = escapeHtml(String(options.expiresMinutes));

  // 身分列（未提供時整個區塊不出現，純文字與 HTML 同步）
  const roleText = options.roleLabel
    ? [`本次重設的身分：${options.roleLabel}`, ""]
    : [];
  const roleBox = options.roleLabel
    ? `    <div style="margin:0 0 20px;padding:10px 14px;background:#f3f4f6;border-radius:8px;font-size:14px;color:#374151;">
      本次重設的身分：<strong style="color:#111827;">${escapeHtml(options.roleLabel)}</strong>
    </div>
`
    : "";

  const text = [
    `${greeting}：`,
    "",
    ...roleText,
    `我們收到 ${brand} 的密碼重設請求。`,
    `請在 ${options.expiresMinutes} 分鐘內點擊以下連結設定新密碼：`,
    options.resetUrl,
    "",
    `連結將於 ${options.expiresMinutes} 分鐘後失效，且僅能使用一次。`,
    "若非本人操作，請忽略這封信件，您的密碼不會被變更。",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,'Segoe UI','Noto Sans TC',Arial,sans-serif;color:#1f2328;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 4px;font-size:20px;">${brandHtml}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">密碼重設信件</p>
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}：</p>
${roleBox}    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">
      我們收到您在 ${brandHtml} 的密碼重設請求。請在 <strong>${expiresMinutes} 分鐘</strong>內點擊下方按鈕設定新密碼。
    </p>
    <p style="margin:0 0 24px;">
      <a href="${resetUrl}"
         style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;">
        重設密碼
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.7;">
      連結將於 ${expiresMinutes} 分鐘後失效，且僅能使用一次。<br />
      若按鈕無法點擊，請複製以下網址至瀏覽器開啟：<br />
      <span style="word-break:break-all;color:#2563eb;">${resetUrl}</span>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
      若非本人操作，請忽略這封信件，您的密碼不會被變更。
    </p>
  </div>
</body>
</html>`.trim();

  await transport.sendMail({
    from,
    to: options.to,
    subject: `【${brand}】密碼重設（${options.expiresMinutes} 分鐘內有效）`,
    text,
    html,
  });
}

export interface LoginOtpMailOptions {
  to: string;
  displayName?: string;
  /** 6 位數登入驗證碼 */
  code: string;
  /** 系統（程式）名稱，未提供時用預設系統名稱 */
  systemName?: string;
  /** 學校名稱，與系統名稱併列於信件抬頭（可為空） */
  schoolName?: string;
  roleLabel?: string;
  expiresInMinutes: number;
}

/** 兩階段驗證：電子郵件驗證碼信 */
export async function sendLoginOtpEmail(options: LoginOtpMailOptions): Promise<void> {
  const transport = await getTransport();
  const brand = brandLabel(options.systemName, options.schoolName);
  const brandHtml = escapeHtml(brand);
  const from =
    process.env.SMTP_FROM?.trim() ||
    `${brand} <${process.env.SMTP_USER}>`;
  const greeting = options.displayName ? `${options.displayName} 您好` : "您好";
  const roleText = options.roleLabel ? `身分：${options.roleLabel}` : "";

  const text = [
    `${greeting}：`,
    "",
    `您的 ${brand} 登入驗證碼為：${options.code}`,
    ...(roleText ? [roleText] : []),
    `驗證碼 ${options.expiresInMinutes} 分鐘內有效。`,
    "",
    "若非本人登入，請立即變更密碼並忽略這封信件。",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,'Segoe UI','Noto Sans TC',Arial,sans-serif;color:#1f2328;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 4px;font-size:20px;">${brandHtml}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">登入驗證碼</p>
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}：</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">
      您的登入驗證碼是：${roleText ? `<br />${escapeHtml(roleText)}` : ""}
    </p>
    <p style="margin:0 0 24px;font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;background:#f3f4f6;border-radius:8px;padding:16px 0;">
      ${escapeHtml(options.code)}
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.7;">
      驗證碼 ${options.expiresInMinutes} 分鐘內有效，逾時請重新登入取得。<br />
      若非本人登入，請立即變更密碼並忽略這封信件。
    </p>
  </div>
</body>
</html>`.trim();

  await transport.sendMail({
    from,
    to: options.to,
    subject: `【${brand}】登入驗證碼 ${options.code}（${options.expiresInMinutes} 分鐘內有效）`,
    text,
    html,
  });
}

export interface LoginNotificationMailOptions {
  to: string;
  displayName?: string;
  /** 系統（程式）名稱，未提供時用預設系統名稱 */
  systemName?: string;
  /** 學校名稱，與系統名稱併列於信件抬頭（可為空） */
  schoolName?: string;
  roleLabel?: string;
  /** 登入時間（本機時間） */
  time: Date;
}

/** 兩階段驗證：電子郵件發送登入通知信（不阻擋登入） */
export async function sendLoginNotificationEmail(
  options: LoginNotificationMailOptions
): Promise<void> {
  const transport = await getTransport();
  const brand = brandLabel(options.systemName, options.schoolName);
  const brandHtml = escapeHtml(brand);
  const from =
    process.env.SMTP_FROM?.trim() ||
    `${brand} <${process.env.SMTP_USER}>`;
  const greeting = options.displayName ? `${options.displayName} 您好` : "您好";
  const roleText = options.roleLabel ? `（身分：${options.roleLabel}）` : "";
  const timeText = options.time.toLocaleString("zh-TW", { hour12: false });

  const text = [
    `${greeting}：`,
    "",
    `您的帳號${roleText}於 ${timeText} 登入 ${brand}。`,
    "",
    "若您本人並未進行此次登入，請立即變更密碼並檢查帳號的登入紀錄與安全性設定。",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,'Segoe UI','Noto Sans TC',Arial,sans-serif;color:#1f2328;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 4px;font-size:20px;">${brandHtml}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">登入通知</p>
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}：</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;">
      您的帳號${escapeHtml(roleText)}於
      <strong style="color:#111827;">${escapeHtml(timeText)}</strong>
      登入 ${brandHtml}。
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.7;">
      若您本人並未進行此次登入，請立即變更密碼並檢查帳號的登入紀錄與安全性設定。
    </p>
  </div>
</body>
</html>`.trim();

  await transport.sendMail({
    from,
    to: options.to,
    subject: `【${brand}】登入通知（${timeText}）`,
    text,
    html,
  });
}
