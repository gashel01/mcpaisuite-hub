"use client";

import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export default function ConfirmDialog({ open, title, message, confirmLabel = "Delete", onConfirm, onCancel, destructive = true }: Props) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      backdropClassName="z-[55] bg-black/50"
      className="w-80 rounded-xl border border-white/[0.08] bg-[#0f0f1c] p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        {destructive && <AlertTriangle className="w-4 h-4 text-red-400" />}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <p className="text-[11px] text-slate-400 mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => { onConfirm(); onCancel(); }}
          className={`px-4 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
            destructive
              ? "bg-red-500/20 hover:bg-red-500/30 text-red-300"
              : "bg-violet-500/20 hover:bg-violet-500/30 text-violet-300"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
