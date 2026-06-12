export function StatPill({ icon: Icon, value, label, color, bg, compact }: { icon: any; value: number; label: string; color: string; bg: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border ${bg}`}>
      <Icon className={`h-3 w-3 ${color}`} />
      <span className={`text-[11px] font-bold ${color}`}>{value}</span>
      {!compact && <span className="text-[11px] sm:text-xs text-slate-600 hidden sm:inline">{label}</span>}
    </div>
  );
}
