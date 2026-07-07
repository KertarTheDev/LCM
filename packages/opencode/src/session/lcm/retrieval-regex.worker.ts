// kilocode_change - new file
import { createLcmPGlite } from "./pglite-assets"

export interface RetrievalRegexCandidate {
  candidateID: string
  searchText: string
}

export interface RetrievalRegexRequest {
  pattern: string
  caseSensitive: boolean
  candidates: RetrievalRegexCandidate[]
}

export interface RetrievalRegexMatch {
  candidateID: string
  charIndex: number
}

function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }
  return {
    name: "Error",
    message: "Unknown regex worker error",
  }
}

onmessage = async (evt: MessageEvent<RetrievalRegexRequest>) => {
  let db: Awaited<ReturnType<typeof createLcmPGlite>> | undefined
  try {
    db = await createLcmPGlite()
    await db.exec(`
      CREATE TEMP TABLE candidates (
        candidate_id text PRIMARY KEY,
        search_text text NOT NULL
      );
    `)

    for (const candidate of evt.data.candidates) {
      await db.query("INSERT INTO candidates (candidate_id, search_text) VALUES ($1, $2)", [
        candidate.candidateID,
        candidate.searchText,
      ])
    }

    const flags = evt.data.caseSensitive ? "" : "i"
    const rows = (
      await db.query<{ candidate_id: string; char_index: number | string }>(
        `
          SELECT
            candidate_id,
            regexp_instr(search_text, $1, 1, 1, 0, $2) AS char_index
          FROM candidates
          WHERE
            CASE
              WHEN $2 = 'i' THEN search_text ~* $1
              ELSE search_text ~ $1
            END
          ORDER BY candidate_id
        `,
        [evt.data.pattern, flags],
      )
    ).rows

    postMessage({
      type: "completed",
      matches: rows.map((row) => ({
        candidateID: row.candidate_id,
        charIndex: Number(row.char_index) - 1,
      })),
    })
  } catch (error) {
    postMessage({ type: "error", error: safeError(error) })
  } finally {
    await db?.close().catch(() => undefined)
  }
}
