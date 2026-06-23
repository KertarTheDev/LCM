// kilocode_change - new file
import { EOL } from "node:os"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { diagnoseLcmDb, rebuildLcmDb, runLcmDbSmoke, LCM_DB_GATE_SCHEMA_VERSION } from "../../../session/lcm/db-smoke"
import type { LcmDbSmokeRuntimeMode } from "../../../session/lcm/types"

const runtimeModes = ["source", "compiled-bin", "serve", "vscode-bundled"] as const

function writeJson(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + EOL)
}

function exitAfterFlush(code = 0): never {
  process.exit(code)
}

function runtimeMode(value: unknown): LcmDbSmokeRuntimeMode {
  return runtimeModes.includes(value as LcmDbSmokeRuntimeMode) ? (value as LcmDbSmokeRuntimeMode) : "source"
}

export const LcmDbSmokeCommand = cmd({
  command: "lcm-db-smoke",
  describe: "run the content-safe LCM PGlite backend smoke",
  builder: (yargs) =>
    yargs
      .option("data-dir", {
        type: "string",
        demandOption: true,
        describe: "Explicit LCM family root, normally <kilo-data-dir>/lcm/families/<family-id>",
      })
      .option("runtime-mode", {
        type: "string",
        choices: runtimeModes,
        default: "source",
        describe: "runtime layout being exercised",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON report",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = await runLcmDbSmoke({
        dataDir: args.dataDir,
        runtimeMode: runtimeMode(args.runtimeMode),
        schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
      })
      writeJson(report)
      exitAfterFlush(report.status === "passed" ? 0 : 1)
    })
  },
})

export const LcmDbDiagnoseCommand = cmd({
  command: "lcm-db-diagnose",
  describe: "run content-safe LCM DB diagnosis",
  builder: (yargs) =>
    yargs
      .option("data-dir", {
        type: "string",
        demandOption: true,
        describe: "Explicit LCM family root, normally <kilo-data-dir>/lcm/families/<family-id>",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON report",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      writeJson(
        await diagnoseLcmDb({
          dataDir: args.dataDir,
          schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
        }),
      )
      exitAfterFlush()
    })
  },
})

export const LcmDbRebuildCommand = cmd({
  command: "lcm-db-rebuild",
  describe: "run content-safe LCM DB rebuild support",
  builder: (yargs) =>
    yargs
      .option("data-dir", {
        type: "string",
        demandOption: true,
        describe: "Explicit LCM family root, normally <kilo-data-dir>/lcm/families/<family-id>",
      })
      .option("dry-run", {
        type: "boolean",
        conflicts: "apply",
        describe: "report the rebuild action without changing DB files",
      })
      .option("apply", {
        type: "boolean",
        conflicts: "dry-run",
        describe: "quarantine the current PGlite directory and initialize a fresh one",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON report",
      })
      .check((args) => {
        if (args.dataDir === undefined) return true
        if (!args.dryRun && !args.apply) throw new Error("lcm-db-rebuild requires --dry-run or --apply")
        return true
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      writeJson(
        await rebuildLcmDb({
          dataDir: args.dataDir,
          schemaVersion: LCM_DB_GATE_SCHEMA_VERSION,
          dryRun: !args.apply,
        }),
      )
      exitAfterFlush()
    })
  },
})
