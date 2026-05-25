"use client";

import { useState } from "react";
import { ArrowRight, Link2, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const RELATIONSHIP_TYPES = [
  { value: "related_to", label: "related to" },
  { value: "depends_on", label: "depends on" },
  { value: "part_of", label: "part of" },
  { value: "causes", label: "causes" },
  { value: "contradicts", label: "contradicts" },
  { value: "supports", label: "supports" },
  { value: "derived_from", label: "derived from" },
] as const;

interface RelationEditorProps {
  sourceNode: { id: string; name: string } | null;
  targetNode: { id: string; name: string } | null;
  onAdd: (sourceId: string, targetId: string, relationship: string) => void;
  onClose: () => void;
}

export function RelationEditor({ sourceNode, targetNode, onAdd, onClose }: RelationEditorProps) {
  const [relationship, setRelationship] = useState<string>(RELATIONSHIP_TYPES[0].value);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (!sourceNode || !targetNode) return null;

  const selectedLabel = RELATIONSHIP_TYPES.find((r) => r.value === relationship)?.label || relationship;

  const handleLink = () => {
    onAdd(sourceNode.id, targetNode.id, relationship);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30"
      >
        <div className="bg-black/80 backdrop-blur-xl border border-white/[0.1] rounded-2xl px-4 py-3 shadow-2xl min-w-[320px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Link2 className="h-3 w-3 text-violet-400" />
              <span className="text-[10px] font-semibold text-slate-300">Link Nodes</span>
            </div>
            <button
              onClick={onClose}
              className="text-slate-600 hover:text-slate-300 p-0.5 rounded-lg hover:bg-white/[0.04] transition-all"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Relationship flow */}
          <div className="flex items-center gap-2 mb-3">
            {/* Source */}
            <div className="flex-1 px-2.5 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-lg truncate">
              <span className="text-[10px] text-violet-300 font-medium">{sourceNode.name}</span>
            </div>

            <ArrowRight className="h-3 w-3 text-slate-600 shrink-0" />

            {/* Relationship dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:border-white/[0.15] transition-all"
              >
                <span className="text-[10px] text-slate-300 font-medium whitespace-nowrap">
                  {selectedLabel}
                </span>
                <ChevronDown
                  className={`h-2.5 w-2.5 text-slate-500 transition-transform ${
                    dropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Dropdown menu */}
              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-full left-0 mb-1 bg-[#14142a] border border-white/[0.1] rounded-xl shadow-2xl py-1 min-w-[140px] z-10"
                  >
                    {RELATIONSHIP_TYPES.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => {
                          setRelationship(r.value);
                          setDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[10px] transition-all ${
                          relationship === r.value
                            ? "text-violet-300 bg-violet-500/10"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <ArrowRight className="h-3 w-3 text-slate-600 shrink-0" />

            {/* Target */}
            <div className="flex-1 px-2.5 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg truncate">
              <span className="text-[10px] text-cyan-300 font-medium">{targetNode.name}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[10px] font-medium text-slate-500 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-medium rounded-lg transition-all active:scale-95"
            >
              <Link2 className="h-3 w-3" />
              Link
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
