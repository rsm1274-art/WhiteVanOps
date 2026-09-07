import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // storefront/ imports shared/license-mint.js from one directory up (the
  // repo root) so both this service and scripts/license-manager.js mint
  // licenses through the same code. Vercel's monorepo build needs this to
  // know that file is part of the build and trace it into the deployed
  // function — otherwise it's outside storefront/'s own directory and gets
  // silently dropped, breaking the webhook at runtime with "module not found".
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
