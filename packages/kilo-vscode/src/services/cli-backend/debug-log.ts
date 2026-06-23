import * as vscode from "vscode"

const DEBUG_LOG_SETTING = "debugBackendLogs"

export function isCliBackendDebugLoggingEnabled(): boolean {
  if (process.env.KILO_VSCODE_DEBUG_LOGS === "1") return true
  return vscode.workspace.getConfiguration("kilo-code.new").get<boolean>(DEBUG_LOG_SETTING, false)
}

export function debugLog(...args: unknown[]): void {
  if (isCliBackendDebugLoggingEnabled()) console.log(...args)
}
