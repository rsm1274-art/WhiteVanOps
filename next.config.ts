import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev-only: Next 16's dev server blocks cross-origin requests to /_next/*
  // resources (JS chunks, HMR) by default. When the dev server is reached
  // through the Cloudflare tunnel the browser's origin is the public hostname,
  // not localhost, so the chunks are blocked and the page never hydrates —
  // login appears to do nothing on a phone. Allow the tunnel host so field
  // testing works against `npm run dev`. Has no effect on production builds
  // (`next start` / the Electron standalone server impose no such restriction).
  allowedDevOrigins: ["demo.whitevanops.com"],
  // Pin the project root explicitly. Without this, Next.js/Turbopack can
  // misinfer the workspace root when a stray lockfile exists in a parent
  // directory (e.g. C:\Users\<name>\package-lock.json), which nests the
  // standalone build output under an extra path segment and breaks both
  // `node .next/standalone/server.js` and the Electron installer (which
  // expects server.js directly at the standalone root).
  outputFileTracingRoot: path.join(__dirname),
  // The backup route's process.cwd()-based pg_dump lookup makes Next.js trace
  // "the whole project" into .next/standalone. Without these excludes that
  // includes dist-electron/ (previous multi-GB installers — each build would
  // swallow the last one's output until NSIS dies on a >2GB archive), the
  // pgsql/ binaries (bundled separately via extraResources), and pg_data/.
  //
  // The second group is only ~5 MB, but it ships our TypeScript sources,
  // internal handoff notes, and marketing copy to every customer. The
  // standalone server runs the compiled output in .next/, so none of it is
  // reachable at runtime.
  outputFileTracingExcludes: {
    "*": [
      "./dist-electron/**",
      "./pgsql/**",
      "./pg_data/**",
      "./node_modules/.cache/**",
      "./src/**",
      "./docs/**",
      "./marketing/**",
      "./prisma/**",
      "./scripts/**",
      "./*.md",
      "./package-lock.json",
      "./tsconfig.json",
      "./tsconfig.tsbuildinfo",
    ],
  },
  // Prisma 7 + Next standalone packaging gotcha. Two independent problems bit
  // the self-booting installer (the office PM2 box masks both — it runs against
  // the full project node_modules; a dev running .next/standalone/server.js is
  // masked too, because Node walks up to the project node_modules):
  //   1. Next 16's default Turbopack bundler emitted a broken external require
  //      `require("@prisma/client-<hash>")` for a name that never resolves ->
  //      login 500 "Cannot find module". Fixed by building with `--webpack`
  //      (see the "build" script), whose Prisma externalization is correct.
  //   2. The trace still won't COPY Prisma's runtime packages, and
  //      outputFileTracingIncludes is a dumb file-copy that does NOT follow the
  //      dependencies of what it copies. So list the whole runtime require
  //      closure of @prisma/client (with the pg driver adapter) explicitly.
  //      Deliberately NOT @prisma/** — that drags in ~95 MB of engines/studio/
  //      dev that driver-adapter mode never loads. (electron-build.js step 7b
  //      asserts these landed; `build` runs `prisma generate` first.)
  outputFileTracingIncludes: {
    "*": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
      "./node_modules/@prisma/client-runtime-utils/**",
      "./node_modules/@prisma/debug/**",
      "./node_modules/@prisma/driver-adapter-utils/**",
      "./node_modules/@prisma/adapter-pg/**",
    ],
  },
};

export default nextConfig;
