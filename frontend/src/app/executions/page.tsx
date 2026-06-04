import { redirect } from "next/navigation";

// Executions was merged into the unified Fleet hub as the "All activity" view.
export default function ExecutionsRedirect() {
  redirect("/fleet?view=activity");
}
