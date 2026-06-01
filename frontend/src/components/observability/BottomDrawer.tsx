"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { GripHorizontal, ChevronUp, ChevronDown } from "lucide-react";

interface BottomDrawerProps {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const COLLAPSED_HEIGHT = 36;
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 720;
const CLICK_THRESHOLD = 5; // px of movement below which we treat the gesture as a tap

export default function BottomDrawer({ open, onToggle, children }: BottomDrawerProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startH: number; moved: number; rawTarget: number } | null>(null);

  const maxHeight = () =>
    typeof window !== "undefined" ? Math.min(MAX_HEIGHT, Math.round(window.innerHeight * 0.85)) : MAX_HEIGHT;
  const clamp = (h: number) => Math.min(maxHeight(), Math.max(MIN_HEIGHT, h));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startH: open ? height : COLLAPSED_HEIGHT, moved: 0, rawTarget: height };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = drag.current;
    if (!st) return;
    const delta = st.startY - e.clientY; // drag up = positive
    st.moved = Math.max(st.moved, Math.abs(delta));
    if (!open) return; // resizing only applies to an open drawer; opening is handled on pointer-up
    st.rawTarget = st.startH + delta;
    setHeight(clamp(st.rawTarget));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = drag.current;
    drag.current = null;
    setDragging(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    if (!st) return;
    // Tap → toggle
    if (st.moved < CLICK_THRESHOLD) { onToggle(); return; }
    // Dragged the open drawer well below its minimum → collapse it
    if (open && st.rawTarget < MIN_HEIGHT - 40) onToggle();
    // Dragged up from a collapsed drawer → open it
    else if (!open && st.startY - e.clientY > 24) onToggle();
  };

  return (
    <motion.div
      initial={false}
      animate={{ height: open ? height : COLLAPSED_HEIGHT }}
      transition={dragging ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 35 }}
      className={`relative shrink-0 flex flex-col rounded-t-xl overflow-hidden border-t transition-colors ${
        open
          ? "bg-[#0c0c14] border-violet-500/20 shadow-[0_-4px_30px_rgba(139,92,246,0.08)]"
          : "bg-[#0a0a12] border-white/[0.06] hover:border-white/[0.1]"
      }`}
    >
      {/* Drag handle bar — tap to toggle, drag to resize */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ touchAction: "none" }}
        className={`flex items-center justify-center h-9 shrink-0 select-none hover:bg-white/[0.02] active:bg-white/[0.04] transition-colors touch-target ${open ? "cursor-ns-resize" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-4 w-4 text-slate-600" />
          <span className="text-[11px] font-medium text-slate-500">Step Detail</span>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
          )}
        </div>
      </div>

      {/* Content */}
      <motion.div
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2, delay: open && !dragging ? 0.1 : 0 }}
        className="flex-1 min-h-0 overflow-auto px-3 sm:px-4 pb-3"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
