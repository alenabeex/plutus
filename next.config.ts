import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  // native addon — must be required from node_modules, not bundled
  serverExternalPackages: ["better-sqlite3-multiple-ciphers"],
  turbopack: {
    root: path.join(__dirname),
  },
}

export default nextConfig
