import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for the SimpleFIN access URL, which is a live bank credential.
 *
 * AES-256-GCM. Authenticated, so a tampered ciphertext fails to decrypt instead of
 * returning plausible garbage, and the tag is checked on read rather than trusted.
 *
 * The key is a 32-byte value from FINANCE_ENCRYPTION_KEY, given as 64 hex
 * characters or as base64. Throws at call time rather than at import when it is
 * missing or the wrong length: a module-level throw would take down every route
 * that happens to import this, including ones that never touch finance, and the
 * failure would point at the wrong file. Only the sync and connect routes read
 * money, so only those should fail when the key is absent.
 *
 * The format is versioned. `v1.<iv>.<tag>.<ciphertext>`, all base64. GCM's IV is
 * 96 bits and is never reused across encryptions — a fresh random one per call,
 * which is what keeps this secure rather than merely obfuscated. Prefixing the
 * version means a future scheme can be added and old rows still decrypt, instead
 * of the column becoming unreadable the day the cipher changes.
 */
const VERSION = "v1";
const IV_BYTES = 12;
/* GCM's tag is always 16 bytes. The decipher side hands the stored tag to
   setAuthTag without checking its length, so this is asserted explicitly rather
   than assumed: a short tag from a corrupted row would otherwise be accepted and
   quietly weaken the authentication. */
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function key(): Buffer {
  const raw = process.env.FINANCE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "FINANCE_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const buf = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `FINANCE_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}.`,
    );
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    /* Not ours, or from a scheme this build cannot read. Either way the value is
       unrecoverable here, and saying so beats returning something wrong. */
    throw new Error("Stored finance credential is not a readable v1 payload.");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    /* Checked because setAuthTag accepts whatever it is given. A truncated or
       corrupted segment would otherwise reach the cipher as a short tag and be
       rejected with an opaque OpenSSL error, or worse, accepted under a weakened
       authentication. The length is checked here so the error names the column. */
    throw new Error(
      `Stored finance credential is malformed: expected a ${IV_BYTES}-byte iv and ` +
        `a ${TAG_BYTES}-byte tag, got ${iv.length} and ${tag.length}.`,
    );
  }

  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  /* Without this the tag is not verified on decrypt and GCM degrades to
     unauthenticated CTR, which is the actual bug rather than a missing option. */
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}