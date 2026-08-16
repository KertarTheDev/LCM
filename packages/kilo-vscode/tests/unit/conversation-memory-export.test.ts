import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { exportConversationMemoryContext } from "../../src/kilo-provider/conversation-memory"

type TestUri = vscode.Uri & { with(change: { path: string }): TestUri }

const window = vscode.window as unknown as {
  showWarningMessage: (...args: unknown[]) => Promise<unknown>
  showSaveDialog: (...args: unknown[]) => Promise<TestUri | undefined>
}
const fs = vscode.workspace.fs as unknown as {
  writeFile: (uri: TestUri, data: Uint8Array) => Promise<void>
  rename: (source: TestUri, target: TestUri, options: { overwrite: boolean }) => Promise<void>
  delete: (uri: TestUri) => Promise<void>
}
const original = {
  warning: window.showWarningMessage,
  save: window.showSaveDialog,
  write: fs.writeFile,
  rename: fs.rename,
  delete: fs.delete,
}

function uri(value: string): TestUri {
  return {
    scheme: "vscode-remote",
    authority: "test",
    path: value,
    query: "",
    fragment: "",
    fsPath: value,
    with(change) {
      return uri(change.path)
    },
  } as TestUri
}

afterEach(() => {
  window.showWarningMessage = original.warning
  window.showSaveDialog = original.save
  fs.writeFile = original.write
  fs.rename = original.rename
  fs.delete = original.delete
})

describe("Conversation Memory VS Code export", () => {
  it("removes the temporary file when publication fails", async () => {
    const target = uri("/repo/context.zip")
    const deleted: string[] = []
    window.showWarningMessage = mock(async () => "continue")
    window.showSaveDialog = mock(async () => target)
    fs.writeFile = mock(async () => undefined)
    fs.rename = mock(async () => {
      throw new Error("target exists")
    })
    fs.delete = mock(async (value) => {
      deleted.push(value.path)
    })
    const client = {
      conversationMemory: {
        export: mock(async () => ({
          data: new Blob(["archive"]),
          response: { headers: new Headers({ "content-disposition": 'attachment; filename="context.zip"' }) },
        })),
      },
    }

    await expect(exportConversationMemoryContext(client as never, "ses_test", "/repo")).rejects.toThrow(
      "target exists",
    )
    expect(deleted).toEqual([`/repo/context.zip.${process.pid}.tmp`])
  })
})
