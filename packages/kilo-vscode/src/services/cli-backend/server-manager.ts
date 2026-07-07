import { execFileSync, type ChildProcess } from "child_process"
import { spawn } from "../../util/process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { resolveLocalBwrapEnv, resolveTreeSitterEnv } from "./cli-resources"
import { t } from "./i18n"
import { parseServerPort } from "./server-utils"
import { debugLog } from "./debug-log"

export interface ServerInstance {
  port: number
  password: string
  process: ChildProcess
  launchID: string
}

const STARTUP_TIMEOUT_SECONDS = 30
const MANAGED_SERVER_MARKER_VERSION = 1
const MANAGED_SERVER_SHUTDOWN_GRACE_MS = 5_000
const MANAGED_SERVER_KILL_GRACE_MS = 1_000

type WorkspaceFolderLike = { uri: { fsPath: string } }
type ServerExitListener = (code: number | null) => void

export interface ManagedServerMarker {
  version: typeof MANAGED_SERVER_MARKER_VERSION
  launchID: string
  pid: number
  extensionHostPid: number
  cliPath: string
  cwd: string
  startedAt: string
  extensionVersion: string
  port?: number
}

export interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

export function resolveServerCwd(folders: readonly WorkspaceFolderLike[] | undefined, storage: string): string {
  return folders?.[0]?.uri.fsPath ?? storage
}

export function resolveIndexingEnv(folders: readonly WorkspaceFolderLike[] | undefined): Record<string, string> {
  if (folders && folders.length > 0) return {}
  return { KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" }
}

export function resolveManagedServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, KILO_DISABLE_CHANNEL_DB: "true" }
}

export function managedServerMarkerDir(globalStoragePath: string): string {
  return path.join(globalStoragePath, "managed-server")
}

export function managedServerMarkerPath(globalStoragePath: string, launchID: string): string {
  return path.join(managedServerMarkerDir(globalStoragePath), `server-${launchID}.json`)
}

function normalizedForCommand(value: string): string {
  return value.replace(/\\/g, "/")
}

function commandHasServePortZero(command: string): boolean {
  return /\bserve\b/.test(command) && /(?:^|\s)--port(?:=|\s+)0(?:\s|$)/.test(command)
}

export function commandMatchesManagedServerMarker(
  command: string,
  marker: Pick<ManagedServerMarker, "cliPath">,
): boolean {
  const normalizedCommand = normalizedForCommand(command)
  const normalizedCliPath = normalizedForCommand(marker.cliPath)
  return normalizedCommand.includes(normalizedCliPath) && commandHasServePortZero(normalizedCommand)
}

export function commandLooksLikeLegacyManagedServer(
  command: string,
  input: { cliPath: string; extensionPath: string; extensionID: string },
): boolean {
  const normalizedCommand = normalizedForCommand(command)
  if (!commandHasServePortZero(normalizedCommand)) return false

  const normalizedCliPath = normalizedForCommand(input.cliPath)
  if (normalizedCommand.includes(normalizedCliPath)) return true

  const extensionRoot = normalizedForCommand(path.dirname(input.extensionPath))
  const extensionPrefix = `${extensionRoot}/${input.extensionID}`
  return normalizedCommand.includes(`${extensionPrefix}-`) && /\/bin\/kilo(?:\.exe)?(?:\s|$)/.test(normalizedCommand)
}

export function parsePosixProcessList(text: string): ProcessRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
      if (!match) return undefined
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3]!.trim() }
    })
    .filter((row): row is ProcessRow => !!row && Number.isFinite(row.pid) && Number.isFinite(row.ppid))
}

function pidIsLive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (
      typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EPERM"
    )
  }
}

function readProcessCommand(pid: number): string | undefined {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("wmic", ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/value"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 2_000,
      })
      return output
        .split(/\r?\n/)
        .find((line) => line.startsWith("CommandLine="))
        ?.slice("CommandLine=".length)
        .trim()
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim()
  } catch {
    return undefined
  }
}

