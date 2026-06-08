"use client";

import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CoverageHeatmapProps {
  enabled: boolean;
  onExit: () => void;
}

const LEGEND_ITEMS = [
  {
    label: "Well-sourced",
    description: "Many connections",
    color: "bg-white",
    opacity: "opacity-100",
    outline: false,
  },
  {
    label: "Moderate",
    description: "Some connections",
    color: "bg-white",
    opacity: "opacity-50",
    outline: false,
  },
  {
    label: "Sparse",
    description: "Few connections",
    color: "bg-white",
    opacity: "opacity-20",
    outline: false,
  },
  {
    label: "Orphan",
    description: "No connections",
    color: "bg-white/10",
    opacity: "opacity-100",
    outline: true,
  },
];

// Legend overlay for coverage mode. The toggle now lives in the HUD next to the E/F/D
// layer toggles; this panel only appears while coverage is on and offers an explicit exit
// (in addition to the HUD toggle and the Escape shortcut).
export function CoverageHeatmap({ enabled, onExit }: CoverageHeatmapProps) {
  // Positioning is handled by the parent (stacked above the type legend, bottom-left).
  return (
    <AnimatePresence>
      {enabled && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="bg-black/70  border border-white/[0.08] rounded-xl p-2.5 shadow-2xl space-y-1.5 min-w-[150px]"
        >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[8px] font-medium text-slate-500 uppercase tracking-wider">
                Coverage
              </span>
              <button
                onClick={onExit}
                className="flex items-center gap-0.5 text-[8px] text-slate-500 hover:text-slate-200 transition-colors"
                title="Exit coverage (Esc)"
              >
                <X className="h-2.5 w-2.5" /> Exit
              </button>
            </div>
            {LEGEND_ITEMS.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${item.color} ${item.opacity} shrink-0 ${
                    item.outline ? "ring-1 ring-red-500" : ""
                  }`}
                />
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-300 leading-none">{item.label}</span>
                  <span className="text-[7px] text-slate-600 leading-none mt-0.5">
                    {item.description}
                  </span>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
  );
}
