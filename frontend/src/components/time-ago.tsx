"use client";

import { useState, useEffect } from "react";

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface TimeAgoProps {
  timestamp: number | string | Date;
  className?: string;
}

export default function TimeAgo({ timestamp, className = "" }: TimeAgoProps) {
  const [, setTick] = useState(0);

  const date = timestamp instanceof Date
    ? timestamp
    : typeof timestamp === "number"
    ? new Date(timestamp > 1e12 ? timestamp : timestamp * 1000)
    : new Date(timestamp);

  const full = date.toLocaleString();

  // Re-render every 30s for live updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className={className} data-tooltip={full}>
      {formatTimeAgo(date)}
    </span>
  );
}
