import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the project root explicitly. Without this, Next.js/Turbopack can
  // misinfer the workspace root when a stray lockfile exists in a parent
  // directory (e.g. C:\Users\<name>\package-lock.json), which nests the
  // standalone build output under an extra path segment and breaks both
  // `node .next/standalone/server.js` and the Electron installer (which
  // expects server.js directly at the standalone root).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
