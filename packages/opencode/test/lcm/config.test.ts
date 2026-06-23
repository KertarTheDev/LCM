// kilocode_change - new file
import { expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { ConfigParse } from "../../src/config/parse"
import * as LcmConfig from "../../src/session/lcm/config"

function parseConfig(input: unknown) {
  return ConfigParse.schema(Config.Info, input, "test:lcm-config")
}

test("parses public LCM deployment defaults", () => {
  const config = parseConfig({
    lcm: {
      strategy: "dolt",
      storage: {
        warningThresholdBytes: 4096,
      },
    },
  })

  const resolved = LcmConfig.resolve(config.lcm)
  expect(resolved.strategy).toBe("dolt")
  expect(resolved.storage.warningThresholdBytes).toBe(4096)
})

test("defaults public LCM config values from runtime contracts", () => {
  const config = parseConfig({})
  const resolved = LcmConfig.resolve(config.lcm)

  expect(resolved.strategy).toBe("upward")
  expect(resolved.storage.warningThresholdBytes).toBe(10_737_418_240)
  expect(resolved.largePayloads.explorationSampleBytes).toBe(204_800)
  expect(resolved.largePayloads.explorationMaxFullLoadBytes).toBe(52_428_800)
  expect(resolved.largePayloads.explorerHelperOutputMaxBytes).toBe(1_048_576)
})

test("rejects invalid public LCM config values", () => {
  expect(() => parseConfig({ lcm: { strategy: "disabled" } })).toThrow()
  expect(() => parseConfig({ lcm: { storage: { warningThresholdBytes: 0 } } })).toThrow()
  expect(() => parseConfig({ lcm: { storage: { warningThresholdBytes: -1 } } })).toThrow()
  expect(() => parseConfig({ lcm: { storage: { warningThresholdBytes: 1.5 } } })).toThrow()
})

test("keeps internal LCM runtime defaults out of public config", () => {
  expect(() => parseConfig({ lcm: { enabled: false } })).toThrow()
  expect(() => parseConfig({ lcm: { thresholds: { softRatio: 0.4 } } })).toThrow()
  expect(() => parseConfig({ lcm: { retrieval: { defaultPageLimit: 5 } } })).toThrow()
  expect(() => parseConfig({ lcm: { map: { llmMapWorkers: 1 } } })).toThrow()
})
