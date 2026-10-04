/**
 * Checks the SSRF boundary around SimpleFIN URLs.
 *
 * This guard is the thing standing between a user-supplied string and a server-side
 * fetch that carries a bank credential, so the cases below are the ones that
 * actually matter: not "does a good URL pass" but "does a crafted one get through".
 *
 * The guard lives in simplefin.ts, which cannot be imported here: that module
 * imports "server-only" (an alias Next resolves, but bare Node cannot) and pulls in
 * the database. So the check is parsed out of the source and evaluated on its own.
 * That is a compromise — it would not notice if the function were renamed — but it
 * tests the actual shipped expression rather than a copy of it, which a duplicated
 * helper would not.
 */
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/finance/simplefin.ts", import.meta.url), "utf8"),
  { mode: "strip" },
);

const start = source.indexOf("function assertSimpleFinUrl");
if (start === -1) throw new Error("assertSimpleFinUrl not found in simplefin.ts");

/* The function body, up to its closing brace at the start of a line. */
const body = source.slice(start);
const end = body.indexOf("\n}");
if (end === -1) throw new Error("could not find the end of assertSimpleFinUrl");

/* ALLOWED_HOST is a module constant the function closes over. */
const hostLine = source.match(/const ALLOWED_HOST = .*?;/s)?.[0];
if (!hostLine) throw new Error("ALLOWED_HOST constant not found");

/* hostLine already reads process.env, so the real environment supplies the value.
   Nothing is passed in. */
const assertSimpleFinUrl = new Function(
  `${hostLine}\n${body.slice(0, end + 2)}; return assertSimpleFinUrl;`,
)();

const failures = [];

function accepts(name, url) {
  try {
    assertSimpleFinUrl(url);
    console.log(`  ok   accepts ${name}`);
  } catch {
    console.log(`  FAIL should accept ${name}: ${url}`);
    failures.push(name);
  }
}

function rejects(name, url) {
  try {
    assertSimpleFinUrl(url);
    console.log(`  FAIL should reject ${name}: ${url}`);
    failures.push(name);
  } catch {
    console.log(`  ok   rejects ${name}`);
  }
}

const allowed = process.env.SIMPLEFIN_ALLOWED_HOST ?? "";
console.log(`SIMPLEFIN_ALLOWED_HOST: ${allowed ? allowed : "(unset)"}`);

console.log("\naccepted");
accepts("beta host", "https://beta.simplefin.org/simplefin/claim/abc123");
accepts("apex host", "https://simplefin.org/simplefin/claim/abc123");
accepts("subdomain", "https://sfin.simplefin.org/x");
accepts("credential in userinfo", "https://demo:TOKEN@beta.simplefin.org/simplefin");

console.log("\nnot SimpleFIN");
/* The point of this list is not that these are all blocked, it is that none of
   them can be used to make the server fetch something else. */
rejects("cloud metadata", "http://169.254.169.254/latest/meta-data/");
rejects("localhost", "https://localhost/simplefin/claim/x");
rejects("loopback by ip", "https://127.0.0.1/simplefin/claim/x");
rejects("private range", "https://10.0.0.1/simplefin/claim/x");
rejects("attacker host", "https://evil.example.com/simplefin/claim/x");

console.log("\nhost allowlist escapes");
/* Suffix matching on a hostname is the classic mistake. These are all hosts that
   merely end in the right characters. */
rejects("suffix without dot boundary", "https://notsimplefin.org/simplefin/claim/x");
rejects("hyphen prefix", "https://evil-simplefin.org/simplefin/claim/x");
rejects("subdomain of an impostor", "https://simplefin.org.evil.example.com/x");
rejects("userinfo host confusion", "https://beta.simplefin.org@evil.example.com/x");
rejects("trailing dot", "https://beta.simplefin.org./simplefin/claim/x");

console.log("\nscheme");
rejects("http", "http://beta.simplefin.org/simplefin/claim/x");
rejects("file", "file:///etc/passwd");
rejects("gopher", "gopher://beta.simplefin.org/");

console.log("\nmalformed");
rejects("not a url", "beta.simplefin.org/simplefin/claim/x");
rejects("empty", "");
rejects("whitespace only", "   ");

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);