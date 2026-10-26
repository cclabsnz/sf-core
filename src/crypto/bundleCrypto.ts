import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

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
 *
 * Format, version 2 (chunked, for files too large to hold in memory):
 *
 *   'SFEB' | version (1) | log2(N) (1) | r (1) | p (1) | log2(chunk) (1) | salt (16) | nonce prefix (7)
 *   then one segment per chunk: ciphertext (chunk bytes, the last one 0..chunk) | tag (16)
 *
 * The STREAM construction (Hoang, Reyhanitabar, Rogaway, Vizár 2015), as age and Tink use it: each
 * chunk is sealed on its own with nonce = prefix | chunk index (4, big-endian) | last-chunk flag (1),
 * and the header is every chunk's additional data. Reordered, repeated, dropped or appended chunks,
 * and a file cut at a chunk boundary, all fail authentication. A reader may emit the chunks before
 * a failure, each of which authenticated, so a consumer must treat a stream error as fatal.
 */
export const ENCRYPTED_PREFIX = Buffer.from('SFEB', 'ascii');
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

const NONCE_PREFIX_LEN = 7;
const V2_HEADER_LEN = ENCRYPTED_PREFIX.length + 1 + 3 + 1 + SALT_LEN + NONCE_PREFIX_LEN;
const V2_MIN_LEN = V2_HEADER_LEN + TAG_LEN; // an empty file still has one (empty, last) chunk
/** 1 KiB to 16 MiB: the upper bound caps what a crafted header can make a reader buffer. */
const CHUNK_LOG2_LIMITS = [10, 24] as const;
const DEFAULT_CHUNK_LOG2 = 16; // 64 KiB
const MAX_CHUNKS = 2 ** 32; // the chunk index is a 4-byte field

export class DecryptionError extends Error {
  constructor(message = 'Failed to decrypt data: invalid passphrase or corrupted payload') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Whether `buf` starts with a header of a known version. Says nothing about whether it will decrypt. */
export function isEncryptedBuffer(buf: Buffer): boolean {
  if (!hasPrefix(buf)) return false;
  const version = buf[ENCRYPTED_PREFIX.length];
  return (version === 1 && buf.length >= MIN_LEN) || (version === 2 && buf.length >= V2_MIN_LEN);
}

function hasPrefix(buf: Buffer): boolean {
  return buf.length > ENCRYPTED_PREFIX.length && buf.subarray(0, ENCRYPTED_PREFIX.length).equals(ENCRYPTED_PREFIX);
}

const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;

/** Reads log2(N), r, p at `o` and refuses values that would demand unbounded memory or time. */
function readKdf(buf: Buffer, o: number): { log2N: number; r: number; p: number } {
  const [log2N, r, p] = [buf[o], buf[o + 1], buf[o + 2]];
  if (!within(log2N, KDF_LIMITS.log2N) || !within(r, KDF_LIMITS.r) || !within(p, KDF_LIMITS.p)) {
    throw new DecryptionError('Encrypted header carries key-derivation parameters outside the accepted range');
  }
  return { log2N, r, p };
}

// One passphrase decrypts every file of a bundle, each with its own salt, and readers revisit
// files. Caching derived keys keeps that from re-running scrypt. Entries are keyed by salt and
// parameters and hold the passphrase they were derived from, compared directly: no fast hash of
// the passphrase is ever computed.
const keyCache = new Map<string, { passphrase: string; key: Buffer }>();
const KEY_CACHE_LIMIT = 256;

function deriveKey(passphrase: string, salt: Buffer, log2N: number, r: number, p: number): Buffer {
  const id = `${salt.toString('hex')}:${log2N}:${r}:${p}`;
  const hit = keyCache.get(id);
  if (hit && hit.passphrase === passphrase) return hit.key;
  const N = 2 ** log2N;
  const key = scryptSync(passphrase, salt, 32, { N, r, p, maxmem: Math.min(MAX_KDF_MEMORY, 256 * N * r) });
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.delete(keyCache.keys().next().value as string);
  keyCache.set(id, { passphrase, key });
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
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt, log2N, r, p), iv, { authTagLength: TAG_LEN });
  cipher.setAAD(header);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
}

