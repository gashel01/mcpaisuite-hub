"use client";

import { motion } from "framer-motion";

export function ControlPanel({ title, icon: Icon, color, children }: { title: string; icon: any; color: string; children: React.ReactNode }) {
  const colors: Record<string, string> = { cyan: "text-cyan-400", violet: "text-violet-400", emerald: "text-emerald-400", amber: "text-amber-400", pink: "text-pink-400" };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden"
    >
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
        <Icon className={`h-4 w-4 ${colors[color] || "text-slate-400"}`} />
        <span className="text-xs font-semibold text-white">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </motion.div>
  );
}
