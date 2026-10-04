/**
 * Round-trips a value through the finance cipher.
 *
 * Worth having as a script rather than a one-off console command: the failure that
 * matters here is silent. A wrong key length throws, which is fine, but a key that
 * decrypts to the wrong thing without complaint would mean the bank credential in
 * the database is unreadable garbage and nothing would say so until a sync failed
 * with a confusing error.
 *
 * Run with the same environment as the dev server:
 *   node --env-file=.env.local scripts/test-finance-crypto.mjs
 */
import { encryptSecret, decryptSecret } from "../src/lib/finance/crypto.ts";

const SECRET = "https://demo:TOKEN-abc123@beta.simplefin.org/simplefin";
const failures = [];

function check(name, condition) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures.push(name);
  }
}

console.log("round trip");
const sealed = encryptSecret(SECRET);
check("decrypts back to the original", decryptSecret(sealed) === SECRET);
check("ciphertext does not contain the secret", !sealed.includes("TOKEN-abc123"));
check("is versioned v1", sealed.startsWith("v1."));
check("has four dot-separated parts", sealed.split(".").length === 4);

console.log("freshness");
const a = encryptSecret(SECRET);
const b = encryptSecret(SECRET);
check("same plaintext yields different ciphertext", a !== b);
check("both still decrypt", decryptSecret(a) === SECRET && decryptSecret(b) === SECRET);

console.log("tampering");
const [version, iv, tag, data] = a.split(".");
/* Flip one character of the ciphertext. GCM must reject this rather than return
   altered bytes, which is the whole reason the tag is stored and checked. */
const flipped = data.slice(0, -1) + (data.at(-1) === "A" ? "B" : "A");
try {
  decryptSecret([version, iv, tag, flipped].join("."));
  check("rejects a modified ciphertext", false);
} catch {
  check("rejects a modified ciphertext", true);
}

try {
  decryptSecret([version, iv, Buffer.alloc(16).toString("base64"), data].join("."));
  check("rejects a wrong tag", false);
} catch {
  check("rejects a wrong tag", true);
}

console.log("malformed input");
for (const [name, payload] of [
  ["not encrypted at all", "https://demo:TOKEN@beta.simplefin.org/simplefin"],
  ["wrong version", "v2.a.b.c"],
  ["too few parts", "v1.only.two"],
]) {
  try {
    decryptSecret(payload);
    check(`rejects ${name}`, false);
  } catch {
    check(`rejects ${name}`, true);
  }
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);