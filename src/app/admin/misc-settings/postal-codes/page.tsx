"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ListPagination, { paginate } from "@/components/ListPagination";
import PersonalInfoResultDialog from "@/components/PersonalInfoResultDialog";
import {
  POSTAL_CODE_MAX_LENGTH,
  POSTAL_DISTRICT_MAX_LENGTH,
  type PostalCodeOption,
} from "@/types/postal-codes";

interface PostalCodesResponse {
  success?: boolean;
  message?: string;
  options?: PostalCodeOption[];
}

interface DeleteTarget {
  index: number;
  option: PostalCodeOption;
}

export default function PostalCodesPage() {
  const [options, setOptions] = useState<PostalCodeOption[]>([]);
  const [savedOptions, setSavedOptions] = useState<PostalCodeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [newCode, setNewCode] = useState("");
  const [newDistrict, setNewDistrict] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editDistrict, setEditDistrict] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/misc-settings/postal-codes", { cache: "no-store" });
      const data: PostalCodesResponse = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.options)) {
        throw new Error(data.message || "讀取郵遞區號設定失敗");
      }
      const values = data.options.map((item) => ({ ...item }));
      setOptions(values);
      setSavedOptions(values.map((item) => ({ ...item })));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "讀取郵遞區號設定失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) =>
        !query || `${option.code} ${option.district}`.toLocaleLowerCase().includes(query)
      );
  }, [options, search]);
  const pageOptions = paginate(filteredOptions, page, pageSize);
  const isDirty = JSON.stringify(options) !== JSON.stringify(savedOptions);

  function validateOption(code: string, district: string, exceptIndex?: number): string | null {
    const normalizedCode = code.trim();
    const normalizedDistrict = district.trim();
    if (!/^\d{3}$/.test(normalizedCode)) return "區號需為 3 位數字。";
    if (!normalizedDistrict || normalizedDistrict.length > POSTAL_DISTRICT_MAX_LENGTH) {
      return `鄉鎮市區名稱必填，最多 ${POSTAL_DISTRICT_MAX_LENGTH} 字。`;
    }
    if (
      options.some(
        (item, index) =>
          index !== exceptIndex &&
          item.code === normalizedCode &&
          item.district === normalizedDistrict
      )
    ) {
      return `「${normalizedCode} ${normalizedDistrict}」已存在。`;
    }
    return null;
  }

  function addOption() {
    const error = validateOption(newCode, newDistrict);
    if (error) {
      setFeedback({ kind: "error", message: error });
      return;
    }
    setOptions((current) => [
      ...current,
      { code: newCode.trim(), district: newDistrict.trim() },
    ]);
    setNewCode("");
    setNewDistrict("");
    setSearch("");
    setPage(1);
  }

  function beginEdit(index: number, option: PostalCodeOption) {
    setEditingIndex(index);
    setEditCode(option.code);
    setEditDistrict(option.district);
  }

  function saveEdit(index: number) {
    const error = validateOption(editCode, editDistrict, index);
    if (error) {
      setFeedback({ kind: "error", message: error });
      return;
    }
    setOptions((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { code: editCode.trim(), district: editDistrict.trim() }
          : item
      )
    );
    setEditingIndex(null);
  }

  function removeOption() {
    if (!deleteTarget) return;
    setOptions((current) => current.filter((_, index) => index !== deleteTarget.index));
    if (editingIndex === deleteTarget.index) setEditingIndex(null);
    else if (editingIndex !== null && editingIndex > deleteTarget.index) {
      setEditingIndex(editingIndex - 1);
    }
    setDeleteTarget(null);
    setPage(1);
  }

  async function saveOptions() {
    if (!isDirty || saving || loading || loadError) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/misc-settings/postal-codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options }),
      });
      const data: PostalCodesResponse = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.options)) {
        throw new Error(data.message || "儲存郵遞區號設定失敗");
      }
      const values = data.options.map((item) => ({ ...item }));
      setOptions(values);
      setSavedOptions(values.map((item) => ({ ...item })));
      setFeedback({ kind: "success", message: data.message || "郵遞區號設定已儲存。" });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "儲存郵遞區號設定失敗",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <main className="w-full max-w-5xl mb-8 space-y-5">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-t1">郵遞區號設定</h2>
            <p className="text-sm text-t3 mt-1">
              維護台灣常用郵遞區號與鄉鎮市區選項；相同區號可對應多個地區。
            </p>
          </div>
          <div className="text-sm text-t2">目前 {options.length} 筆</div>
        </header>

        <section className="border border-themed rounded-lg bg-card p-4 sm:p-5 space-y-4">
          <h3 className="font-semibold text-t1">
            {editingIndex === null ? "新增郵遞區號" : "編輯郵遞區號"}
          </h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (loading || loadError || saving) return;
              if (editingIndex === null) addOption();
              else saveEdit(editingIndex);
            }}
            className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
          >
            <label className="block space-y-1 text-xs text-t2">
              <span>區號</span>
              <input
                value={editingIndex === null ? newCode : editCode}
                onChange={(event) =>
                  editingIndex === null
                    ? setNewCode(event.target.value)
                    : setEditCode(event.target.value)
                }
                maxLength={POSTAL_CODE_MAX_LENGTH}
                inputMode="numeric"
                placeholder="例如：100"
                disabled={loading || !!loadError || saving}
                className="w-full input-theme rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1 text-xs text-t2">
              <span>鄉鎮市區</span>
              <input
                value={editingIndex === null ? newDistrict : editDistrict}
                onChange={(event) =>
                  editingIndex === null
                    ? setNewDistrict(event.target.value)
                    : setEditDistrict(event.target.value)
                }
                maxLength={POSTAL_DISTRICT_MAX_LENGTH}
                placeholder="例如：臺北市中正區"
                disabled={loading || !!loadError || saving}
                className="w-full input-theme rounded px-3 py-2 text-sm"
              />
            </label>
            {editingIndex === null ? (
              <button
                type="submit"
                disabled={loading || !!loadError || saving}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
              >
                新增
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || !!loadError || saving}
                  className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
                >
                  完成編輯
                </button>
                <button
                  type="button"
                  onClick={() => setEditingIndex(null)}
                  disabled={saving}
                  className="border border-themed rounded-lg px-4 py-2 text-sm text-t2 hover:text-t1 cursor-pointer disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            )}
          </form>
          <p className="text-xs text-t3">區號需為 3 位數字；同區號可有不同地區，區號與地區名稱組合不可重複。</p>
        </section>

        <section className="border border-themed rounded-lg bg-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-themed p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="sr-only" htmlFor="postal-code-search">搜尋郵遞區號</label>
            <input
              id="postal-code-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="搜尋區號或鄉鎮市區"
              disabled={loading || !!loadError}
              className="w-full sm:max-w-sm input-theme rounded px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void saveOptions()}
              disabled={!isDirty || saving || loading || !!loadError}
              className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer disabled:opacity-50"
            >
              {saving ? "儲存中…" : isDirty ? "儲存設定" : "已儲存"}
            </button>
          </div>

          {loading ? (
            <p className="p-6 text-center text-sm text-t3" role="status">載入郵遞區號中…</p>
          ) : loadError ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm text-danger" role="alert">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadOptions()}
                className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                重新載入
              </button>
            </div>
          ) : filteredOptions.length === 0 ? (
            <p className="p-6 text-center text-sm text-t3">沒有符合的郵遞區號選項。</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm text-left">
                  <thead className="border-b border-themed bg-surface text-t2">
                    <tr>
                      <th className="px-4 py-2 font-medium">區號</th>
                      <th className="px-4 py-2 font-medium">鄉鎮市區</th>
                      <th className="px-4 py-2 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageOptions.map(({ option, index }) => (
                      <tr key={`${index}-${option.code}-${option.district}`} className="border-b border-themed last:border-0 text-t1">
                        <td className="px-4 py-2 font-mono">{option.code}</td>
                        <td className="px-4 py-2">{option.district}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => beginEdit(index, option)}
                              disabled={saving}
                              className="btn-theme rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
                            >
                              編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget({ index, option })}
                              disabled={saving}
                              className="btn-danger rounded px-3 py-1 text-xs cursor-pointer disabled:opacity-50"
                            >
                              移除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4">
                <ListPagination
                  total={filteredOptions.length}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  idPrefix="postal-codes"
                />
              </div>
            </>
          )}
        </section>
      </main>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="absolute inset-0 bg-black/40"
            aria-label="關閉移除確認視窗"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="postal-code-delete-title"
            className="relative z-10 w-full max-w-md rounded-xl border border-danger/50 bg-card p-5 shadow-xl"
          >
            <h2 id="postal-code-delete-title" className="text-lg font-bold text-danger">移除郵遞區號</h2>
            <p className="mt-3 text-sm text-t2">
              確定從待儲存清單移除「{deleteTarget.option.code} {deleteTarget.option.district}」？
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="border border-themed rounded-lg px-4 py-2 text-sm text-t2 hover:text-t1 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={removeOption}
                className="btn-danger rounded-lg px-4 py-2 text-sm cursor-pointer"
              >
                確認移除
              </button>
            </div>
          </div>
        </div>
      )}

      <PersonalInfoResultDialog
        message={feedback?.message ?? null}
        kind={feedback?.kind ?? "success"}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
