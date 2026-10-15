import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  isEncryptedBuffer,
  DecryptionError,
  ENCRYPTED_MAGIC,
} from '../../../src/crypto/bundleCrypto.js';

describe('bundleCrypto', () => {
  const passphrase = 'correct-horse-battery-staple';
  const sampleData = JSON.stringify({ secret: 'forensic log data', ips: ['192.0.2.1', '198.51.100.2'] });

  it('encrypts and decrypts string data losslessly', () => {
    const enc = encryptWithPassphrase(sampleData, passphrase);
    expect(isEncryptedBuffer(enc)).toBe(true);
    expect(enc.subarray(0, 5)).toEqual(ENCRYPTED_MAGIC);

    const decrypted = decryptWithPassphrase(enc, passphrase);
    expect(decrypted.toString('utf-8')).toBe(sampleData);
  });

  it('encrypts and decrypts raw buffer data losslessly', () => {
    const rawBuf = Buffer.from('binary-log-record-\x00\xff\xfe');
    const enc = encryptWithPassphrase(rawBuf, passphrase);
    const decrypted = decryptWithPassphrase(enc, passphrase);
    expect(decrypted.equals(rawBuf)).toBe(true);
  });

  it('throws DecryptionError when given the wrong passphrase', () => {
    const enc = encryptWithPassphrase(sampleData, passphrase);
    expect(() => decryptWithPassphrase(enc, 'wrong-password')).toThrow(DecryptionError);
  });

  it('throws DecryptionError when ciphertext is tampered with', () => {
    const enc = encryptWithPassphrase(sampleData, passphrase);
    // Tamper with the last byte of ciphertext
    enc[enc.length - 1] ^= 0xff;
    expect(() => decryptWithPassphrase(enc, passphrase)).toThrow(DecryptionError);
  });

  it('rejects unencrypted buffers cleanly', () => {
    const plainBuf = Buffer.from('plain unencrypted text that is long enough to meet length check');
    expect(isEncryptedBuffer(plainBuf)).toBe(false);
    expect(() => decryptWithPassphrase(plainBuf, passphrase)).toThrow(DecryptionError);
  });

  describe('header', () => {
    const enc = () => encryptWithPassphrase('payload', passphrase);

    it('records the scrypt parameters it used', () => {
      const buf = enc();
      expect([buf[5], buf[6], buf[7]]).toEqual([15, 8, 3]);
    });

    it('authenticates every header byte: altering the salt, iv or parameters fails decryption', () => {
      for (const at of [5, 6, 7, 8, 30]) {
        const buf = enc();
        buf[at] ^= 0x01;
        expect(() => decryptWithPassphrase(buf, passphrase)).toThrow(DecryptionError);
      }
    });

    it('refuses key-derivation parameters outside the accepted range before running scrypt', () => {
      const buf = enc();
      buf[5] = 30; // log2(N) = 30 would ask for terabytes
      const t = Date.now();
      expect(() => decryptWithPassphrase(buf, passphrase)).toThrow(/outside the accepted range/);
      expect(Date.now() - t).toBeLessThan(1000);
    });

    it('uses a fresh salt and iv per file, so equal plaintexts encrypt differently', () => {
      expect(enc().equals(enc())).toBe(false);
    });
  });

  it('rejects an empty passphrase on both sides', () => {
    expect(() => encryptWithPassphrase('x', '')).toThrow(TypeError);
    expect(() => decryptWithPassphrase(encryptWithPassphrase('x', passphrase), '')).toThrow(TypeError);
  });

  it('does not treat a truncated file as encrypted', () => {
    expect(isEncryptedBuffer(encryptWithPassphrase('x', passphrase).subarray(0, 40))).toBe(false);
  });
});
