import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The database connection. Server-only.
 *
 * Lazy, and a singleton, and both are load-bearing:
 *
 * - Lazy, because this module gets imported by route handlers that may never
 *   touch the database. Connecting at module scope would open a socket during
 *   build output collection, where there is no DATABASE_URL to use and every
 *   route would fail for a reason that has nothing to do with them.
 * - A singleton, because postgres.js pools internally and a fresh client per
 *   request would exhaust the pooler. Next's dev server re-evaluates modules on
 *   every edit, so the instance is cached on globalThis — the same trick Prisma
 *   and Supabase's own examples use, and the only way it survives a hot reload.
 *
 * The pooler is on port 6543 and the host is aws-*.pooler.supabase.com. The
 * direct connection is IPv6-only on the free tier and will not resolve from a
 * normal home network. See .env.example.
 *
 * prepare: false is required, not a preference. The transaction-mode pooler does
 * not support prepared statements, and leaving them on produces an error at the
 * first query rather than at connect.
 */
const globalForDb = globalThis as unknown as {
  __db?: ReturnType<typeof create>;
};

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    /* Thrown on first use rather than at import, so the failure lands on the
       request that needed data and says why, instead of every unrelated route
       dying at build time with a message about a missing variable. */
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const client = postgres(url, {
    max: 1,
    prepare: false,
    /* Supabase's pooler sits behind PgBouncer, which multiplexes many clients
       onto one Postgres connection. Session-level state is not available, so
       anything that assumes it has to be done per statement. */
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export const db = globalForDb.__db ?? (globalForDb.__db = create());

export { schema };