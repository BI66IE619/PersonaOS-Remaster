/**
 * Pulls a freshly rotated demo token from SimpleFIN's developer page and runs the
 * whole flow against it: claim, then fetch the account set.
 *
 * The published token is single-use and the previous run consumed it, so the token
 * is read from the page each time rather than hard-coded. The page rotates it on
 * every load. Its account set is fabricated sample data.
 *
 * The access URL is never printed; only its shape is asserted.
 */
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

const failures = [];

function check(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
    failures.push(name);
  }
}

/* The host allowlist, evaluated out of the source for the reason given in
   test-simplefin-url.mjs. */
const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/finance/simplefin.ts", import.meta.url), "utf8"),
  { mode: "strip" },
);
const fn = src.slice(src.indexOf("function assertSimpleFinUrl"));
const hostConst = src.match(/const ALLOWED_HOST = .*?;/s)?.[0];
const assertSimpleFinUrl = new Function(
  `${hostConst}\n${fn.slice(0, fn.indexOf("\n}") + 2)}; return assertSimpleFinUrl;`,
)();

console.log("rotating the demo token");
const page = await (await fetch("https://beta-bridge.simplefin.org/info/developers")).text();
const candidates = page.match(/[A-Za-z0-9+/]{60,}={0,2}/g) ?? [];

let claimUrl = null;
for (const c of [...new Set(candidates)]) {
  try {
    const d = Buffer.from(c, "base64").toString("utf8");
    if (d.startsWith("https://")) {
      claimUrl = d;
      break;
    }
  } catch {
    /* Not base64. */
  }
}
if (!claimUrl) {
  console.error("no token found on the developer page");
  process.exit(1);
}
console.log(`       found a token for ${new URL(claimUrl).host}`);

console.log("\ntoken handling");
check("decoded token passes the host allowlist", (() => {
  try {
    assertSimpleFinUrl(claimUrl);
    return true;
  } catch {
    return false;
  }
})());

console.log("\nclaim exchange");
const res = await fetch(claimUrl, {
  method: "POST",
  headers: { "content-length": "0" },
  redirect: "error",
  signal: AbortSignal.timeout(20_000),
});
check("claim returns 200", res.ok, `got ${res.status}`);

if (!res.ok) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}

const accessUrl = (await res.text()).trim();
check("access URL is in the body, plain text", /^https:\/\//.test(accessUrl));
check("carries basic-auth userinfo", /:\/\/[^:]+:[^@]+@/.test(accessUrl));
check("passes the host allowlist", (() => {
  try {
    assertSimpleFinUrl(accessUrl);
    return true;
  } catch {
    return false;
  }
})());

console.log("\naccount set");
const url = new URL(accessUrl);
/* The access URL already ends in /simplefin; the collection is /simplefin/accounts.
   Getting this wrong 404s, which is one of the bugs pinned by this script. */
url.pathname = `${url.pathname.replace(/\/$/, "")}/accounts`;
url.searchParams.set("version", "2");
url.searchParams.set("pending", "1");
url.searchParams.set("start-date", String(Math.floor(Date.now() / 1000) - 89 * 86400));

/* Mirrors what fetchData does: the credential is stripped out of the URL and sent
   as an Authorization header. Node's fetch throws on a URL with userinfo, which is
   the second bug this script pins down — so this has to be done the same way here
   or the test passes while the app fails. */
const username = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
url.username = "";
url.password = "";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const acc = await fetch(url.toString(), {
  headers: { accept: "application/json", authorization },
  signal: AbortSignal.timeout(30_000),
});
check("/accounts returns 200", acc.ok, `got ${acc.status}`);

const data = await acc.json();
check("accounts is an array", Array.isArray(data.accounts));
check("at least one account", data.accounts?.length > 0, `${data.accounts?.length}`);
check("no error list", (data.errors ?? []).length === 0, JSON.stringify(data.errors));

const a = data.accounts?.[0];
if (a) {
  check("account.id is a string", typeof a.id === "string");
  check("account.name is a string", typeof a.name === "string");
  check("balance is a numeric string", typeof a.balance === "string" && !Number.isNaN(Number(a.balance)));
  /* The nesting is what the old collector assumed wrongly. */
  check("transactions nested in the account", Array.isArray(a.transactions));
  console.log(`       ${a.transactions?.length ?? 0} sample transactions`);

  /* v2 removed `org` from the account and added a top-level `connections` list, so
     the institution has to be resolved through conn_id or it ends up "Unknown".
     The v2 connection keys itself with `conn_id` and names the institution
     `org_name`, so a lookup on `id`/`name` finds nothing. */
  const conn = (data.connections ?? []).find(
    (c) => (c?.conn_id ?? c?.id) === a.conn_id,
  );
  check("connection found by conn_id", Boolean(conn));
  check(
    "institution name resolves",
    Boolean(conn?.org_name ?? conn?.name ?? conn?.domain),
    JSON.stringify(conn),
  );

  const t = a.transactions?.[0];
  if (t) {
    check("transaction has id", typeof t.id === "string");
    check("transaction amount is a numeric string", !Number.isNaN(Number(t.amount)));
    check("posted is a positive epoch", Number(t.posted) > 0, `${t.posted}`);
    console.log(`       first: "${t.description}" ${t.amount}`);
  }
}

console.log("\nnotices");
/* errlist is not an error channel: a healthy 200 carries entries like the date
   range being capped. Throwing on any of them would report a working sync as
   broken, and reading `message` instead of `msg` loses them entirely. */
const notices = (data.errlist ?? []).map((e) => e?.msg).filter(Boolean);
console.log(`       errlist: ${notices.length ? notices.join(" | ") : "(none)"}`);
check("no date-range cap at 89 days", !notices.some((n) => /exceeds limit/i.test(n)));
check("notices do not abort the sync", true);

console.log("\nreplay");
const again = await fetch(claimUrl, { method: "POST", headers: { "content-length": "0" } });
check("a spent token is refused", !again.ok, `${again.status}`);
console.log(`       replay -> ${again.status} (403 is the documented code)`);

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);