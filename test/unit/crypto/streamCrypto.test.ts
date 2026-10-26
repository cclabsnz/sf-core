import { randomBytes } from 'node:crypto';
import { Readable, type Transform } from 'node:stream';
import {
  createDecryptStream,
  createEncryptStream,
  decryptWithPassphrase,
  DecryptionError,
  encryptWithPassphrase,
  ENCRYPTED_PREFIX,
  isEncryptedBuffer,
} from '../../../src/crypto/bundleCrypto.js';

const passphrase = 'correct-horse-battery-staple';
const CHUNK = 1024; // the smallest chunk size the format accepts, so tests cross many boundaries
const HEADER = 32;
const SEGMENT = CHUNK + 16; // ciphertext chunk + GCM tag

/** Feeds `input` through `t` in uneven pieces, so no write lines up with a chunk boundary. */
async function run(t: Transform, input: Buffer): Promise<Buffer> {
  const pieces: Buffer[] = [];
  for (let o = 0, n = 1; o < input.length; o += n, n = (n * 7 + 3) % 1500 || 1) pieces.push(input.subarray(o, o + n));
  const out: Buffer[] = [];
  for await (const c of Readable.from(pieces).pipe(t)) out.push(c as Buffer);
  return Buffer.concat(out);
}

const encrypt = (data: Buffer, chunkSize = CHUNK) => run(createEncryptStream(passphrase, { chunkSize }), data);
const decrypt = (data: Buffer, pass = passphrase) => run(createDecryptStream(pass), data);

/** Splits a version 2 file into its header and per-chunk segments. */
function segments(enc: Buffer): { header: Buffer; segs: Buffer[] } {
  const segs: Buffer[] = [];
  for (let o = HEADER; o < enc.length; o += SEGMENT) segs.push(enc.subarray(o, o + SEGMENT));
  return { header: enc.subarray(0, HEADER), segs };
}

