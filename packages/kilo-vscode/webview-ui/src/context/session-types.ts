import type { Accessor } from "solid-js"
import type {
  AgentInfo,
  ContextUsage,
  FileAttachment,
  LcmMetricsSnapshotMessage,
  McpStatusEntry,
  Message,
  MessageLoadMode,
  ModelSelection,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionCloseReason,
  SessionInfo,
  SessionModelUsage,
  SessionStatus,
  SessionStatusInfo,
  SkillInfo,
  SuggestionRequest,
  TodoItem,
  ToolPart,
} from "../types/messages"
import type { ReviewMessageData } from "../../../src/shared/review-comments"
import type { LcmLockRecoveryState } from "./session-lcm-errors"
import type { LcmMaintenanceHint } from "./session-utils"

export type MessageMutation = Exclude<MessageLoadMode, "focus"> | "append" | "update"

// Store structure for messages and parts
export interface SessionStore {
  sessions: Record<string, SessionInfo>
  messages: Record<string, Message[]> // sessionID -> messages
  parts: Record<string, Part[]> // messageID -> parts
  toolParts: Record<string, ToolPart[]> // sessionID -> compact per-session tool index
  todos: Record<string, TodoItem[]> // sessionID -> todos
  modelSelections: Record<string, ModelSelection | null> // agentName -> model (global, extension-lifetime)
  sessionOverrides: Record<string, ModelSelection> // sessionID -> per-session model override (compare mode)
  agentSelections: Record<string, string> // sessionID -> agent name
  variantSelections: Record<string, string> // session/agent scoped variant key -> variant name
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  modelUsage: Record<string, { requestID: string; data?: SessionModelUsage }>
  lcmMetrics: Record<string, LcmMetricsSnapshotMessage>
  lcmMaintenanceHints: Record<string, LcmMaintenanceHint>
}

export interface SessionContextValue {
  // Current session
  currentSessionID: Accessor<string | undefined>
  currentSession: Accessor<SessionInfo | undefined>
  setCurrentSessionID: (id: string | undefined) => void

  // All sessions (sorted most recent first)
  sessions: Accessor<SessionInfo[]>

  // Session status
  status: Accessor<SessionStatus>
  statusInfo: Accessor<SessionStatusInfo>
  closeReason: Accessor<SessionCloseReason | undefined>
  statusText: Accessor<string | undefined>
  busySince: Accessor<number | undefined>
  submitting: Accessor<boolean>
  loading: Accessor<boolean>
  loadingOlderMessages: Accessor<boolean>
  hasOlderMessages: Accessor<boolean>
  messageMutation: Accessor<MessageMutation | undefined>

  // Messages for current session
  messages: Accessor<Message[]>

  // Messages for current session with soft-reverted turns hidden
  visibleMessages: Accessor<Message[]>

  // User messages for current session (role === "user")
  userMessages: Accessor<Message[]>

  // All messages keyed by sessionID (includes child sessions)
  allMessages: () => Record<string, Message[]>

  // All parts keyed by messageID (includes child sessions)
  allParts: () => Record<string, Part[]>

  // All session statuses keyed by sessionID (for DataBridge)
  allStatusMap: () => Record<string, SessionStatusInfo>

  // Parts for a specific message
  getParts: (messageID: string) => Part[]

  // Tool parts for a specific session, maintained incrementally for streaming views
  getSessionToolParts: (sessionID: string) => ToolPart[]
  getSessionToolCount: (sessionID: string) => number

  // Hidden after model changes so switching models can clear stale provider errors
  // without removing messages and their checkpoint restore actions.
  isErrorHidden: (messageID: string) => boolean

  // Move stashed parts into the reactive store for the given message IDs.
  // Called by VscodeSessionTurn when the virtualizer renders a turn.
  hydrateParts: (messageIDs: string[]) => void

  // Todos for current session
  todos: Accessor<TodoItem[]>

  // Pending permission requests (unscoped - all tracked sessions)
  permissions: Accessor<PermissionRequest[]>
  respondingPermissions: Accessor<Set<string>>

  // Pending question requests (unscoped - all tracked sessions)
  questions: Accessor<QuestionRequest[]>
  questionErrors: Accessor<Set<string>>
  suggestions: Accessor<SuggestionRequest[]>
  suggestionErrors: Accessor<Set<string>>
  respondingSuggestions: Accessor<Set<string>>

