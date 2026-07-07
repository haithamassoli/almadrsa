/**
 * Web-Crypto helpers for the student code-auth flow.
 *
 * Everything here runs in the default Convex V8 runtime (verified: the
 * deployment supports `crypto.getRandomValues`, `crypto.subtle.digest` and
 * PBKDF2 `deriveBits` in queries, mutations, actions and HTTP actions).
 * Never add "use node" to this file and never import Node builtins.
 *
 * CPU note: `hashPin` (PBKDF2, 120k iterations) is deliberately expensive —
 * only call it from HTTP actions/actions, never from queries or mutations.
 */

// Crockford base32 alphabet — 32 symbols, no I, L, O, U (avoids misreading).
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 26; // 26 chars x 5 bits = 130 bits of entropy
const CODE_GROUPS = [5, 5, 5, 5, 6]; // "XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX"

const PBKDF2_ITERATIONS = 120_000; // ≥100k per policy

/** SHA-256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return toHex(new Uint8Array(digest));
}

/**
 * New access code: 26 random Crockford-base32 chars (~130 bits), formatted
 * "XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX". Hash `normalizeCode(code)`, never the
 * formatted string.
 */
export function generateAccessCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 = 8 x 32, so `byte % 32` is exactly uniform over the alphabet.
  let flat = "";
  for (const b of bytes) flat += CODE_ALPHABET[b % 32];
  const groups: string[] = [];
  let offset = 0;
  for (const size of CODE_GROUPS) {
    groups.push(flat.slice(offset, offset + size));
    offset += size;
  }
  return groups.join("-");
}

/**
 * Canonical form of a user-entered code: uppercase, all separators and
 * whitespace stripped (anything outside [0-9A-Z]). This is the form that
 * gets hashed and stored/compared.
 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** 32 random bytes as base64url (43 chars) — session & device tokens. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** 16 random bytes as hex — per-code PIN salt. */
export function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * PBKDF2-SHA256(pin, salt) with 120k iterations, 32-byte key, hex output.
 * HTTP actions/actions only (CPU-heavy).
 */
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** Constant-time equality for hash strings (both sides same charset/length). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ——— Encoding internals ———

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += B64URL[b2 & 63];
  }
  return out;
}
