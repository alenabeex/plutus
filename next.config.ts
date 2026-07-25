import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  // native addon — must be required from node_modules, not bundled
  serverExternalPackages: ["better-sqlite3-multiple-ciphers"],
  // Demo gets its own build dir so its dev-server lock doesn't collide with
  // the real instance — that's what lets real (8420) and demo (3000) run at
  // the same time from one checkout. Port convention (Alena, 2026-07-24):
  // 8420 = real data · 3000 = demo · tunnel follows demo only.
  distDir: process.env.FT_DEMO === "1" ? ".next-demo" : ".next",
  turbopack: {
    root: path.join(__dirname),
  },
  // Demo-only: let a QA tunnel host reach HMR/dev resources. Never applies
  // outside FT_DEMO=1 — matches the proxy.ts tunnel allowlist.
  ...(process.env.FT_DEMO === "1" && process.env.FT_TUNNEL_HOST
    ? { allowedDevOrigins: [process.env.FT_TUNNEL_HOST] }
    : {}),
}

export default nextConfig
