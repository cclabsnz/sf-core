import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

/**
 * Passphrase encryption for files that hold org data at rest (incident bundles).
 *
 * Format, version 1:
 *
 *   'SFEB' | version (1) | log2(N) (1) | r (1) | p (1) | salt (16) | iv (12) | tag (16) | ciphertext
 *
 * AES-256-GCM with a key from scrypt. The scrypt parameters travel in the header so they can be
 * raised later without stranding existing files, and the whole header is authenticated as GCM
 * additional data, so altering any byte of it fails decryption.
 */
export const ENCRYPTED_MAGIC = Buffer.from('SFEB\x01', 'ascii'); // 'SFEB' + format version 1

/** OWASP's scrypt option N=2^15, r=8, p=3: about 32 MiB and ~0.1-0.2 s per derivation. */
const DEFAULT_KDF = { log2N: 15, r: 8, p: 3 } as const;
/** Bounds accepted when reading a header, so a crafted file cannot demand unbounded memory or time. */
const KDF_LIMITS = { log2N: [14, 20], r: [1, 16], p: [1, 16] } as const;
const MAX_KDF_MEMORY = 1024 * 1024 * 1024;

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = ENCRYPTED_MAGIC.length + 3 + SALT_LEN + IV_LEN; // authenticated as AAD
const MIN_LEN = HEADER_LEN + TAG_LEN;

export class DecryptionError extends Error {
  constructor(message = 'Failed to decrypt data: invalid passphrase or corrupted payload') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Whether `buf` starts with this format's header. Says nothing about whether it will decrypt. */
export function isEncryptedBuffer(buf: Buffer): boolean {
  return buf.length >= MIN_LEN && buf.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC);
}

// One passphrase decrypts every file of a bundle, each with its own salt, and readers revisit
// files. Caching derived keys by (passphrase, salt, params) keeps that from re-running scrypt.
// Keyed by a hash so the passphrase itself is not held as a map key.
const keyCache = new Map<string, Buffer>();
const KEY_CACHE_LIMIT = 256;

function deriveKey(passphrase: string, salt: Buffer, log2N: number, r: number, p: number): Buffer {
  const id = createHash('sha256').update(passphrase).update('\0').update(salt).update(Buffer.from([log2N, r, p])).digest('hex');
  const hit = keyCache.get(id);
  if (hit) return hit;
  const N = 2 ** log2N;
  const key = scryptSync(passphrase, salt, 32, { N, r, p, maxmem: Math.min(MAX_KDF_MEMORY, 256 * N * r) });
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.delete(keyCache.keys().next().value as string);
  keyCache.set(id, key);
  return key;
}

function requirePassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new TypeError('A non-empty passphrase is required');
  }
}

export function encryptWithPassphrase(plaintext: Buffer | string, passphrase: string): Buffer {
  requirePassphrase(passphrase);
  const { log2N, r, p } = DEFAULT_KDF;
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const header = Buffer.concat([ENCRYPTED_MAGIC, Buffer.from([log2N, r, p]), salt, iv]);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt, log2N, r, p), iv);
  cipher.setAAD(header);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
}

export function decryptWithPassphrase(encrypted: Buffer, passphrase: string): Buffer {
  requirePassphrase(passphrase);
  if (!isEncryptedBuffer(encrypted)) {
    throw new DecryptionError('Buffer is not in recognized SFEB encrypted format');
  }
  let o = ENCRYPTED_MAGIC.length;
  const [log2N, r, p] = [encrypted[o++], encrypted[o++], encrypted[o++]];
  const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
  if (!within(log2N, KDF_LIMITS.log2N) || !within(r, KDF_LIMITS.r) || !within(p, KDF_LIMITS.p)) {
    throw new DecryptionError('Encrypted header carries key-derivation parameters outside the accepted range');
  }
  const salt = encrypted.subarray(o, (o += SALT_LEN));
  const iv = encrypted.subarray(o, (o += IV_LEN));
  const header = encrypted.subarray(0, HEADER_LEN);
  const tag = encrypted.subarray(o, (o += TAG_LEN));
  const ciphertext = encrypted.subarray(o);

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt, log2N, r, p), iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}
