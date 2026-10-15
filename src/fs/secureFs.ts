// src/fs/secureFs.ts
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

/**
 * POSIX permissions for local sensitive storage:
 * - Directories: 0700 (drwx------) readable/writable/traversable only by the owner
 * - Files: 0600 (-rw-------) readable/writable only by the owner
 */
export const SECURE_DIR_MODE = 0o700;
export const SECURE_FILE_MODE = 0o600;

function safeChmodSync(path: fs.PathLike, mode: number): void {
  try {
    fs.chmodSync(path, mode);
  } catch {
    // Non-fatal on Windows, read-only filesystems, or EPERM
  }
}

async function safeChmod(path: fs.PathLike, mode: number): Promise<void> {
  try {
    await fsp.chmod(path, mode);
  } catch {
    // Non-fatal on Windows, read-only filesystems, or EPERM
  }
}

export const secureFs = {
  /**
   * Synchronously creates a directory (and, with `recursive`, any missing parents) with mode 0o700.
   * A directory that already exists is left as it is: callers pass user-chosen output paths here, and
   * tightening someone's existing folder is not ours to do. Store roots use ensureSecureDir instead.
   */
  mkdirSync(dirPath: fs.PathLike, options?: fs.MakeDirectoryOptions): string | undefined {
    return fs.mkdirSync(dirPath, { ...options, mode: SECURE_DIR_MODE }); // invariant:allow
  },

  /**
   * Asynchronously creates a directory with mode 0o700. Existing directories are left as they are.
   */
  async mkdir(dirPath: fs.PathLike, options?: fs.MakeDirectoryOptions): Promise<string | undefined> {
    return fsp.mkdir(dirPath, { ...options, mode: SECURE_DIR_MODE }); // invariant:allow
  },

  /**
   * Synchronously writes data to a file with mode 0o600.
   */
  writeFileSync( // invariant:allow — method definition, not a call
    filePath: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: fs.WriteFileOptions,
  ): void {
    if (typeof options === 'string') {
      fs.writeFileSync(filePath, data, { encoding: options, mode: SECURE_FILE_MODE }); // invariant:allow
    } else {
      fs.writeFileSync(filePath, data, { ...options, mode: SECURE_FILE_MODE }); // invariant:allow
    }
    if (typeof filePath === 'string' || Buffer.isBuffer(filePath) || filePath instanceof URL) {
      safeChmodSync(filePath, SECURE_FILE_MODE);
    }
  },

  /**
   * Asynchronously writes data to a file with mode 0o600.
   */
  async writeFile( // invariant:allow — method definition, not a call
    filePath: fs.PathLike | fsp.FileHandle,
    data: string | NodeJS.ArrayBufferView,
    options?: fs.WriteFileOptions,
  ): Promise<void> {
    if (typeof options === 'string') {
      await fsp.writeFile(filePath, data, { encoding: options, mode: SECURE_FILE_MODE }); // invariant:allow
    } else {
      await fsp.writeFile(filePath, data, { ...options, mode: SECURE_FILE_MODE }); // invariant:allow
    }
    if (typeof filePath === 'string' || Buffer.isBuffer(filePath) || filePath instanceof URL) {
      await safeChmod(filePath, SECURE_FILE_MODE);
    }
  },

  /**
   * Creates a write stream with mode 0o600.
   */
  createWriteStream(filePath: fs.PathLike, options?: Parameters<typeof fs.createWriteStream>[1]): fs.WriteStream {
    if (typeof options === 'string') {
      return fs.createWriteStream(filePath, { encoding: options as BufferEncoding, mode: SECURE_FILE_MODE }); // invariant:allow
    }
    return fs.createWriteStream(filePath, { ...(options as object), mode: SECURE_FILE_MODE }); // invariant:allow
  },

  /**
   * Ensures a directory exists with 0o700 permissions.
   */
  ensureSecureDir(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      safeChmodSync(dirPath, SECURE_DIR_MODE);
    } else {
      this.mkdirSync(dirPath, { recursive: true });
    }
  },

  /**
   * Asynchronously ensures a directory exists with 0o700 permissions.
   */
  async ensureSecureDirAsync(dirPath: string): Promise<void> {
    try {
      await fsp.access(dirPath);
      await safeChmod(dirPath, SECURE_DIR_MODE);
    } catch {
      await this.mkdir(dirPath, { recursive: true });
    }
  },
};
