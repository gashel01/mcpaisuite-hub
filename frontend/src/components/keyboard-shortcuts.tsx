"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Escape: close any open modal/panel
      if (e.key === "Escape") {
        // Dispatch a custom event that modals can listen to
        window.dispatchEvent(new CustomEvent("kernelmcp:escape"));
        return;
      }

      // Ctrl/Cmd + / : toggle sidebar (dispatch event)
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("kernelmcp:toggle-sidebar"));
        return;
      }

      // Ctrl/Cmd + K : focus search (dispatch event)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("kernelmcp:focus-search"));
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return null;
}
