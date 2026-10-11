import "server-only";
import { readSystemDoc } from "@/lib/settings-server";

export const MODULE_MARKET_INDEX_URL_FIELD = "moduleMarketIndexUrl";

function normalizeMarketUrl(candidate: string): string | null {
  const text = candidate.trim();
  if (!text) return null;

  try {
    const parsed = new URL(text);
    const isLocalhostDev =
      process.env.NODE_ENV === "development" &&
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

    if (isLocalhostDev) return parsed.toString();
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function resolveModuleMarketIndexUrl(): Promise<string | null> {
  const raw = await readSystemDoc();
  const fromSettings =
    typeof raw?.[MODULE_MARKET_INDEX_URL_FIELD] === "string"
      ? raw[MODULE_MARKET_INDEX_URL_FIELD]
      : "";
  const fromEnv = process.env.MODULE_MARKET_INDEX_URL?.trim() || process.env.MODULE_MARKET_URL?.trim() || "";
  return normalizeMarketUrl(fromSettings) || normalizeMarketUrl(fromEnv) || null;
}
