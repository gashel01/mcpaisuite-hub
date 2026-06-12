"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Modal shell: backdrop + centered card + fade/scale animation + Escape-to-close +
 * click-outside-to-close + stopPropagation on the card. Provide the card's look via
 * `className` (a sensible default is supplied) and the backdrop's z/tint via
 * `backdropClassName`.
 */
export function Modal({
  open,
  onClose,
  children,
  className = "w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0f0f1c] shadow-2xl shadow-black/50",
  backdropClassName = "z-[60] bg-black/60 backdrop-blur-sm",
  closeOnBackdrop = true,
  closeOnEsc = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
}) {
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, closeOnEsc, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeOnBackdrop ? onClose : undefined}
          role="dialog"
          aria-modal="true"
          className={`fixed inset-0 flex items-center justify-center p-4 ${backdropClassName}`}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className={className}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
