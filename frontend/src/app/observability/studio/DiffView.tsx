'use client';

import { motion } from 'framer-motion';
import { X } from 'lucide-react';

interface DiffViewProps {
  title_a: string;
  title_b: string;
  lines: Array<{ type: 'add' | 'remove' | 'same'; line: string }>;
  onClose: () => void;
}

export function DiffView({ title_a, title_b, lines, onClose }: DiffViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-xl border border-white/5 bg-[#0f0f1c] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#08080f]">
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium text-rose-300">{title_a}</span>
          <span className="text-[#8b8ba8] text-xs">vs</span>
          <span className="text-sm font-medium text-emerald-300">{title_b}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/5 text-[#8b8ba8] hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Diff content */}
      <div className="max-h-[400px] overflow-y-auto p-4 font-mono text-sm">
        {lines.map((entry, idx) => {
          const bgClass =
            entry.type === 'add'
              ? 'bg-emerald-500/10'
              : entry.type === 'remove'
              ? 'bg-rose-500/10'
              : '';

          const textClass =
            entry.type === 'add'
              ? 'text-emerald-300'
              : entry.type === 'remove'
              ? 'text-rose-300'
              : 'text-slate-400';

          const prefix =
            entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' ';

          return (
            <div
              key={idx}
              className={`flex items-start gap-3 px-2 py-0.5 rounded ${bgClass}`}
            >
              <span className="text-[#8b8ba8]/50 text-xs w-6 text-right shrink-0 select-none pt-0.5">
                {idx + 1}
              </span>
              <span className={`${textClass} whitespace-pre-wrap break-all`}>
                {prefix} {entry.line}
              </span>
            </div>
          );
        })}

        {lines.length === 0 && (
          <div className="text-center text-[#8b8ba8] py-8">
            No differences found.
          </div>
        )}
      </div>
    </motion.div>
  );
}
