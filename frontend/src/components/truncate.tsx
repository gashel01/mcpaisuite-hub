"use client";

interface TruncateProps {
  text: string;
  max?: number;
  className?: string;
}

export default function Truncate({ text, max = 40, className = "" }: TruncateProps) {
  if (!text) return null;
  const truncated = text.length > max;
  const display = truncated ? text.slice(0, max) + "..." : text;
  return (
    <span className={className} data-tooltip={truncated ? text : undefined}>
      {display}
    </span>
  );
}
