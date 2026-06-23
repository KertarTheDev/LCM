// kilocode_change - new file
import { createHash } from "node:crypto"
import type { PGlite } from "@electric-sql/pglite"
import initialSchemaSqlPath from "./migrations/0001_initial_schema.sql" with { type: "file" }
import { createDbMigrationFailedError, isLcmSafeError } from "./db-errors"
import type { LcmSafeError } from "./types"

export interface LcmMigration {
  readonly version: number
  readonly name: string
  readonly sql: string
  readonly checksum: string
}

interface MigrationRow {
  readonly version: number
  readonly name: string
  readonly checksum: string
}

interface TableRow {
  readonly table_name: string
}

async function loadSql(path: string) {
  return Bun.file(path).text()
}

function checksumSql(sql: string) {
  return createHash("sha256").update(sql).digest("hex")
}

let migrationsCache: Promise<LcmMigration[]> | undefined

export function getLcmProductionSchemaVersion() {
  return 1
}

export async function getLcmMigrations(): Promise<LcmMigration[]> {
  migrationsCache ??= (async () => {
    const initialSql = await loadSql(initialSchemaSqlPath)
    return [
      {
        version: 1,
        name: "current_schema",
        sql: initialSql,
        checksum: checksumSql(initialSql),
      },
    ]
  })()
  return migrationsCache
}

async function tableNames(db: PGlite) {
  return (
    await db.query<TableRow>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name LIKE 'lcm_%'
        ORDER BY table_name
      `,
    )
  ).rows.map((row) => row.table_name)
}

async function hasProductionMigrationRegistry(db: PGlite) {
  const names = await tableNames(db)
  if (!names.includes("lcm_migrations")) return false
  const columns = (
    await db.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lcm_migrations'
        ORDER BY ordinal_position
      `,
    )
  ).rows.map((row) => row.column_name)
  if (columns.includes("checksum")) return true
  throw createDbMigrationFailedError({ diagnosticCode: "lcm_unsupported_pre_beta_schema" })
}

async function readAppliedMigrations(db: PGlite) {
  if (!(await hasProductionMigrationRegistry(db))) return []
  return (
    await db.query<MigrationRow>(
      `
        SELECT version, name, checksum
        FROM lcm_migrations
        ORDER BY version
      `,
    )
  ).rows
}

function verifyAppliedMigrations(applied: MigrationRow[], migrations: LcmMigration[]) {
  const expected = new Map(migrations.map((migration) => [migration.version, migration]))
  let previous = 0
  for (const row of applied) {
    if (row.version !== previous + 1) {
      throw createDbMigrationFailedError({ diagnosticCode: "lcm_migration_version_gap" })
    }
    previous = row.version
    const migration = expected.get(row.version)
    if (!migration) {
      throw createDbMigrationFailedError({ diagnosticCode: "lcm_migration_future_version" })
    }
    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      throw createDbMigrationFailedError({ diagnosticCode: "lcm_migration_checksum_mismatch" })
    }
  }
}

export async function runLcmMigrations(db: PGlite) {
  const migrations = await getLcmMigrations()
  const applied = await readAppliedMigrations(db)
  if (applied.length === 0) {
    const existingTables = await tableNames(db)
    if (existingTables.length > 0) {
      throw createDbMigrationFailedError({ diagnosticCode: "lcm_unsupported_pre_beta_schema" })
    }
  }
  verifyAppliedMigrations(applied, migrations)

  const appliedVersions = new Set(applied.map((row) => row.version))
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    try {
      await db.exec(migration.sql)
      await db.query(
        `
          INSERT INTO lcm_migrations (version, name, applied_at_ms, checksum)
          VALUES ($1, $2, $3, $4)
        `,
        [migration.version, migration.name, Date.now(), migration.checksum],
      )
    } catch (error) {
      if (isLcmSafeError(error)) throw error
      throw createDbMigrationFailedError({ diagnosticCode: "lcm_migration_apply_failed" })
    }
  }
}

export function isLcmMigrationSafeError(error: unknown): error is LcmSafeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "db_migration_failed"
  )
}
