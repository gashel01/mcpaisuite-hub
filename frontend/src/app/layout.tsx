import type { Metadata } from "next";
import Sidebar from "@/components/sidebar";
import Onboarding from "@/components/onboarding";
import KeyboardShortcuts from "@/components/keyboard-shortcuts";
import { TenantProvider } from "@/context/tenant";
import { ModeProvider } from "@/context/mode";
import { CodeRunnerProvider } from "@/context/code-runner";
import { ToastProvider } from "@/components/ui/toast";
import AuditStreamInit from "@/components/audit-stream-init";
import "./globals.css";

export const metadata: Metadata = {
  title: "kernelmcp",
  description: "Kernel MCP orchestration dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
        <ModeProvider>
          <TenantProvider>
            <CodeRunnerProvider>
              <ToastProvider>
                <Sidebar />
                <AuditStreamInit />
                <Onboarding />
                <KeyboardShortcuts />
                <main className="h-screen overflow-hidden p-4 pt-16 md:ml-60 md:p-5 md:pt-5">{children}</main>
              </ToastProvider>
            </CodeRunnerProvider>
          </TenantProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
