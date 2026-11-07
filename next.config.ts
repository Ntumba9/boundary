import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here is per-user and session-dependent, so the scaffold's
  // cacheComponents / partial prefetching defaults are turned off: nothing
  // user-specific should ever be cached or prerendered. (Also required by the
  // nonce-based CSP in src/proxy.ts, which needs every page rendered per request.)
  cacheComponents: false,

  // Self-contained server bundle for the Docker image only (see Dockerfile).
  // Local `next start` and CI keep the default output.
  output: process.env.BOUNDARY_STANDALONE === "1" ? "standalone" : undefined,

  // Don't write AGENTS.md into the repo during `next dev`.
  agentRules: false,

  // Hide the framework version header.
  poweredByHeader: false,

  experimental: {
    // Enables forbidden() in server components so a member opening /admin
    // gets a real HTTP 403, matching the API's status-code policy.
    authInterrupts: true,
  },

  // Static hardening headers. The per-request, nonce-based CSP for pages is
  // set in src/proxy.ts because it must change on every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Legacy equivalent of CSP frame-ancestors 'none', for old browsers.
          { key: "X-Frame-Options", value: "DENY" },
          // Stricter than strict-origin-when-cross-origin: no Referer at all
          // leaves the site, and every link here is same-origin anyway.
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // API responses are JSON and never meant to be rendered as a document.
        // If one is opened directly in a browser, nothing in it may load or run.
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