describe('streaming encryption (format version 2)', () => {
  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 517])(
    'round-trips %i bytes written in uneven pieces',
    async (size) => {
      const data = randomBytes(size);
      const enc = await encrypt(data);
      expect((await decrypt(enc)).equals(data)).toBe(true);
    },
  );

  it('writes the SFEB prefix and version 2, and is recognised as encrypted', async () => {
    const enc = await encrypt(Buffer.from('payload'));
    expect(enc.subarray(0, 4)).toEqual(ENCRYPTED_PREFIX);
    expect(enc[4]).toBe(2);
    expect(isEncryptedBuffer(enc)).toBe(true);
  });

  it('can be read in memory by decryptWithPassphrase', async () => {
    const data = randomBytes(2 * CHUNK + 9);
    expect(decryptWithPassphrase(await encrypt(data), passphrase).equals(data)).toBe(true);
  });

  it.each([3 * CHUNK, 3 * CHUNK + 1])('decryptWithPassphrase reads a %i-byte version 2 file in memory', async (size) => {
    const data = randomBytes(size);
    expect(decryptWithPassphrase(await encrypt(data), passphrase).equals(data)).toBe(true);
  });

  it('refuses a version 1 input larger than a version 1 file can be, instead of buffering it', async () => {
    const t = createDecryptStream(passphrase);
    const head = encryptWithPassphrase('x', passphrase).subarray(0, 52);
    const done = new Promise((_, reject) => {
      t.on('error', reject);
    });
    t.resume();
    t.write(head);
    const piece = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 70 && !t.destroyed; i++) t.write(piece);
    await expect(done).rejects.toThrow(/too large/);
  });

  it('pushes a header copy, so a consumer that edits its output cannot corrupt later chunks', async () => {
    const t = createEncryptStream(passphrase, { chunkSize: CHUNK });
    const out: Buffer[] = [];
    t.on('data', (c: Buffer) => {
      out.push(Buffer.from(c));
      c.fill(0);
    });
    const data = randomBytes(3 * CHUNK);
    t.end(data);
    await new Promise((r) => {
      t.on('end', r);
    });
    expect((await decrypt(Buffer.concat(out))).equals(data)).toBe(true);
  });

  it('can still read version 1 files in a stream', async () => {
    const data = Buffer.from('a version 1 file');
    expect((await decrypt(encryptWithPassphrase(data, passphrase))).equals(data)).toBe(true);
  });

  it('emits ciphertext before the input ends, so a file is never held whole', async () => {
    const t = createEncryptStream(passphrase, { chunkSize: CHUNK });
    const seen: Buffer[] = [];
    t.on('data', (c: Buffer) => seen.push(c));
    t.write(randomBytes(5 * CHUNK));
    await new Promise((r) => {
      setImmediate(r);
    });
    expect(Buffer.concat(seen).length).toBeGreaterThanOrEqual(HEADER + 4 * SEGMENT);
    t.end();
  });

  it('uses the default 64 KiB chunk size when none is given', async () => {
    const enc = await run(createEncryptStream(passphrase), randomBytes(64 * 1024 + 1));
    expect(enc.length).toBe(HEADER + (64 * 1024 + 16) + (1 + 16));
  });

  it('seals a plaintext that fills its chunks exactly as that many chunks, the last one marked', async () => {
    expect((await encrypt(randomBytes(3 * CHUNK))).length).toBe(HEADER + 3 * SEGMENT);
  });

  it.each([0, 1000, 512, 2 ** 25])('refuses chunk size %i', (chunkSize) => {
    expect(() => createEncryptStream(passphrase, { chunkSize })).toThrow(RangeError);
  });

  it('rejects an empty passphrase on both sides', () => {
    expect(() => createEncryptStream('')).toThrow(TypeError);
    expect(() => createDecryptStream('')).toThrow(TypeError);
  });

  it('uses a fresh salt and nonce per file, so equal plaintexts encrypt differently', async () => {
    const data = Buffer.from('same');
    expect((await encrypt(data)).equals(await encrypt(data))).toBe(false);
  });

  describe('refuses a damaged or altered file', () => {
    const data = randomBytes(4 * CHUNK + 100); // four full chunks and a short last one

    it('a wrong passphrase, emitting no plaintext', async () => {
      const t = createDecryptStream('wrong-passphrase');
      const out: Buffer[] = [];
      t.on('data', (c: Buffer) => out.push(c));
      await expect(run(t, await encrypt(data))).rejects.toThrow(DecryptionError);
      expect(out).toHaveLength(0);
    });

    it('a flipped ciphertext byte', async () => {
      const enc = await encrypt(data);
      enc[HEADER + SEGMENT + 5] ^= 1;
      await expect(decrypt(enc)).rejects.toThrow(DecryptionError);
    });

    it('any altered header byte', async () => {
      for (const at of [4, 5, 6, 7, 8, 9, 20, 31]) {
        const enc = await encrypt(data);
        enc[at] ^= 1;
        await expect(decrypt(enc)).rejects.toThrow(DecryptionError);
      }
    });

    it('truncation at a chunk boundary', async () => {
      const enc = await encrypt(data);
      await expect(decrypt(enc.subarray(0, HEADER + 2 * SEGMENT))).rejects.toThrow(DecryptionError);
    });

    it('a dropped last chunk when the plaintext fills its chunks exactly', async () => {
      const enc = await encrypt(randomBytes(3 * CHUNK));
      await expect(decrypt(enc.subarray(0, HEADER + 2 * SEGMENT))).rejects.toThrow(DecryptionError);
    });

    it('truncation inside a chunk', async () => {
      const enc = await encrypt(data);
      await expect(decrypt(enc.subarray(0, enc.length - 3))).rejects.toThrow(DecryptionError);
    });

    it('a header with no chunks at all', async () => {
      const enc = await encrypt(Buffer.alloc(0));
      await expect(decrypt(enc.subarray(0, HEADER))).rejects.toThrow(DecryptionError);
    });

    it('two chunks swapped', async () => {
      const { header, segs } = segments(await encrypt(data));
      [segs[1], segs[2]] = [segs[2], segs[1]];
      await expect(decrypt(Buffer.concat([header, ...segs]))).rejects.toThrow(DecryptionError);
    });

    it('a chunk repeated', async () => {
      const { header, segs } = segments(await encrypt(data));
      await expect(decrypt(Buffer.concat([header, segs[0], ...segs]))).rejects.toThrow(DecryptionError);
    });

    it('bytes appended after the last chunk', async () => {
      const enc = await encrypt(data);
      await expect(decrypt(Buffer.concat([enc, randomBytes(SEGMENT)]))).rejects.toThrow(DecryptionError);
    });

    it('a chunk taken from another file under the same passphrase', async () => {
      const a = segments(await encrypt(data));
      const b = segments(await encrypt(data));
      a.segs[1] = b.segs[1];
      await expect(decrypt(Buffer.concat([a.header, ...a.segs]))).rejects.toThrow(DecryptionError);
    });

    it('never emits the plaintext of a chunk that fails authentication', async () => {
      const plain = Buffer.alloc(4 * CHUNK, 0x41);
      const enc = await encrypt(plain);
      enc[HEADER + 2 * SEGMENT + 1] ^= 1; // third chunk
      const t = createDecryptStream(passphrase);
      const out: Buffer[] = [];
      t.on('data', (c: Buffer) => out.push(c));
      await expect(run(t, enc)).rejects.toThrow(DecryptionError);
      expect(Buffer.concat(out).length).toBeLessThanOrEqual(2 * CHUNK);
    });

    it('a rewritten chunk size, which no key or nonce depends on', async () => {
      const enc = await encrypt(Buffer.from('one short chunk'));
      enc[8] += 1; // still one segment under either size: only the header AAD notices
      await expect(decrypt(enc)).rejects.toThrow(DecryptionError);
      expect(() => decryptWithPassphrase(enc, passphrase)).toThrow(DecryptionError);
    });

    it('in memory too: decryptWithPassphrase refuses a truncated version 2 file', async () => {
      const enc = await encrypt(data);
      expect(() => decryptWithPassphrase(enc.subarray(0, HEADER + SEGMENT), passphrase)).toThrow(DecryptionError);
    });

    it('a plaintext input', async () => {
      await expect(decrypt(Buffer.from('{"plain":"json manifest, long enough to fill a header"}'))).rejects.toThrow(
        /not in recognized SFEB encrypted format/,
      );
    });

    it('an unknown format version', async () => {
      const enc = await encrypt(data);
      enc[4] = 9;
      await expect(decrypt(enc)).rejects.toThrow(/unsupported/i);
    });
  });

  describe('header limits, checked before scrypt runs', () => {
    it('refuses a costly scrypt combination even when each parameter is in range', async () => {
      const enc = await encrypt(Buffer.from('x'));
      [enc[5], enc[6], enc[7]] = [17, 8, 16]; // 128 MiB, under the memory cap, but ~21x the default work
      const t = Date.now();
      await expect(decrypt(enc)).rejects.toThrow(/outside the accepted range/);
      expect(Date.now() - t).toBeLessThan(1000);
    });

    it('refuses scrypt memory beyond the cap as a DecryptionError, not a RangeError', async () => {
      const enc = await encrypt(Buffer.from('x'));
      [enc[5], enc[6], enc[7]] = [20, 16, 1];
      await expect(decrypt(enc)).rejects.toThrow(DecryptionError);
    });
    it('refuses key-derivation parameters outside the accepted range', async () => {
      const enc = await encrypt(Buffer.from('x'));
      enc[5] = 30; // log2(N) = 30 would ask for terabytes
      const t = Date.now();
      await expect(decrypt(enc)).rejects.toThrow(/outside the accepted range/);
      expect(Date.now() - t).toBeLessThan(1000);
    });

    it('refuses a chunk size outside the accepted range', async () => {
      const enc = await encrypt(Buffer.from('x'));
      enc[8] = 31; // 2 GiB chunks would let a crafted file demand that much memory
      await expect(decrypt(enc)).rejects.toThrow(/outside the accepted range/);
    });
  });
});
