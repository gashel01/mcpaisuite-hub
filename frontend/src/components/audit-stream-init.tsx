"use client";

import { useEffect } from "react";
import { startAuditStream } from "@/stores/audit";

/** Invisible component that starts the global audit SSE stream once. Mount in layout. */
export default function AuditStreamInit() {
  useEffect(() => { startAuditStream(); }, []);
  return null;
}