export function decryptWithPassphrase(encrypted: Buffer, passphrase: string): Buffer {
  requirePassphrase(passphrase);
  if (!hasPrefix(encrypted)) throw new DecryptionError('Buffer is not in recognized SFEB encrypted format');
  checkVersion(encrypted[ENCRYPTED_PREFIX.length]);
  if (!isEncryptedBuffer(encrypted)) throw new DecryptionError('Encrypted data is truncated');
  if (encrypted[ENCRYPTED_PREFIX.length] === 2) return decryptV2(encrypted, passphrase);
  let o = ENCRYPTED_MAGIC.length;
  const { log2N, r, p } = readKdf(encrypted, o);
  o += 3;
  const salt = encrypted.subarray(o, (o += SALT_LEN));
  const iv = encrypted.subarray(o, (o += IV_LEN));
  const header = encrypted.subarray(0, HEADER_LEN);
  const tag = encrypted.subarray(o, (o += TAG_LEN));
  const ciphertext = encrypted.subarray(o);

  try {
    // A pinned tag length stops a truncated tag from being accepted.
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt, log2N, r, p), iv, { authTagLength: TAG_LEN });
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

function checkVersion(version: number): void {
  if (version !== 1 && version !== 2) throw new DecryptionError(`Unsupported SFEB format version ${version}`);
}

type V2Header = { header: Buffer; key: Buffer; noncePrefix: Buffer; chunkSize: number };

/** Parses and checks a version 2 header, then derives its key. Limits are checked before scrypt runs. */
function openV2Header(header: Buffer, passphrase: string): V2Header {
  let o = ENCRYPTED_PREFIX.length + 1;
  const { log2N, r, p } = readKdf(header, o);
  o += 3;
  const chunkLog2 = header[o++];
  if (!within(chunkLog2, CHUNK_LOG2_LIMITS)) {
    throw new DecryptionError('Encrypted header carries a chunk size outside the accepted range');
  }
  const salt = header.subarray(o, (o += SALT_LEN));
  const noncePrefix = header.subarray(o, (o += NONCE_PREFIX_LEN));
  return { header, key: deriveKey(passphrase, salt, log2N, r, p), noncePrefix, chunkSize: 2 ** chunkLog2 };
}

function chunkNonce(prefix: Buffer, index: number, last: boolean): Buffer {
  if (index >= MAX_CHUNKS) throw new RangeError('Too many chunks for one encrypted file');
  const nonce = Buffer.alloc(IV_LEN);
  prefix.copy(nonce);
  nonce.writeUInt32BE(index, NONCE_PREFIX_LEN);
  nonce[IV_LEN - 1] = last ? 1 : 0;
  return nonce;
}

function sealChunk(h: V2Header, index: number, last: boolean, plain: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', h.key, chunkNonce(h.noncePrefix, index, last), { authTagLength: TAG_LEN });
  cipher.setAAD(h.header);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]);
}