function listProcesses(): ProcessRow[] {
  if (process.platform === "win32") return []
  try {
    return parsePosixProcessList(
      execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", timeout: 3_000 }),
    )
  } catch {
    return []
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (pidIsLive(pid)) {
    if (Date.now() - started >= timeoutMs) return false
    await sleep(100)
  }
  return true
}

function safeReadMarker(file: string): ManagedServerMarker | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ManagedServerMarker>
    if (
      parsed.version !== MANAGED_SERVER_MARKER_VERSION ||
      typeof parsed.launchID !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.extensionHostPid !== "number" ||
      typeof parsed.cliPath !== "string" ||
      typeof parsed.cwd !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.extensionVersion !== "string"
    ) {
      return undefined
    }
    return parsed as ManagedServerMarker
  } catch {
    return undefined
  }
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null
  private cleanupPromise: Promise<void> | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onExit?: ServerExitListener,
  ) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    debugLog("[Kilo New] ServerManager: 🔍 getServer called")
    if (this.instance) {
      debugLog("[Kilo New] ServerManager: ♻️ Returning existing instance:", { port: this.instance.port })
      return this.instance
    }

    if (this.startupPromise) {
      debugLog("[Kilo New] ServerManager: ⏳ Startup already in progress, waiting...")
      return this.startupPromise
    }

    debugLog("[Kilo New] ServerManager: 🚀 Starting new server instance...")
    this.startupPromise = this.cleanupOrphanedManagedServers().then(() => this.startServer())
    try {
      this.instance = await this.startupPromise
      debugLog("[Kilo New] ServerManager: ✅ Server started successfully:", { port: this.instance.port })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const launchID = crypto.randomUUID()
    const cliPath = this.getCliPath()
    debugLog("[Kilo New] ServerManager: 📍 CLI path:", cliPath)
    debugLog("[Kilo New] ServerManager: 🔐 Generated password (length):", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    debugLog("[Kilo New] ServerManager: 📄 CLI isFile:", stat.isFile())
    debugLog("[Kilo New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    return new Promise((resolve, reject) => {
      debugLog("[Kilo New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const cfg = vscode.workspace.getConfiguration("kilo-code.new")
      const claudeCompat = cfg.get<boolean>("claudeCodeCompat", false)
      // Pin cwd so the CLI doesn't inherit the extension host's cwd ("/" under F5 debug)
      // or "$HOME" in empty VS Code windows.
      const folders = vscode.workspace.workspaceFolders
      const spawnCwd = resolveServerCwd(folders, this.context.globalStorageUri.fsPath)
      fs.mkdirSync(spawnCwd, { recursive: true })
      const indexingEnv = resolveIndexingEnv(folders)
      const localCli =
        this.context.extensionMode === vscode.ExtensionMode.Development ||
        fs.existsSync(path.join(this.context.extensionPath, "bin", ".cli-version"))
      const bwrapEnv = process.env.KILO_BWRAP_PATH ? {} : resolveLocalBwrapEnv(this.context.extensionPath, localCli)
      // TLS / corporate-proxy support:
      //   - Default NODE_USE_SYSTEM_CA=1 so the bundled Bun CLI trusts the OS
      //     trust store (Windows cert store, macOS keychain, Linux /etc/ssl).
      //     Mirrors VS Code's `http.systemCertificates` default (true).
      //   - Allow users behind MITM proxies to point at a custom CA bundle via
      //     `kilo-code.new.extraCaCerts` (NODE_EXTRA_CA_CERTS).
      //   - Honor VS Code's `http.proxyStrictSSL=false` as an explicit opt-out
      //     from verification, matching what VS Code already does for its own
      //     requests. Users explicitly set that; we don't flip it ourselves.
      // All three are overridable by the user's environment.
      const extraCaCerts = cfg.get<string>("extraCaCerts", "").trim()
      const proxyStrictSSL = vscode.workspace.getConfiguration("http").get<boolean>("proxyStrictSSL", true)
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        cwd: spawnCwd,
        env: {
          NODE_USE_SYSTEM_CA: "1",
          ...(extraCaCerts && { NODE_EXTRA_CA_CERTS: extraCaCerts }),
          ...(!proxyStrictSSL && { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
          ...resolveManagedServerEnv(process.env),
          // VS Code's http.proxy / http.noProxy settings are not reflected in
          // process.env, so spawned children bypass the user's configured proxy
          // and fail behind corporate firewalls. Forward them as the standard
          // HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars that Bun's fetch and
          // most HTTP clients already respect.
          ...buildProxyEnv(),
          // Force mimalloc (the allocator Bun ships with) to return freed pages
          // to the OS immediately instead of retaining them in its arenas.
          // Without this, Bun.spawn's piped stdio accumulates ~2 MB of native
          // RSS per call on Windows, causing the Agent Manager (which polls git
          // once per second per worktree) to reach multi-GB RSS in minutes.
          // See oven-sh/bun#18265 and Jarred's workaround note in #21560.
          MIMALLOC_PURGE_DELAY: "0",
          KILO_SERVER_PASSWORD: password,
          KILO_CLIENT: "vscode",
          KILO_ENABLE_QUESTION_TOOL: "true",
          KILOCODE_FEATURE: "vscode-extension",
          KILO_VSCODE_MANAGED_SERVER: "1",
          KILO_VSCODE_EXTENSION_HOST_PID: String(process.pid),
          KILO_VSCODE_SERVER_LAUNCH_ID: launchID,
          ...indexingEnv,
          KILO_TELEMETRY_LEVEL: vscode.env.isTelemetryEnabled ? "all" : "off",
          KILO_APP_NAME: "kilo-code",
          KILO_EDITOR_NAME: vscode.env.appName,
          KILO_PLATFORM: "vscode",
          KILO_MACHINE_ID: vscode.env.machineId,
          KILO_APP_VERSION: this.context.extension.packageJSON.version,
          KILO_VSCODE_VERSION: vscode.version,
          KILOCODE_EDITOR_NAME: `${vscode.env.appName} ${vscode.version}`,
          ...(!claudeCompat && { KILO_DISABLE_CLAUDE_CODE: "true" }),
          ...resolveTreeSitterEnv(this.context.extensionPath),
          ...bwrapEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      })
      debugLog("[Kilo New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)
      if (serverProcess.pid !== undefined) {
        this.writeMarker({
          version: MANAGED_SERVER_MARKER_VERSION,
          launchID,
          pid: serverProcess.pid,
          extensionHostPid: process.pid,
          cliPath,
          cwd: spawnCwd,
          startedAt: new Date().toISOString(),
          extensionVersion: this.context.extension.packageJSON.version,
        })
      }

      let resolved = false
      const stderrLines: string[] = []

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        debugLog("[Kilo New] ServerManager: 📥 CLI Server stdout:", output)

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          debugLog("[Kilo New] ServerManager: 🎯 Port detected:", port)
          this.updateMarkerPort(launchID, port)
          resolve({ port, password, process: serverProcess, launchID })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        console.error("[Kilo New] ServerManager: ⚠️ CLI Server stderr:", errorOutput)
        stderrLines.push(errorOutput)
      })

      serverProcess.on("error", (error) => {
        console.error("[Kilo New] ServerManager: ❌ Process error:", error)
        if (!resolved) {
          reject(error)
        }
      })

      serverProcess.on("exit", (code) => {
        debugLog("[Kilo New] ServerManager: 🛑 Process exited with code:", code)
        this.clearMarker(launchID)
        if (this.instance?.process === serverProcess) {
          this.instance = null
          this.onExit?.(code)
        }
        if (!resolved) {
          const { userMessage, userDetails } = toErrorMessage(
            t("server.processExited", { code: code ?? "null" }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      })

      setTimeout(() => {
        if (!resolved) {
          console.error(`[Kilo New] ServerManager: ⏰ Server startup timeout (${STARTUP_TIMEOUT_SECONDS}s)`)
          ServerManager.killProcess(serverProcess)
          const { userMessage, userDetails } = toErrorMessage(
            t("server.startupTimeout", { seconds: STARTUP_TIMEOUT_SECONDS }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      }, STARTUP_TIMEOUT_SECONDS * 1000)
    })
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    debugLog("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  cleanupOrphanedManagedServers(): Promise<void> {
    this.cleanupPromise ??= this.cleanupOrphanedManagedServersFresh().finally(() => {
      this.cleanupPromise = null
    })
    return this.cleanupPromise
  }

  private async cleanupOrphanedManagedServersFresh(): Promise<void> {
    await this.cleanupMarkedServers()
    await this.cleanupLegacyUnmarkedServers()
  }

  private async cleanupMarkedServers(): Promise<void> {
    const dir = managedServerMarkerDir(this.context.globalStorageUri.fsPath)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      const file = path.join(dir, entry.name)
      const marker = safeReadMarker(file)
      if (!marker) {
        fs.rmSync(file, { force: true })
        continue
      }
      if (!pidIsLive(marker.pid)) {
        fs.rmSync(file, { force: true })
        continue
      }
      if (pidIsLive(marker.extensionHostPid)) continue
      const command = readProcessCommand(marker.pid)
      if (!command || !commandMatchesManagedServerMarker(command, marker)) {
        console.warn("[Kilo New] ServerManager: skipping ambiguous managed backend marker", {
          pid: marker.pid,
          marker: file,
        })
        continue
      }
      await ServerManager.terminatePid(marker.pid)
      if (!pidIsLive(marker.pid)) fs.rmSync(file, { force: true })
    }
  }

  private async cleanupLegacyUnmarkedServers(): Promise<void> {
    if (process.platform === "win32") return
    const cliPath = this.getCliPath()
    const extensionID = `${this.context.extension.packageJSON.publisher}.${this.context.extension.packageJSON.name}`
    for (const row of listProcesses()) {
      if (row.pid === process.pid || row.ppid === process.pid) continue
      if (row.ppid > 1 && pidIsLive(row.ppid)) continue
      if (
        !commandLooksLikeLegacyManagedServer(row.command, {
          cliPath,
          extensionPath: this.context.extensionPath,
          extensionID,
        })
      ) {
        continue
      }
      await ServerManager.terminatePid(row.pid)
    }
  }

  private writeMarker(marker: ManagedServerMarker): void {
    const dir = managedServerMarkerDir(this.context.globalStorageUri.fsPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      managedServerMarkerPath(this.context.globalStorageUri.fsPath, marker.launchID),
      JSON.stringify(marker),
      {
        mode: 0o600,
      },
    )
  }

  private updateMarkerPort(launchID: string, port: number): void {
    const file = managedServerMarkerPath(this.context.globalStorageUri.fsPath, launchID)
    const marker = safeReadMarker(file)
    if (!marker) return
    this.writeMarker({ ...marker, port })
  }

  private clearMarker(launchID: string): void {
    fs.rmSync(managedServerMarkerPath(this.context.globalStorageUri.fsPath, launchID), { force: true })
  }

  /**
   * Kill a process and its entire process group.
   * On Unix, we send the signal to -pid (negative) to reach the whole group.
   * On Windows, process.kill() on the child handle is sufficient.
   */
  private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    if (proc.pid === undefined) {
      return
    }
    ServerManager.killPid(proc.pid, signal, proc)
  }

  private static killPid(pid: number, signal: NodeJS.Signals, proc?: ChildProcess): void {
    try {
      if (process.platform !== "win32") {
        // Negative PID targets the entire process group
        process.kill(-pid, signal)
      } else {
        proc?.kill(signal)
      }
    } catch {
      try {
        process.kill(pid, signal)
      } catch {
        // Process already gone — ignore
      }
    }
  }

  private static async terminatePid(pid: number): Promise<void> {
    ServerManager.killPid(pid, "SIGTERM")
    if (await waitForPidExit(pid, MANAGED_SERVER_SHUTDOWN_GRACE_MS)) return
    console.warn("[Kilo New] ServerManager: managed backend did not exit after SIGTERM, sending SIGKILL", { pid })
    ServerManager.killPid(pid, "SIGKILL")
    await waitForPidExit(pid, MANAGED_SERVER_KILL_GRACE_MS)
  }

  dispose(): void {
    void this.disposeAndWait()
  }

  async disposeAndWait(): Promise<void> {
    if (!this.instance) {
      return
    }
    const proc = this.instance.process
    this.instance = null

    debugLog("[Kilo New] ServerManager: 🔴 Disposing — sending SIGTERM to process group, PID:", proc.pid)
    ServerManager.killProcess(proc, "SIGTERM")

    if (proc.pid !== undefined && !(await waitForPidExit(proc.pid, MANAGED_SERVER_SHUTDOWN_GRACE_MS))) {
      console.warn("[Kilo New] ServerManager: ⚠️ Process did not exit after SIGTERM, sending SIGKILL")
      ServerManager.killProcess(proc, "SIGKILL")
      await waitForPidExit(proc.pid, MANAGED_SERVER_KILL_GRACE_MS)
    }
  }
}

export class ServerStartupError extends Error {
  readonly userMessage: string
  readonly userDetails: string
  constructor(userMessage: string, userDetails: string) {
    super(userDetails)
    this.name = "ServerStartupError"
    this.userMessage = userMessage
    this.userDetails = userDetails
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

/**
 * Translate VS Code's `http.proxy` / `http.noProxy` / `http.proxySupport`
 * settings into the standard proxy env vars, so the spawned CLI honors the
 * user's proxy configuration. Returns an empty object when no override is
 * needed, so callers can spread unconditionally.
 *
 * `http.proxySupport: "off"` is VS Code's opt-in way to disable proxy support
 * entirely; when set, we explicitly clear the env vars so ambient shell
 * HTTP_PROXY/http_proxy doesn't leak into the spawned child.
 */
export function buildProxyEnv(): Record<string, string> {
  const httpConfig = vscode.workspace.getConfiguration("http")
  const proxyInfo = httpConfig.inspect<string>("proxy")
  const noProxyInfo = httpConfig.inspect<string[]>("noProxy")
  const proxySupport = httpConfig.get<string>("proxySupport")

  if (proxySupport === "off") {
    return { HTTP_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", http_proxy: "", https_proxy: "", no_proxy: "" }
  }

  const proxy = httpConfig.get<string>("proxy")
  const noProxy = httpConfig.get<string[]>("noProxy")
  const proxySet =
    proxyInfo !== undefined &&
    [
      proxyInfo.globalValue,
      proxyInfo.workspaceValue,
      proxyInfo.workspaceFolderValue,
      proxyInfo.globalLanguageValue,
      proxyInfo.workspaceLanguageValue,
      proxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const noProxySet =
    noProxyInfo !== undefined &&
    [
      noProxyInfo.globalValue,
      noProxyInfo.workspaceValue,
      noProxyInfo.workspaceFolderValue,
      noProxyInfo.globalLanguageValue,
      noProxyInfo.workspaceLanguageValue,
      noProxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const env: Record<string, string> = {}
  if (proxy && proxy.trim() !== "") {
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
  }
  if (proxySet && proxy !== undefined && proxy.trim() === "") {
    env.HTTP_PROXY = ""
    env.HTTPS_PROXY = ""
    env.http_proxy = ""
    env.https_proxy = ""
  }
  if (Array.isArray(noProxy) && noProxy.length > 0) {
    env.NO_PROXY = noProxy.join(",")
    env.no_proxy = noProxy.join(",")
  }
  if (noProxySet && Array.isArray(noProxy) && noProxy.length === 0) {
    env.NO_PROXY = ""
    env.no_proxy = ""
  }
  return env
}

export function toErrorMessage(
  error: string,
  stderrLines: string[],
  cliPath?: string,
): {
  userMessage: string
  userDetails: string
  error: string
} {
  let lines = stderrLines.flatMap((line) => line.split("\n"))

  const errorLine = lines.map(stripAnsi).find((line) => /Error:\s+/.test(line))
  const userMessage = errorLine
    ? errorLine.match(/Error:\s+(.+)/)![1].trim()
    : stripAnsi([...lines].reverse().find((line) => line.trim() !== "") ?? error).trim()

  lines = [error, ...lines]
  if (cliPath && cliPath.trim() !== "") {
    lines = [`CLI path: ${cliPath}`, ...lines]
  }

  const detailsText = lines.map(stripAnsi).join("\n").trim()

  return {
    userMessage,
    userDetails: detailsText,
    error,
  }
}
