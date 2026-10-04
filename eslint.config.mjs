import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Capacitor Android project. It is generated (npx cap add android) and
    // its build outputs contain transpiled JS that ESLint would otherwise read
    // and complain about. Native code is not linted by ESLint anyway.
    "android/**",
  ]),
]);

export default eslintConfig;
