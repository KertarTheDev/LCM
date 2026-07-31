import { link, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"

/**
 * Publishes a complete private file without overwriting an existing target.
 *
 * The temporary file and final hard link share a directory/filesystem, so the
 * target appears atomically only after all bytes have been written.
 */
export async function writePrivateFileExclusive(target: string, bytes: Uint8Array) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" })
    await link(temporary, target)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
