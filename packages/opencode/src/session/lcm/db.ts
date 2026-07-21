// kilocode_change - new file
import { Context, Effect, Layer } from "effect"
import { coerceDbRequestError } from "./db-errors"
import { createLcmDbWorkerRegistry } from "./db-worker"
import type { LcmFamilyTarget } from "./family"
import { type LcmDbInitializeInput, type LcmDbRequest, type LcmDbStatus, type LcmSafeError } from "./types"

export interface Interface {
  readonly getStatus: () => Effect.Effect<LcmDbStatus>
  readonly initialize: (input: LcmDbInitializeInput) => Effect.Effect<LcmDbStatus>
  readonly execute: <T>(request: LcmDbRequest<T>) => Effect.Effect<T, LcmSafeError>
  readonly executeForeground: <T>(request: Omit<LcmDbRequest<T>, "lane">) => Effect.Effect<T, LcmSafeError>
  readonly close: () => Effect.Effect<void>
  readonly getFamilyStatus?: (target: LcmFamilyTarget) => Effect.Effect<LcmDbStatus>
  readonly initializeFamily?: (target: LcmFamilyTarget) => Effect.Effect<LcmDbStatus>
  readonly executeForFamily?: <T>(target: LcmFamilyTarget, request: LcmDbRequest<T>) => Effect.Effect<T, LcmSafeError>
  readonly executeForegroundForFamily?: <T>(
    target: LcmFamilyTarget,
    request: Omit<LcmDbRequest<T>, "lane">,
  ) => Effect.Effect<T, LcmSafeError>
  readonly closeFamily?: (target: LcmFamilyTarget) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LcmDb") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const registry = createLcmDbWorkerRegistry()

    return Service.of({
      getStatus: () => Effect.sync((): LcmDbStatus => registry.getStatus()),
      initialize: (input: LcmDbInitializeInput) => Effect.promise(() => registry.initialize(input)),
      execute: <T>(request: LcmDbRequest<T>) =>
        Effect.tryPromise({
          try: () => registry.execute(request),
          catch: (error) => coerceDbRequestError(error, { operationID: request.operationID }),
        }),
      executeForeground: <T>(request: Omit<LcmDbRequest<T>, "lane">) =>
        Effect.tryPromise({
          try: () => registry.executeForeground(request),
          catch: (error) => coerceDbRequestError(error, { operationID: request.operationID }),
        }),
      close: () => Effect.promise(() => registry.close()),
      getFamilyStatus: (target) => Effect.sync((): LcmDbStatus => registry.getFamilyStatus(target)),
      initializeFamily: (target) => Effect.promise(() => registry.initializeFamily(target)),
      executeForFamily: <T>(target: LcmFamilyTarget, request: LcmDbRequest<T>) =>
        Effect.tryPromise({
          try: () => registry.executeForFamily(target, request),
          catch: (error) => coerceDbRequestError(error, { operationID: request.operationID }),
        }),
      executeForegroundForFamily: <T>(target: LcmFamilyTarget, request: Omit<LcmDbRequest<T>, "lane">) =>
        Effect.tryPromise({
          try: () => registry.executeForegroundForFamily(target, request),
          catch: (error) => coerceDbRequestError(error, { operationID: request.operationID }),
        }),
      closeFamily: (target) => Effect.promise(() => registry.closeFamily(target)),
    })
  }),
)

export const defaultLayer = layer

export function scoped(service: Interface, target: LcmFamilyTarget): Interface {
  return Service.of({
    getStatus: () => service.getFamilyStatus?.(target) ?? service.getStatus(),
    initialize: () =>
      service.initializeFamily?.(target) ??
      service.initialize({
        dataDir: target.familyRoot,
        runtimeMode: target.runtimeMode,
        schemaVersion: target.schemaVersion,
      }),
    execute: <T>(request: LcmDbRequest<T>) => service.executeForFamily?.(target, request) ?? service.execute(request),
    executeForeground: <T>(request: Omit<LcmDbRequest<T>, "lane">) =>
      service.executeForegroundForFamily?.(target, request) ?? service.executeForeground(request),
    close: () => service.closeFamily?.(target) ?? service.close(),
    getFamilyStatus: service.getFamilyStatus,
    initializeFamily: service.initializeFamily,
    executeForFamily: service.executeForFamily,
    executeForegroundForFamily: service.executeForegroundForFamily,
    closeFamily: service.closeFamily,
  })
}

export function initializeFamily(service: Interface, target: LcmFamilyTarget) {
  return (
    service.initializeFamily?.(target) ??
    service.initialize({
      dataDir: target.familyRoot,
      runtimeMode: target.runtimeMode,
      schemaVersion: target.schemaVersion,
    })
  )
}

export * as LcmDb from "./db"
