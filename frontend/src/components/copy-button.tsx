"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  className?: string;
  size?: "sm" | "md";
}

export default function CopyButton({ text, className = "", size = "sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-1 text-slate-600 hover:text-slate-300 transition-colors ${className}`}
      data-tooltip={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check className={`${iconSize} text-emerald-400`} /> : <Copy className={iconSize} />}
    </button>
  );
}
