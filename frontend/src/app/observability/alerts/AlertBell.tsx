"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

interface AlertBellProps {
  onClick: () => void;
}

export default function AlertBell({ onClick }: AlertBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const prevCount = useRef(0);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchCount() {
      try {
        const res = await fetch(`${API}/alerts/unread-count`);
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) {
          const count = data.count ?? data.unread_count ?? 0;
          if (count !== prevCount.current) {
            setPulse(true);
            setTimeout(() => setPulse(false), 600);
          }
          prevCount.current = count;
          setUnreadCount(count);
        }
      } catch {
        // Silently ignore network errors
      }
    }

    fetchCount();
    const interval = setInterval(fetchCount, 60000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <button
      onClick={onClick}
      className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
      aria-label={`Alerts${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
    >
      <Bell className="h-4 w-4" />
      <AnimatePresence>
        {unreadCount > 0 && (
          <motion.span
            key="badge"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: pulse ? [1, 1.3, 1] : 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold text-white bg-red-500 rounded-full border border-[#0f0f1c]"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
