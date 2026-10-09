"use client";

/** 純前端切片：回目前頁次的資料（不增加任何資料庫讀取） */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, pageSize);
  const start = (Math.max(1, page) - 1) * size;
  return items.slice(start, start + size);
}

/** 依總筆數與每頁筆數算總頁數（至少 1 頁） */
export function totalPagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/**
 * 通用分頁列（受控元件）：每頁筆數選擇＋第一頁／上一頁／頁次／下一頁／最後一頁。
 * 外觀比照帳號／名冊清單的分頁列；`total === 0` 或只剩一頁時不渲染頁次控制。
 * 用法：資料在呼叫端自行切片（`paginate`），翻頁不增加任何 Firestore 讀取。
 */
export default function ListPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 20, 50, 100],
  idPrefix = "list",
  className = "",
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  idPrefix?: string;
  className?: string;
}) {
  if (total <= 0) return null;
  const totalPages = totalPagesOf(total, pageSize);
  const current = Math.min(Math.max(1, page), totalPages);
  const sizeId = `${idPrefix}-page-size`;

  return (
    <div
      className={`w-full flex flex-wrap items-center justify-between gap-3 text-sm text-t2 ${className}`}
    >
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <>
            <label htmlFor={sizeId}>每頁</label>
            <select
              id={sizeId}
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="input-theme rounded px-2 py-1 cursor-pointer"
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </>
        )}
        <span>
          {onPageSizeChange ? "筆，" : ""}共 {total} 筆
        </span>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={current <= 1}
            className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
          >
            第一頁
          </button>
          <button
            type="button"
            onClick={() => onPageChange(current - 1)}
            disabled={current <= 1}
            className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
          >
            上一頁
          </button>
          <span>
            第 {current} / {totalPages} 頁
          </span>
          <button
            type="button"
            onClick={() => onPageChange(current + 1)}
            disabled={current >= totalPages}
            className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
          >
            下一頁
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={current >= totalPages}
            className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
          >
            最後一頁
          </button>
        </div>
      )}
    </div>
  );
}
