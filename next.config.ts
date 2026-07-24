import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  // native addon — must be required from node_modules, not bundled
  serverExternalPackages: ["better-sqlite3-multiple-ciphers"],
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
