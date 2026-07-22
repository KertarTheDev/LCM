// kilocode_change - new file
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { Effect, Option } from "effect"

export function useCoreDatabase<A, E, R>(
  run: (db: CoreDatabase.Interface["db"]) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, CoreDatabase.Service>> {
  return Effect.gen(function* () {
    const database = yield* Effect.serviceOption(CoreDatabase.Service)
    if (Option.isSome(database)) return yield* run(database.value.db)
    return yield* CoreDatabase.Service.use(({ db }) => run(db)).pipe(Effect.provide(CoreDatabase.defaultLayer))
  }) as Effect.Effect<A, E, Exclude<R, CoreDatabase.Service>>
}
