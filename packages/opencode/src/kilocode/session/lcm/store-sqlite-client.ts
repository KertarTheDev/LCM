export type SqlValue = string | number | bigint | Uint8Array | null

export interface LcmSqliteClient {
  exec(sql: string): void
  run(sql: string, values?: readonly SqlValue[]): void
  get<T>(sql: string, values?: readonly SqlValue[]): T | undefined
  all<T>(sql: string, values?: readonly SqlValue[]): T[]
  transaction<T>(fn: () => T): T
  close(): void
}

export interface LcmSqliteModule {
  open(path: string): LcmSqliteClient
}
