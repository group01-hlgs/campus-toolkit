export function clampCostFactor(value: unknown, fallback = 12): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded < 4) return 4;
  if (rounded > 15) return 15;
  return rounded;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.toLowerCase().trim();
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export function normalizeAccount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const account = value.toLowerCase().trim();
  if (!account || account.length < 2 || account.length > 64) return null;
  if (!/^[a-z0-9._@-]+$/.test(account)) return null;
  return account;
}

/** 電子郵件格式是否正確（不含空白值判定，空白是否允許由各頁面自行決定） */
export function isValidEmail(value: unknown): boolean {
  return normalizeEmail(value) !== null;
}

/** 帳號格式是否正確（不含空白值判定，空白是否允許由各頁面自行決定） */
export function isValidAccount(value: unknown): boolean {
  return normalizeAccount(value) !== null;
}

/** 帳密管理卡即時驗證訊息（客戶端與伺服器共用，兩側文字需一致） */
export const EMAIL_FORMAT_MESSAGE = "電子郵件格式無效，例如 name@example.com";
export const ACCOUNT_FORMAT_MESSAGE =
  "帳號格式無效：2-64 字元，限小寫英文、數字與 . _ @ -";
/** 電子郵件地址與帳號可個別留空，但不可同時為空（至少保留一項作為登入識別） */
export const ACCOUNT_EMAIL_REQUIRED_MESSAGE =
  "電子郵件地址與帳號至少需保留一項，不可同時為空";

const COMMON_WEAK_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "passw0rd",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "admin123",
  "letmein1",
  "welcome1",
  "abc12345",
  "11111111",
  "00000000",
  "aaaaaaaa",
]);

/**
 * 密碼強度：至少 8 碼、至少兩種字元類別（字母／數字／符號）、擋常見弱密碼。
 * 客戶端與伺服器共用此檢查，兩側訊息需一致。
 */
export function isStrongPassword(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 8 || value.length > 128) return false;
  if (COMMON_WEAK_PASSWORDS.has(value.toLowerCase())) return false;

  const hasLetter = /[a-zA-Z]/.test(value);
  const hasDigit = /[0-9]/.test(value);
  const hasSymbol = /[^a-zA-Z0-9]/.test(value);
  const classes = [hasLetter, hasDigit, hasSymbol].filter(Boolean).length;
  return classes >= 2;
}

export const PASSWORD_REQUIREMENT_MESSAGE = "密碼至少 8 碼，且需包含字母與數字";
