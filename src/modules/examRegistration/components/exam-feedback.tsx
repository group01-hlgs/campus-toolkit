"use client";

/**
 * 跳出訊息元件（對齊主程式 AccountSecurity 慣例）：
 * - FlashModal：成功/錯誤訊息，全螢幕遮罩＋bg-card 卡片＋animate-fade-in，自動關閉（由父層計時清 state）或點任意處關閉
 * - ConfirmModal：確認框（取代 window.confirm，樣式可套主題）；確定鈕可指定 btn-danger/btn-theme
 * 全部使用主程式主題類別（bg-card/text-t1/btn-soft/btn-danger/btn-theme/--success/--danger），深淺主題皆相容。
 */

export type Flash = { type: "success" | "error"; text: string } | null;

const OVERLAY_STYLE = { background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" } as const;

/** 成功/錯誤訊息 modal（success 綠勾、error 紅叉；點遮罩或自動計時關閉） */
export function FlashModal({ flash, onDismiss }: { flash: Flash; onDismiss: () => void }) {
  if (!flash) return null;
  const ok = flash.type === "success";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
      style={OVERLAY_STYLE}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <div
        className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          {ok ? (
            <svg
              className="w-12 h-12 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ) : (
            <svg
              className="w-12 h-12 text-danger"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
        </div>
        <p className="text-lg font-semibold text-t1">{flash.text}</p>
        <p className="text-xs text-t3">點任意處關閉</p>
      </div>
    </div>
  );
}

/** 確認框 modal（取代 window.confirm）；`danger=true` 時確定鈕用 btn-danger */
export function ConfirmModal({
  text,
  confirmLabel = "確定",
  danger = false,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={OVERLAY_STYLE}
      role="dialog"
      aria-modal="true"
      aria-label="確認"
    >
      <div className="bg-card rounded-2xl p-8 text-center space-y-4 shadow-lg animate-fade-in max-w-sm mx-4">
        <div className="flex justify-center">
          <svg
            className={`w-12 h-12 ${danger ? "text-danger" : "text-t2"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="text-base text-t1 whitespace-pre-line">{text}</p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-soft rounded-lg px-5 py-2 text-sm cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${danger ? "btn-danger" : "btn-theme"} rounded-lg px-5 py-2 text-sm cursor-pointer`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
