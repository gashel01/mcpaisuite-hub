"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Play,
  MessageSquare,
  Server,
  ShieldCheck,
  DollarSign,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Tasks", icon: Play },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/servers", label: "Servers", icon: Server },
  { href: "/constitution", label: "Constitution", icon: ShieldCheck },
  { href: "/cost", label: "Cost", icon: DollarSign },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-[#2a2a3a] bg-[#16161e]">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="h-3 w-3 rounded-full bg-violet-500" />
        <span className="text-lg font-semibold tracking-tight">kernelmcp</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-600/20 text-violet-400"
                  : "text-[#9090a8] hover:bg-[#1e1e2a] hover:text-[#e4e4ef]"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[#2a2a3a] px-5 py-3 text-xs text-[#9090a8]">
        kernelmcp v0.1
      </div>
    </aside>
  );
}
