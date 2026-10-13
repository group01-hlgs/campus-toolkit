"use client";

export default function PersonalInfoResultDialog({
  message,
  kind,
  onClose,
}: {
  message: string | null;
  kind: "success" | "error";
  onClose: () => void;
}) {
  if (!message) return null;

  const title = kind === "success" ? "已完成" : "發生錯誤";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <div
        role={kind === "error" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="personal-info-result-title"
        className="w-full max-w-md rounded-xl border border-themed bg-card p-5 shadow-xl"
      >
        <h2
          id="personal-info-result-title"
          className={`text-lg font-bold ${kind === "success" ? "text-success" : "text-danger"}`}
        >
          {title}
        </h2>
        <p className="mt-3 text-sm text-t2 whitespace-pre-wrap break-words">{message}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-theme rounded-lg px-4 py-2 text-sm cursor-pointer"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
