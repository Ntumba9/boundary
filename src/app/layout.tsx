import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { getPageAuth } from "@/lib/auth/page";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOUNDARY",
  description: "Multi-tenant access control demonstration",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const auth = await getPageAuth();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href={auth ? "/dashboard" : "/login"} className="brand">BOUNDARY</Link>
          <nav>
            {auth ? (
              <>
                <span className="who">
                  {auth.companyName} &middot; {auth.email} &middot; <span className={`badge ${auth.role}`}>{auth.role}</span>
                </span>
                <Link href="/dashboard">Projects</Link>
                {auth.role === "admin" && <Link href="/admin">Admin</Link>}
                <Link href="/results">Test results</Link>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/results">Test results</Link>
                <Link href="/login">Sign in</Link>
              </>
            )}
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="container muted small">
          Demonstration project. Not production-hardened; see README for the threat model.
        </footer>
      </body>
    </html>
  );
}
