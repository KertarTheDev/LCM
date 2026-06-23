// kilocode_change - new file
import { createLcmPGlite } from "./pglite-assets"

type RegexCancelRequest = {
  pattern: string
}

function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
    }
  }
  return {
    name: "Error",
  }
}

onmessage = async (evt: MessageEvent<RegexCancelRequest>) => {
  let db: Awaited<ReturnType<typeof createLcmPGlite>> | undefined
  try {
    db = await createLcmPGlite()
    await db.exec(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `)
    postMessage({ type: "started" })
    await db.query("SELECT count(*) FROM generate_series(1, 1000000000) AS s(i) WHERE i::text ~ $1", [evt.data.pattern])
    postMessage({ type: "completed" })
  } catch (error) {
    postMessage({ type: "error", error: safeError(error) })
  } finally {
    await db?.close().catch(() => undefined)
  }
}
