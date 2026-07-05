"use client";

import { useEffect, useRef } from "react";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl";
}

const widthClass = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export default function Modal({ onClose, children, maxWidth = "md" }: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className={`bg-white border border-zinc-300 rounded ${widthClass[maxWidth]} w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto`}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
}

export function ModalHeader({ title, subtitle, onClose }: ModalHeaderProps) {
  return (
    <div className="flex justify-between items-start border-b-2 border-zinc-900 pb-3">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-800">{title}</h3>
        {subtitle && <p className="text-[10px] font-mono text-zinc-400 mt-0.5">{subtitle}</p>}
      </div>
      <button
        onClick={onClose}
        className="text-zinc-400 hover:text-zinc-700 text-xs font-bold uppercase tracking-wider ml-4"
      >
        Close
      </button>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

export function Field({ label, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

export const inputCls =
  "p-2 border border-zinc-300 text-sm rounded focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700";

export const selectCls =
  "p-2 border border-zinc-300 text-sm bg-white rounded focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700";

export function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs uppercase tracking-wider rounded transition-colors"
    >
      {label}
    </button>
  );
}
