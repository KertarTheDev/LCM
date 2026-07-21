// kilocode_change - new file
import { PGlite, type PGliteOptions } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import pgliteDataPath from "../../../node_modules/@electric-sql/pglite/dist/pglite.data" with { type: "file" }
import pgliteWasmPath from "../../../node_modules/@electric-sql/pglite/dist/pglite.wasm" with { type: "file" }
import initdbWasmPath from "../../../node_modules/@electric-sql/pglite/dist/initdb.wasm" with { type: "file" }
import pgTrgmBundlePath from "../../../node_modules/@electric-sql/pglite/dist/pg_trgm.tar.gz" with { type: "file" }

type LcmPGliteExtensions = {
  pg_trgm: typeof pg_trgm
}

let pgliteWasmModule: Promise<WebAssembly.Module> | undefined
let initdbWasmModule: Promise<WebAssembly.Module> | undefined
let pgTrgmMaterializedPath: Promise<string> | undefined

async function compileWasm(file: string) {
  return WebAssembly.compile(await Bun.file(file).arrayBuffer())
}

async function materializePgTrgmBundle() {
  const targetDir = path.join(os.tmpdir(), "kilo-lcm-pglite-assets")
  const target = path.join(targetDir, "pg_trgm-0.4.5.tar.gz")
  await fs.mkdir(targetDir, { recursive: true })
  if (!(await Bun.file(target).exists())) {
    await fs.writeFile(target, Buffer.from(await Bun.file(pgTrgmBundlePath).arrayBuffer()))
  }
  return target
}

const lcmPgTrgm: typeof pg_trgm = {
  ...pg_trgm,
  setup: async (pg, emscriptenOpts) => {
    const result = await pg_trgm.setup(pg, emscriptenOpts)
    pgTrgmMaterializedPath ??= materializePgTrgmBundle()
    return {
      ...result,
      bundlePath: pathToFileURL(await pgTrgmMaterializedPath),
    }
  },
}

export async function createLcmPGliteOptions(input: { dataDir?: string } = {}) {
  pgliteWasmModule ??= compileWasm(pgliteWasmPath)
  initdbWasmModule ??= compileWasm(initdbWasmPath)

  return {
    ...(input.dataDir ? { dataDir: input.dataDir } : {}),
    extensions: {
      pg_trgm: lcmPgTrgm,
    },
    pgliteWasmModule: await pgliteWasmModule,
    initdbWasmModule: await initdbWasmModule,
    fsBundle: Bun.file(pgliteDataPath),
  } satisfies PGliteOptions<LcmPGliteExtensions>
}

export async function createLcmPGlite(input: { dataDir?: string } = {}) {
  return PGlite.create(await createLcmPGliteOptions(input))
}

export async function getLcmPGliteAssetReport() {
  pgTrgmMaterializedPath ??= materializePgTrgmBundle()
  const materializedPgTrgmPath = await pgTrgmMaterializedPath
  const assets = [
    { name: "pglite.data", path: pgliteDataPath },
    { name: "pglite.wasm", path: pgliteWasmPath },
    { name: "initdb.wasm", path: initdbWasmPath },
    { name: "pg_trgm.tar.gz", path: pgTrgmBundlePath },
    { name: "pg_trgm.materialized.tar.gz", path: materializedPgTrgmPath },
  ]

  return {
    packageVersion: "0.4.5",
    assets: await Promise.all(
      assets.map(async (asset) => ({
        name: asset.name,
        exists: await Bun.file(asset.path).exists(),
      })),
    ),
  }
}
