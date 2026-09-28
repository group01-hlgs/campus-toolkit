import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { DEFAULT_SYSTEM_NAME } from "@/types/settings";

/**
 * TOTP（RFC 6238）實作：HMAC-SHA1、30 秒間隔、T±1 容差。
 * 與舊 GAS 站 auth.js 的 totpVerify()/totpGenerateSecret() 行為一致。
 * 純函式，不碰資料庫；防重放在 lib/two-factor.ts 處理。
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE32_ALPHABET.length; i += 1) {
  BASE32_LOOKUP[BASE32_ALPHABET[i]] = i;
}
// RFC 4648 亦接受小寫與 "=" padding
for (let i = 0; i < BASE32_ALPHABET.length; i += 1) {
  BASE32_LOOKUP[BASE32_ALPHABET[i].toLowerCase()] = i;
}

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** 產生 Base32 密鑰（預設 20 bytes = 16 字元，Google Authenticator 慣用長度） */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/g, "").replace(/\s+/g, "");
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const idx = BASE32_LOOKUP[char];
    if (idx === undefined) throw new Error("無效的 Base32 字元");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

function counterToBytes(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

function hotp(secret: string, counter: number): string {
  const key = Buffer.from(base32Decode(secret));
  const digest = createHmac("sha1", key).update(counterToBytes(counter)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** 取得指定時間的 6 組數字驗證碼（驗證頁的 30 秒倒數用） */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(secret, counter);
}

/** 驗證碼比對（含 T±1 容差），以 timingSafeEqual 比對避免時序側漏 */
export function verifyTotpCode(
  secret: string,
  code: unknown,
  window = 1,
  atMs: number = Date.now()
): boolean {
  if (typeof code !== "string") return false;
  const normalized = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) return false;

  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  const provided = Buffer.from(normalized);

  for (let step = -window; step <= window; step += 1) {
    const candidate = Buffer.from(hotp(secret, counter + step));
    if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) {
      return true;
    }
  }
  return false;
}

/** otpauth:// 連結，供前端產生 QR Code（金鑰不出伺服器之外的這條 URL） */
export function buildOtpauthUrl(options: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = options.issuer || DEFAULT_SYSTEM_NAME;
  // 標籤格式為 issuer:account（colon 保留、兩段各自編碼，驗證器 App 皆可解析）
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(options.account)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
