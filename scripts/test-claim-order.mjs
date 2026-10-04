/**
 * Regression test: the claim must not be spent on a local failure.
 *
 * SimpleFIN deletes a setup token the instant it is redeemed. That makes the claim
 * the only irreversible step in connect(), so everything that can fail locally has
 * to happen first.
 *
 * This failed in practice. connect() used to POST the claim and create the profile
 * afterwards, so a user with no profiles row burned a valid token on a foreign key
 * constraint. On the next attempt SimpleFIN returned 404, which looked like the
 * user's mistake and was actually the app's.
 *
 * Checks the ordering in the source, because the failure is a statement order and
 * nothing about the types or a unit test would catch it moving. Also covers the
 * status handling, since 403 and 404 are the same condition and used to be treated
 * differently.
 */
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/finance/simplefin.ts", import.meta.url), "utf8"),
  { mode: "strip" },
);

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
}

/** The body of connect(), so ordering is checked there and not in a neighbour. */
const start = src.indexOf("export async function connect(");
check("connect() found", start !== -1);
const body = src.slice(start, src.indexOf("\nexport ", start + 10));

console.log("ordering in connect()");
const profileAt = body.indexOf("ensureProfile");
const claimAt = body.indexOf('method: "POST"');
const fetchAt = body.indexOf("await fetch(");
const encryptAt = body.indexOf("encryptSecret");
const upsertAt = body.indexOf(".insert(schema.financeConnections)");

check("profile created", profileAt !== -1);
check("claim POST present", claimAt !== -1);
check("upsert present", upsertAt !== -1);

check(
  "ensureProfile runs BEFORE the claim is redeemed",
  profileAt !== -1 && claimAt !== -1 && profileAt < claimAt,
  `ensureProfile@${profileAt} claim@${claimAt}`,
);
check(
  "ensureProfile runs before the first network call",
  profileAt !== -1 && fetchAt !== -1 && profileAt < fetchAt,
  `ensureProfile@${profileAt} fetch@${fetchAt}`,
);
check(
  "token is validated locally before the claim",
  src.indexOf("assertSimpleFinUrl(decodeToken(rawToken))") < start + profileAt ||
    body.indexOf("decodeToken(rawToken)") < profileAt,
);

console.log("\nirreversible step is last local risk");
check(
  "encrypt only happens after a successful claim",
  encryptAt !== -1 && claimAt !== -1 && encryptAt > claimAt,
  `encrypt@${encryptAt} claim@${claimAt}`,
);

console.log("\nstatus handling");
/* A redeemed token is deleted outright, so replaying one returns 404 rather than
   the 403 the docs reserve for "unknown token". Both mean the same thing: gone.
   Reporting only 403 meant a genuine 404 fell through to the generic "refused the
   claim", which told the user nothing and invited them to retry a dead token. */
check(
  "403 handled as a spent token",
  /status === 403/.test(body) && /single-use|single-use|already/i.test(body),
);
check(
  "404 handled as a spent token too",
  /status === 404/.test(body),
);
check(
  "message does not blame the user",
  /cannot be retried|Get a new token/i.test(body),
);

console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
/* No process.exit: on Windows an abrupt teardown aborts libuv's own cleanup and
   prints an assertion failure that looks like a test error but is not one. */
if (fail !== 0) throw new Error(`${fail} failed`);