  // Scoped permissions/questions - filtered to a session's family (self + subagents)
  scopedPermissions: (sessionID: string | undefined) => PermissionRequest[]
  scopedQuestions: (sessionID: string | undefined) => QuestionRequest[]
  scopedSuggestions: (sessionID: string | undefined) => SuggestionRequest[]

  // Model selection (global, extension-lifetime)
  selected: (sessionID?: string) => ModelSelection | null
  configModel: (sessionID?: string) => ModelSelection | null
  selectModel: (providerID: string, modelID: string, sessionID?: string) => void
  hasModelOverride: (sessionID?: string) => boolean
  clearModelOverride: (sessionID?: string) => void

  // Cost and context usage for the current session
  costBreakdown: Accessor<Array<{ label: string; cost: number }>>
  contextUsage: Accessor<ContextUsage | undefined>
  modelUsage: Accessor<SessionModelUsage | undefined>
  refreshModelUsage: () => void
  lcmMetrics: Accessor<LcmMetricsSnapshotMessage | undefined>
  maintenanceHint: Accessor<LcmMaintenanceHint | undefined>
  lcmLockRecovery: Accessor<LcmLockRecoveryState | undefined>
  forceUnlockLcm: () => void
  dismissLcmLockRecovery: () => void

  // Skills loaded from the CLI backend
  skills: Accessor<SkillInfo[]>
  refreshSkills: () => void
  removeSkill: (location: string) => void

  // Agent/mode selection (per-session)
  agents: Accessor<AgentInfo[]>
  allAgents: Accessor<AgentInfo[]>
  removeAgent: (name: string) => void
  removeMcp: (name: string) => void

  // MCP server status (runtime connect/disconnect)
  mcpStatus: Accessor<Record<string, McpStatusEntry>>
  mcpLoading: Accessor<string | null>
  connectMcp: (name: string) => void
  disconnectMcp: (name: string) => void
  authenticateMcp: (name: string) => void
  refreshMcpStatus: () => void
  selectedAgent: (sessionID?: string) => string
  selectAgent: (name: string, sessionID?: string) => void
  getSessionAgent: (sessionID: string) => string
  getSessionModel: (sessionID: string) => ModelSelection | null
  setSessionModel: (sessionID: string, providerID: string, modelID: string) => void
  setSessionAgent: (sessionID: string, name: string) => void
  setSessionVariant: (sessionID: string, providerID: string, modelID: string, value: string, agent?: string) => void

  // Thinking variant for the selected model
  variantList: (sessionID?: string) => string[]
  currentVariant: (sessionID?: string) => string | undefined
  selectVariant: (value: string, sessionID?: string) => void

  // Model favorites
  favoriteModels: Accessor<ModelSelection[]>
  toggleFavorite: (providerID: string, modelID: string) => void

  // Revert/undo state for the current session
  revert: Accessor<SessionInfo["revert"]>
  revertedCount: Accessor<number>
  summary: Accessor<SessionInfo["summary"]>

  // Live worktree diff stats (polled from CLI backend)
  worktreeStats: Accessor<{ files: number; additions: number; deletions: number } | undefined>

  // Actions
  revertSession: (messageID: string, partID?: string) => void
  unrevertSession: () => void
  sendMessage: (
    text: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
    context?: string,
    review?: ReviewMessageData,
  ) => void
  sendCommand: (
    command: string,
    args: string,
    providerID?: string,
    modelID?: string,
    files?: FileAttachment[],
    draftID?: string,
    context?: string,
  ) => void
  abort: () => void
  compact: () => void
  respondToPermission: (
    permissionId: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
  ) => void
  replyToQuestion: (requestID: string, answers: string[][]) => void
  rejectQuestion: (requestID: string) => void
  closeQuestion: (requestID: string) => void
  acceptSuggestion: (requestID: string, index: number) => void
  dismissSuggestion: (requestID: string) => void
  createSession: () => void
  clearCurrentSession: () => void
  loadSessions: () => void
  loadOlderMessages: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  exportSessionTranscript: (id: string) => void
  syncSession: (sessionID: string) => void

  // Cloud session preview
  cloudPreviewId: Accessor<string | null>
  selectCloudSession: (cloudSessionId: string) => void
  draftSessionID: Accessor<string | undefined>
  setDraftSessionID: (id: string | undefined) => void
  userClearedSession: Accessor<boolean>
}
