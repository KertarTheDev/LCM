import { rm } from "fs/promises"
import os from "os" // kilocode_change
import path from "path" // kilocode_change
import { Database } from "@opencode-ai/core/database/database"
import { Database as LegacyDatabase } from "../../src/storage/db" // kilocode_change
import { disposeAllInstances } from "./fixture"

export async function resetDatabase() {
  // kilocode_change start
  // Never reset a disk-backed database unless the isolated test runner created and named it explicitly.
  const dbPath = Database.path()
  const shared = process.env.KILO_TEST_SHARED_DB_PATH
  const tmpRoot = path.resolve(os.tmpdir())
  const sharedDirectory = shared === undefined ? undefined : path.dirname(path.resolve(shared))
  const safeShared =
    shared !== undefined &&
    path.resolve(dbPath) === path.resolve(shared) &&
    (sharedDirectory === tmpRoot || sharedDirectory?.startsWith(`${tmpRoot}${path.sep}`)) &&
    path.basename(shared).startsWith("kilo-lcm-test-")
  if (dbPath !== ":memory:" && !safeShared) throw new Error(`Refusing to reset non-test database: ${dbPath}`)
  // kilocode_change end
  await disposeAllInstances().catch(() => undefined)
  if (safeShared) LegacyDatabase.close() // kilocode_change - release the retained V1 connection before unlinking
  await rm(dbPath, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined)
}
