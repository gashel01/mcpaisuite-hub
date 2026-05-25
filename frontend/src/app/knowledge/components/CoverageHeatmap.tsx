"use client";

import { Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CoverageHeatmapProps {
  enabled: boolean;
  onToggle: () => void;
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

export function CoverageHeatmap({ enabled, onToggle }: CoverageHeatmapProps) {
  return (
    <div className="absolute bottom-4 left-3 z-20">
      <div className="flex flex-col gap-1.5">
        {/* Legend (shown when enabled) */}
        <AnimatePresence>
          {enabled && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="bg-black/70 backdrop-blur-xl border border-white/[0.08] rounded-xl p-2.5 shadow-2xl space-y-1.5 min-w-[140px]"
            >
              <span className="text-[8px] font-medium text-slate-500 uppercase tracking-wider">
                Coverage
              </span>
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

        {/* Toggle button */}
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 backdrop-blur-md border rounded-xl text-[9px] font-medium transition-all active:scale-95 ${
            enabled
              ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
              : "bg-black/50 border-white/[0.08] text-slate-500 hover:text-slate-300"
          }`}
        >
          {enabled ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3" />
          )}
          Coverage
        </button>
      </div>
    </div>
  );
}
