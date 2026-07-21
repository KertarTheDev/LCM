// kilocode_change - new file; keep LCM provider/model identity local to the adapter boundary
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"

export const ModelID = ModelV2.ID
export type ModelID = ModelV2.ID
export const ProviderID = ProviderV2.ID
export type ProviderID = ProviderV2.ID
export const WorkspaceID = WorkspaceV2.ID
export type WorkspaceID = WorkspaceV2.ID
