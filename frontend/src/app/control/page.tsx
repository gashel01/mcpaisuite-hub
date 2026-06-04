import { redirect } from "next/navigation";

// Control Plane was merged into the unified Fleet hub (the stats header).
export default function ControlRedirect() {
  redirect("/fleet");
}
