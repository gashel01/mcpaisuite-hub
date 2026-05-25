"use client";

import { useRef } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { GripHorizontal } from "lucide-react";

interface BottomDrawerProps {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const COLLAPSED_HEIGHT = 32;
const EXPANDED_HEIGHT = 250;

export default function BottomDrawer({ open, onToggle, children }: BottomDrawerProps) {
  const constraintsRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // If dragged more than 40px in either direction, toggle
    if (!open && info.offset.y < -40) {
      onToggle();
    } else if (open && info.offset.y > 40) {
      onToggle();
    }
  };

  return (
    <motion.div
      ref={constraintsRef}
      initial={false}
      animate={{ height: open ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT }}
      transition={{ type: "spring", stiffness: 400, damping: 35 }}
      className={`relative shrink-0 bg-[#0c0c14] rounded-t-xl overflow-hidden border-t ${
        open ? "border-violet-500/20 shadow-[0_-2px_20px_rgba(139,92,246,0.06)]" : "border-white/[0.06]"
      }`}
    >
      {/* Drag handle bar */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        onClick={onToggle}
        className="flex items-center justify-center h-8 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 text-slate-600" />
          <span className="text-[10px] font-medium text-slate-500">Step Detail</span>
        </div>
      </motion.div>

      {/* Content */}
      <motion.div
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2, delay: open ? 0.1 : 0 }}
        className="flex-1 overflow-auto px-3 pb-3"
        style={{ height: open ? EXPANDED_HEIGHT - COLLAPSED_HEIGHT : 0 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
