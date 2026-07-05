import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // electron/ and scripts/ are plain CommonJS Node.js files (Electron main
    // process + build tooling), not part of the Next.js/TypeScript app. The
    // ESM-oriented `no-require-imports` rule doesn't apply here — require()
    // is the correct, necessary form since package.json has no "type":
    // "module" and these files run directly under Node/Electron.
    files: ["electron/**/*.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron packaging output — contains a full compiled/minified copy of
    // the Next.js standalone server (including its own nested .next/), which
    // the root-level ".next/**" ignore above does not reach. Without this,
    // ESLint lints bundled/minified build artifacts as if they were source.
    "dist-electron/**",
  ]),
]);

export default eslintConfig;
