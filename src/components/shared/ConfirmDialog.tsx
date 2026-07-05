"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white border border-zinc-200 rounded max-w-sm w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className={`h-5 w-5 flex-shrink-0 mt-0.5 ${destructive ? "text-red-500" : "text-amber-500"}`}
          />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-800">{title}</h3>
            <p className="text-xs text-zinc-600 mt-2 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 border border-zinc-300 text-xs font-bold uppercase tracking-wider text-zinc-700 hover:bg-zinc-50 rounded transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors ${
              destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-700 hover:bg-blue-800"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
