import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { secureFs, SECURE_DIR_MODE, SECURE_FILE_MODE } from '../../../src/fs/secureFs.js';

describe('secureFs', () => {
  const tmpBase = path.join(os.tmpdir(), `sf-core-secureFs-test-${Date.now()}`);

  afterAll(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  it('creates directories with 0700 permissions on POSIX systems', () => {
    const dir = path.join(tmpBase, 'dir-sync');
    secureFs.mkdirSync(dir, { recursive: true });

    if (process.platform !== 'win32') {
      const stat = fs.statSync(dir);
      // Mode & 0777 gives the permission bits
      expect(stat.mode & 0o777).toBe(SECURE_DIR_MODE);
    }
  });

  it('asynchronously creates directories with 0700 permissions', async () => {
    const dir = path.join(tmpBase, 'dir-async');
    await secureFs.mkdir(dir, { recursive: true });

    if (process.platform !== 'win32') {
      const stat = fs.statSync(dir);
      expect(stat.mode & 0o777).toBe(SECURE_DIR_MODE);
    }
  });

  it('writes files with 0600 permissions on POSIX systems', () => {
    const file = path.join(tmpBase, 'file-sync.txt');
    secureFs.writeFileSync(file, 'secret data', 'utf-8');

    if (process.platform !== 'win32') {
      const stat = fs.statSync(file);
      expect(stat.mode & 0o777).toBe(SECURE_FILE_MODE);
    }
    expect(fs.readFileSync(file, 'utf-8')).toBe('secret data');
  });

  it('asynchronously writes files with 0600 permissions', async () => {
    const file = path.join(tmpBase, 'file-async.txt');
    await secureFs.writeFile(file, 'async secret data', 'utf-8');

    if (process.platform !== 'win32') {
      const stat = fs.statSync(file);
      expect(stat.mode & 0o777).toBe(SECURE_FILE_MODE);
    }
  });

  it('creates write stream with 0600 permissions', async () => {
    const file = path.join(tmpBase, 'stream.txt');
    const ws = secureFs.createWriteStream(file);
    await new Promise<void>((resolve, reject) => {
      ws.write('stream data');
      ws.end();
      ws.on('finish', () => resolve());
      ws.on('error', reject);
    });

    if (process.platform !== 'win32') {
      const stat = fs.statSync(file);
      expect(stat.mode & 0o777).toBe(SECURE_FILE_MODE);
    }
  });

  it("mkdirSync leaves an existing directory's permissions alone", () => {
    const dir = path.join(tmpBase, 'user-output-dir');
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);
    secureFs.mkdirSync(dir, { recursive: true });

    if (process.platform !== 'win32') {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o755);
    }
  });

  it('ensureSecureDir tightens permissions on existing directories', () => {
    const dir = path.join(tmpBase, 'tighten-dir');
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    secureFs.ensureSecureDir(dir);

    if (process.platform !== 'win32') {
      const stat = fs.statSync(dir);
      expect(stat.mode & 0o777).toBe(SECURE_DIR_MODE);
    }
  });
});
