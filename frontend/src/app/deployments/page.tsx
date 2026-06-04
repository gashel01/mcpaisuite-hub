import { redirect } from "next/navigation";

// Deployments was merged into the unified Fleet hub.
export default function DeploymentsRedirect() {
  redirect("/fleet");
}
