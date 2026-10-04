/**
 * 用戶端安全讀取 API 回應：Vercel 逾時（504）等錯誤回的是純文字或 HTML，
 * 直接 res.json() 會拋出難解的 JSON 解析錯誤；先讀成文字再解析，
 * 依 status／內容給出可讀的中文訊息。回應為合法 JSON 時原樣返回，
 * 仍由呼叫端檢查 res.ok 與 data.success。
 */
export async function readJsonResponse<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (res.status === 504 || text.includes("FUNCTION_INVOCATION_TIMEOUT")) {
      throw new Error("伺服器處理逾時（超過 300 秒），請稍後重新執行");
    }
    throw new Error(`伺服器回應異常（HTTP ${res.status || "未知"}），請稍後再試`);
  }
}
