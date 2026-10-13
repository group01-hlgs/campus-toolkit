"use client";

import { useEffect, useRef } from "react";

export default function PersonalInfoResultDialog({
  message,
  kind,
  onClose,
}: {
  message: string | null;
  kind: "success" | "error";
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onCloseRef.current(), 2000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  const title = kind === "success" ? "已完成" : "發生錯誤";
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      className={`fixed bottom-4 left-1/2 z-50 w-[min(92vw,44rem)] -translate-x-1/2 rounded-lg border p-3 text-sm shadow-lg ${
        kind === "success"
          ? "border-success/60 bg-card text-success"
          : "border-danger/60 bg-card text-danger"
      }`}
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-t2 whitespace-pre-wrap break-words">{message}</p>
    </div>
  );
}
