import type { SecurityPosture as SecurityPostureData } from "@/components/security/types";

// ── Color + score utils (shared across the Security page and its panels) ──

export function scoreColor(s: number) {
  if (s >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500", ring: "#10b981", glow: "shadow-emerald-500/20" };
  if (s >= 50) return { text: "text-amber-400", bg: "bg-amber-500", ring: "#f59e0b", glow: "shadow-amber-500/20" };
  return { text: "text-red-400", bg: "bg-red-500", ring: "#ef4444", glow: "shadow-red-500/20" };
}

export function categoryScore(posture: SecurityPostureData | null, cat: string): number {
  if (!posture) return 0;
  switch (cat) {
    case "network": return posture.egress?.enabled ? 100 : 30;
    case "host": return posture.host?.auto_approve ? 40 : (posture.host?.pending_count > 0 ? 60 : 100);
    case "code": {
      let s = 50;
      if (posture.validator?.reject_dangerous) s += 25;
      if (posture.validator?.auto_fix) s += 25;
      // Each disabled pattern reduces score (9 total patterns)
      const disabled = posture.validator?.disabled_patterns?.length || 0;
      if (disabled > 0) s = Math.max(20, s - disabled * 8);
      return s;
    }
    case "dlp": {
      if (posture.dlp?.enabled === false) return 20;
      const dlpDisabled = posture.dlp?.disabled_patterns?.length || 0;
      return dlpDisabled > 0 ? Math.max(30, 100 - dlpDisabled * 5) : 100;
    }
    case "governance": {
      const activeTemplates = (posture?.constitution?.active_templates || []).length;
      const hasCustom = (posture?.constitution?.rules || "").trim().length > 0;
      if (activeTemplates >= 3 && hasCustom) return 100;
      if (activeTemplates >= 2) return 80;
      if (activeTemplates >= 1 || hasCustom) return 60;
      return 30;
    }
    default: return 50;
  }
}

export function overallScore(posture: SecurityPostureData | null): number {
  if (!posture) return 0;
  const cats = ["network", "host", "code", "dlp", "governance"];
  return Math.round(cats.reduce((sum, c) => sum + categoryScore(posture, c), 0) / cats.length);
}