function openChunk(h: V2Header, index: number, last: boolean, segment: Buffer): Buffer {
  if (segment.length < TAG_LEN) throw new DecryptionError('Encrypted data is truncated');
  try {
    const decipher = createDecipheriv('aes-256-gcm', h.key, chunkNonce(h.noncePrefix, index, last), { authTagLength: TAG_LEN });
    decipher.setAAD(h.header);
    decipher.setAuthTag(segment.subarray(segment.length - TAG_LEN));
    return Buffer.concat([decipher.update(segment.subarray(0, segment.length - TAG_LEN)), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

function decryptV2(encrypted: Buffer, passphrase: string): Buffer {
  const h = openV2Header(Buffer.from(encrypted.subarray(0, V2_HEADER_LEN)), passphrase);
  const segment = h.chunkSize + TAG_LEN;
  const out: Buffer[] = [];
  let o = V2_HEADER_LEN;
  let index = 0;
  for (; encrypted.length - o > segment; o += segment) out.push(openChunk(h, index++, false, encrypted.subarray(o, o + segment)));
  out.push(openChunk(h, index, true, encrypted.subarray(o)));
  return Buffer.concat(out);
}

export type EncryptStreamOptions = {
  /** Plaintext bytes per chunk: a power of two from 1 KiB to 16 MiB. Defaults to 64 KiB. */
  chunkSize?: number;
};

/**
 * A Transform that writes version 2 of the format. It holds at most one chunk of plaintext, so a
 * file of any size is encrypted without ever being held whole in memory.
 */
export function createEncryptStream(passphrase: string, options: EncryptStreamOptions = {}): Transform {
  requirePassphrase(passphrase);
  const chunkSize = options.chunkSize ?? 2 ** DEFAULT_CHUNK_LOG2;
  const chunkLog2 = Math.log2(chunkSize);
  if (!Number.isInteger(chunkLog2) || !within(chunkLog2, CHUNK_LOG2_LIMITS)) {
    throw new RangeError('chunkSize must be a power of two from 1 KiB to 16 MiB');
  }
  const { log2N, r, p } = DEFAULT_KDF;
  const salt = randomBytes(SALT_LEN);
  const header = Buffer.concat([ENCRYPTED_PREFIX, Buffer.from([2, log2N, r, p, chunkLog2]), salt, randomBytes(NONCE_PREFIX_LEN)]);
  const h = openV2Header(header, passphrase);
  let pending: Buffer = Buffer.alloc(0);
  let index = 0;
  let started = false;

  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      try {
        if (!started) {
          this.push(header);
          started = true;
        }
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        // Hold back the last full chunk: only the end of input says which chunk is last.
        let o = 0;
        for (; pending.length - o > chunkSize; o += chunkSize) this.push(sealChunk(h, index++, false, pending.subarray(o, o + chunkSize)));
        pending = pending.subarray(o);
        done();
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        if (!started) this.push(header);
        this.push(sealChunk(h, index, true, pending));
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  });
}

/**
 * A Transform that reads either version. Version 2 is decrypted chunk by chunk and only
 * authenticated plaintext is emitted; version 1 is a single sealed blob, so it is buffered whole.
 * Any failure is a DecryptionError, and the chunks emitted before it must not be trusted as a whole
 * file: treat a stream error as fatal.
 */
export function createDecryptStream(passphrase: string): Transform {
  requirePassphrase(passphrase);
  let pending: Buffer = Buffer.alloc(0);
  let version = 0;
  let h: V2Header | undefined;
  let index = 0;

  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      try {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        if (version === 0 && pending.length > ENCRYPTED_PREFIX.length) {
          if (!hasPrefix(pending)) throw new DecryptionError('Buffer is not in recognized SFEB encrypted format');
          version = pending[ENCRYPTED_PREFIX.length];
          checkVersion(version);
        }
        if (version !== 2) return done();
        if (!h) {
          if (pending.length < V2_HEADER_LEN) return done();
          h = openV2Header(Buffer.from(pending.subarray(0, V2_HEADER_LEN)), passphrase);
          pending = pending.subarray(V2_HEADER_LEN);
        }
        const segment = h.chunkSize + TAG_LEN;
        let o = 0;
        for (; pending.length - o > segment; o += segment) this.push(openChunk(h, index++, false, pending.subarray(o, o + segment)));
        pending = pending.subarray(o);
        done();
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        if (version === 0) throw new DecryptionError('Buffer is not in recognized SFEB encrypted format');
        if (version === 1) {
          this.push(decryptWithPassphrase(pending, passphrase));
        } else {
          if (!h) throw new DecryptionError('Encrypted data is truncated');
          this.push(openChunk(h, index, true, pending));
        }
        done();
      } catch (err) {
        done(err as Error);
      }
    },
  });
}
