import { rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { secureFs } from '../fs/secureFs.js';

/**
 * Streams a response body to disk without ever holding it as a JS string (which would fail on logs
 * larger than ~512 MB). Creates parent directories, never leaves a partial file behind, and returns
 * the number of bytes written. Shared by both REST clients.
 */
export async function streamToFile(body: ReadableStream<Uint8Array>, destPath: string): Promise<number> {
  await secureFs.mkdir(dirname(destPath), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), secureFs.createWriteStream(destPath));
  } catch (err) {
    await rm(destPath, { force: true }); // never leave a partial file behind
    throw err;
  }
  return (await stat(destPath)).size;
}
