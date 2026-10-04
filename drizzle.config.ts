import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

/* drizzle-kit runs as a CLI process, so there is no Next.js runtime to inherit the
 * environment from and process.env.DATABASE_URL would be undefined. That is the
 * whole reason this file spells out dbCredentials rather than pointing at the
 * app's own client.
 *
 * @next/env rather than dotenv: it is already a dependency, via Next, and it reads
 * .env.local with the same precedence Next does. A plain dotenv would also miss
 * NODE_ENV-specific files, so the "works in dev, fails in CI" version of this bug
 * is the one that is easiest to write by hand. */
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  /* Said plainly, because the alternative is a stack trace from inside a
   * connection library that does not mention the missing variable by name. */
  throw new Error(
    "DATABASE_URL is not set. It is read from .env.local; check the file exists " +
      "and that the variable is spelled DATABASE_URL.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});