import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Sidebar from "@/components/sidebar";
import { TenantProvider } from "@/context/tenant";
import { ModeProvider } from "@/context/mode";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <ModeProvider>
          <TenantProvider>
            <Sidebar />
            <main className="min-h-screen p-4 pt-16 md:ml-60 md:p-6 md:pt-6">{children}</main>
          </TenantProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
