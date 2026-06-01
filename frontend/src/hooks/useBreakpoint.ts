"use client";

import { useState, useEffect } from "react";

const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

export type Breakpoint = "mobile" | "tablet" | "desktop";

function getBreakpoint(w: number): Breakpoint {
  if (w < BREAKPOINTS.md) return "mobile";
  if (w < BREAKPOINTS.lg) return "tablet";
  return "desktop";
}

export function useBreakpoint() {
  const [bp, setBp] = useState<Breakpoint>("desktop");
  const [width, setWidth] = useState(1280);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setWidth(w);
      setBp(getBreakpoint(w));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return {
    bp,
    width,
    isMobile: bp === "mobile",
    isTablet: bp === "tablet",
    isDesktop: bp === "desktop",
    isMobileOrTablet: bp !== "desktop",
  };
}
