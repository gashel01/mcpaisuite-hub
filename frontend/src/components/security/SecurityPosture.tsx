"use client";

import { motion } from "framer-motion";
import {
  Shield,
  Lock,
  ShieldCheck,
  Eye,
  KeyRound,
  ScrollText,
  Box,
} from "lucide-react";
import type { SecurityPosture as SecurityPostureType } from "./types";

interface SecurityPostureProps {
  posture: SecurityPostureType | null;
  loading: boolean;
}

interface CardDef {
  key: string;
  label: (p: SecurityPostureType) => string;
  detail: (p: SecurityPostureType) => string;
  icon: React.ComponentType<{ className?: string }>;
  getColor: (p: SecurityPostureType) => "green" | "amber" | "red" | "slate";
}

const cards: CardDef[] = [
  {
    key: "network",
    label: (p) => (!p.egress.enabled ? "Deny All" : `Whitelist (${p.egress.allowed_domains.length})`),
    detail: (p) => (!p.egress.enabled ? "All outbound blocked" : `${p.egress.allowed_domains.length} domains allowed`),
    icon: Shield,
    getColor: (p) => (!p.egress.enabled ? "green" : "red"),
  },
  {
    key: "host",
    label: (p) => `${p.host.approved_count} approved`,
    detail: (p) => (p.host.auto_approve ? "Auto-approve ON" : `${p.host.pending_count} pending`),
    icon: Lock,
    getColor: (p) => (p.host.auto_approve ? "red" : p.host.pending_count > 0 ? "amber" : "green"),
  },
  {
    key: "validation",
    label: (p) => (p.validator.reject_dangerous ? "Strict" : "Auto-fix"),
    detail: (p) => (p.validator.reject_dangerous ? "Dangerous code rejected" : "Auto-fix enabled"),
    icon: ShieldCheck,
    getColor: (p) => (p.validator.reject_dangerous ? "green" : "amber"),
  },
  {
    key: "dlp",
    label: (p) => `${p.dlp.patterns_count} patterns active`,
    detail: () => "Data loss prevention",
    icon: Eye,
    getColor: () => "green",
  },
  {
    key: "vault",
    label: (p) => `${p.vault.secret_count} secrets`,
    detail: (p) => (p.vault.secret_count > 0 ? "Secrets stored securely" : "No secrets stored"),
    icon: KeyRound,
    getColor: (p) => (p.vault.secret_count > 0 ? "green" : "slate"),
  },
  {
    key: "constitution",
    label: (p) => `${p.constitution.rules_count} rules`,
    detail: (p) => (p.constitution.has_custom_rules ? "Custom rules active" : "Default rules"),
    icon: ScrollText,
    getColor: (p) => (p.constitution.has_custom_rules ? "green" : "slate"),
  },
  {
    key: "sandbox",
    label: (p) => `timeout=${p.sandbox.timeout}s, RAM=${p.sandbox.max_ram_mb}MB`,
    detail: () => "Execution sandbox",
    icon: Box,
    getColor: () => "green",
  },
];

const colorMap = {
  green: { border: "border-l-green-500", dot: "bg-green-400", text: "text-green-400" },
  amber: { border: "border-l-amber-500", dot: "bg-amber-400", text: "text-amber-400" },
  red: { border: "border-l-red-500", dot: "bg-red-400", text: "text-red-400" },
  slate: { border: "border-l-slate-500", dot: "bg-slate-400", text: "text-slate-400" },
};

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-white/[0.06] border-l-4 border-l-slate-700 bg-white/[0.015] px-4 py-3 animate-pulse">
      <div className="h-3 w-16 bg-white/[0.04] rounded mb-2" />
      <div className="h-4 w-20 bg-white/[0.06] rounded mb-1" />
      <div className="h-3 w-24 bg-white/[0.04] rounded" />
    </div>
  );
}

export default function SecurityPosture({ posture, loading }: SecurityPostureProps) {
  if (loading || !posture) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {cards.map((card, i) => {
        const color = card.getColor(posture);
        const styles = colorMap[color];
        const Icon = card.icon;

        return (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: i * 0.06,
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
            className={`relative rounded-xl border border-white/[0.06] border-l-4 ${styles.border} bg-white/[0.02] px-3 py-3`}
          >
            {/* Status dot */}
            <div className={`absolute top-2 right-2 h-2 w-2 rounded-full ${styles.dot}`} />

            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`h-4 w-4 ${styles.text}`} />
            </div>
            <p className="text-xs font-medium text-slate-200 leading-tight">
              {card.label(posture)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
              {card.detail(posture)}
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}
