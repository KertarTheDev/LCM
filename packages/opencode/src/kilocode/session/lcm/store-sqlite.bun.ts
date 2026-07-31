import { Database } from "bun:sqlite"
import type { LcmSqliteClient, LcmSqliteModule, SqlValue } from "./store-sqlite-client"

function values(input?: readonly SqlValue[]) {
  return input ? [...input] : []
}

export const open: LcmSqliteModule["open"] = (path) => {
  const db = new Database(path, { create: true, strict: true })
  const client: LcmSqliteClient = {
    exec: (sql) => db.exec(sql),
    run: (sql, input) => {
      db.query(sql).run(...values(input))
    },
    get: <T>(sql: string, input?: readonly SqlValue[]) => db.query(sql).get(...values(input)) as T | undefined,
    all: <T>(sql: string, input?: readonly SqlValue[]) => db.query(sql).all(...values(input)) as T[],
    transaction: <T>(fn: () => T) => {
      db.exec("BEGIN IMMEDIATE")
      try {
        const result = fn()
        db.exec("COMMIT")
        return result
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
    close: () => db.close(),
  }
  return client
}
