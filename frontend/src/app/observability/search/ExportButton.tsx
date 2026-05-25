'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8007';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportButtonProps {
  searchParams: any;
  resultCount: number;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ExportButton({ searchParams, resultCount }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // ── Export handler ──────────────────────────────────────────────────────────

  async function handleExport(format: 'json' | 'csv') {
    setExporting(true);
    setOpen(false);

    try {
      const res = await fetch(`${API}/traces/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...searchParams, format }),
      });

      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `traces-export-${Date.now()}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      // Export failed silently
    } finally {
      setExporting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const disabled = resultCount === 0 || exporting;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded border transition-all ${
          disabled
            ? 'text-slate-700 border-white/[0.03] cursor-not-allowed'
            : 'text-[#8b8ba8] border-white/[0.06] hover:text-slate-300 hover:border-white/[0.1] hover:bg-white/[0.03]'
        }`}
        aria-label="Export traces"
        aria-expanded={open}
      >
        {exporting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        Export
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-20 right-0 top-full mt-1 w-36 bg-[#14142a] border border-white/[0.08] rounded-lg shadow-xl overflow-hidden"
          >
            <button
              onClick={() => handleExport('json')}
              className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-slate-300 hover:bg-violet-500/10 hover:text-violet-300 transition-colors"
            >
              <FileJson className="h-3.5 w-3.5" />
              Export as JSON
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-slate-300 hover:bg-violet-500/10 hover:text-violet-300 transition-colors border-t border-white/[0.04]"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export as CSV
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
