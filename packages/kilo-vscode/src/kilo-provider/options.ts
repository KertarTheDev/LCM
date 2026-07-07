export type KiloProviderSessionContext = {
  sessionID?: string
  directory?: string
}

export type KiloProviderOptions = {
  projectDirectory?: string | null
  initialSessionContext?: KiloProviderSessionContext
  onSessionContextChanged?: (context: KiloProviderSessionContext | undefined) => void
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  worktreeDirectories?: () => string[]
}
