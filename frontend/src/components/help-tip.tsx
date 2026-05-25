"use client";

import { HelpCircle } from "lucide-react";

interface HelpTipProps {
  text: string;
  size?: "sm" | "md";
}

export default function HelpTip({ text, size = "sm" }: HelpTipProps) {
  const cls = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span className="inline-flex items-center ml-1 text-slate-600 hover:text-slate-400 cursor-help transition-colors" data-tooltip={text}>
      <HelpCircle className={cls} />
    </span>
  );
}
