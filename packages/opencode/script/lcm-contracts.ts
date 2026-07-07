// kilocode_change - new file
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const packageRoot = path.resolve(import.meta.dir, "..")
const implementationRoot = path.resolve(packageRoot, "src/session/lcm")
const workspaceRoot = path.resolve(packageRoot, "../..")
const specRoot = path.join(workspaceRoot, "specifications")

export const DEFAULT_PATHS = {
  specPath: path.join(specRoot, "api-contracts.md"),
  artifactPath: path.join(implementationRoot, "contracts/lcm-api-contract.generated.json"),
  implementationTypesPath: path.join(implementationRoot, "types.ts"),
}

type TypeContract = {
  source: string
  literals: string[]
}

type InterfaceMemberContract = {
  optional: boolean
  type?: string
  parameters?: Array<{ name: string; optional: boolean; type: string }>
  returnType?: string
}

type InterfaceContract = {
  source: string
  fields: Record<string, InterfaceMemberContract>
  methods: Record<string, InterfaceMemberContract>
}

export type LcmApiContractArtifact = {
  contractVersion: "lcm-api-contract-v1"
  source: {
    sha256: string
  }
  declarations: {
    types: Record<string, TypeContract>
    interfaces: Record<string, InterfaceContract>
  }
  surfaceClassifications: Record<
    string,
    {
      classification: string
      exposurePolicy: string
    }
  >
  safeMessageTemplates: Record<
    string,
    {
      errorCodes: string[]
      allowedParams: string[]
      safeMessage: string
    }
  >
  routes: Array<{
    method: string
    path: string
    request?: string
    response: string
  }>
  httpStatusMappings: Array<{
    codes: string[]
    status: number
  }>
  eventPayloads: Record<string, string>
  toolDescriptions: Record<string, string>
  webviewMessageNames: string[]
  eventNames: string[]
}

export type ContractDiagnostic = {
  code: "artifact_missing" | "artifact_drift" | "implementation_drift" | "sdk_drift"
  path: string
  message: string
}

export type CheckResult = {
  ok: boolean
  diagnostics: ContractDiagnostic[]
}

function normalizeText(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function sourceText(sourceFile: ts.SourceFile, node: ts.Node) {
  return normalizeText(node.getText(sourceFile))
}

function propertyNameText(name: ts.PropertyName | ts.BindingName, sourceFile: ts.SourceFile) {
  return name.getText(sourceFile).replace(/^["']|["']$/g, "")
}

function typeText(sourceFile: ts.SourceFile, node?: ts.TypeNode) {
  return node ? normalizeText(node.getText(sourceFile)) : "unknown"
}

function extractStringLiterals(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const values = new Set<string>()
  const visit = (current: ts.Node) => {
    if (ts.isLiteralTypeNode(current) && ts.isStringLiteral(current.literal)) values.add(current.literal.text)
    if (ts.isTemplateLiteralTypeNode(current)) values.add(sourceText(sourceFile, current))
    current.forEachChild(visit)
  }
  visit(node)
  return [...values].sort()
}

function parseCodeDeclarations(markdown: string) {
  const types: Record<string, TypeContract> = {}
  const interfaces: Record<string, InterfaceContract> = {}
  const blocks = [...markdown.matchAll(/```ts([^\n]*)\n([\s\S]*?)```/g)]
    .filter((match) => !/\b(?:internal|lcm-internal)\b/.test(match[1] ?? ""))
    .map((match) => match[2] ?? "")

  for (const [index, block] of blocks.entries()) {
    const sourceFile = ts.createSourceFile(`api-contracts-block-${index}.ts`, block, ts.ScriptTarget.Latest, true)
    for (const statement of sourceFile.statements) {
      if (ts.isTypeAliasDeclaration(statement)) {
        types[statement.name.text] = {
          source: sourceText(sourceFile, statement),
          literals: extractStringLiterals(statement.type, sourceFile),
        }
      }

      if (ts.isInterfaceDeclaration(statement)) {
        const fields: Record<string, InterfaceMemberContract> = {}
        const methods: Record<string, InterfaceMemberContract> = {}

        for (const member of statement.members) {
          if (ts.isPropertySignature(member) && member.name) {
            fields[propertyNameText(member.name, sourceFile)] = {
              optional: !!member.questionToken,
              type: typeText(sourceFile, member.type),
            }
          }
          if (ts.isMethodSignature(member) && member.name) {
            methods[propertyNameText(member.name, sourceFile)] = {
              optional: !!member.questionToken,
              parameters: member.parameters.map((param) => ({
                name: propertyNameText(param.name, sourceFile),
                optional: !!param.questionToken,
                type: typeText(sourceFile, param.type),
              })),
              returnType: typeText(sourceFile, member.type),
            }
          }
        }

        interfaces[statement.name.text] = {
          source: sourceText(sourceFile, statement),
          fields,
          methods,
        }
      }
    }
  }

  return { types, interfaces }
}

function stripBackticks(input: string) {
  return [...input.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "")
}

function parseSafeMessageTemplates(markdown: string) {
  const result: LcmApiContractArtifact["safeMessageTemplates"] = {}
  for (const match of markdown.matchAll(/^\| `(lcm\.[^`]+)` \| ([^|]+) \| ([^|]+) \| `([^`]+)` \|$/gm)) {
    const [, key, codeColumn = "", paramsColumn = "", safeMessage = ""] = match
    result[key] = {
      errorCodes: stripBackticks(codeColumn).sort(),
      allowedParams: stripBackticks(paramsColumn).sort(),
      safeMessage,
    }
  }
  return result
}

function parseRoutes(markdown: string): LcmApiContractArtifact["routes"] {
  const routes: LcmApiContractArtifact["routes"] = []
  for (const match of markdown.matchAll(
    /^- `(GET|PATCH|POST) ([^`]+)` (?:accepts `([^`]+)` and )?returns `([^`]+)`\./gm,
  )) {
    const [, method = "", routePath = "", request, response = ""] = match
    routes.push({
      method,
      path: routePath,
      ...(request ? { request } : {}),
      response,
    })
  }
  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`))
}

function parseHttpStatuses(markdown: string): LcmApiContractArtifact["httpStatusMappings"] {
  const result: LcmApiContractArtifact["httpStatusMappings"] = []
  for (const match of markdown.matchAll(/^\| ((?:`[^`]+`,? ?)+) \| ([0-9]+) \|$/gm)) {
    const [, codes = "", status = "0"] = match
    result.push({ codes: stripBackticks(codes).sort(), status: Number(status) })
  }
  return result.sort((a, b) => a.status - b.status || a.codes.join(",").localeCompare(b.codes.join(",")))
}

function parseEventPayloads(markdown: string) {
  const result: Record<string, string> = {}
  for (const match of markdown.matchAll(/^- `(lcm\.[^`]+)` uses `([^`]+)`\./gm)) {
    const [, eventName = "", payloadName = ""] = match
    result[eventName] = payloadName
  }
  return result
}

function parseToolDescriptions(markdown: string) {
  const result: Record<string, string> = {}
  for (const match of markdown.matchAll(/^- `(lcm_[^`]+|llm_map|agentic_map)`: `([^`]+)`$/gm)) {
    const [, toolName = "", description = ""] = match
    result[toolName] = description
  }
  return result
}

function parseSurfaceClassifications(markdown: string): LcmApiContractArtifact["surfaceClassifications"] {
  const result: LcmApiContractArtifact["surfaceClassifications"] = {}
  for (const match of markdown.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| ([^|]+) \|$/gm)) {
    const [, typeName = "", classification = "", exposurePolicy = ""] = match
    if (classification !== "internal_model_visible" && classification !== "public_dto") continue
    result[typeName] = {
      classification,
      exposurePolicy: exposurePolicy.trim(),
    }
  }
  return result
}

function stable<T>(input: T): T {
  if (Array.isArray(input)) return input.map((item) => stable(item)) as T
  if (!input || typeof input !== "object") return input
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries.map(([key, value]) => [key, stable(value)])) as T
}

export async function generateContract(input: { specPath?: string } = {}): Promise<LcmApiContractArtifact> {
  const specPath = input.specPath ?? DEFAULT_PATHS.specPath
  const markdown = (await fs.readFile(specPath, "utf8")).replace(/\r\n/g, "\n")
  const declarations = parseCodeDeclarations(markdown)

  return stable({
    contractVersion: "lcm-api-contract-v1",
    source: {
      sha256: crypto.createHash("sha256").update(markdown).digest("hex"),
    },
    declarations,
    surfaceClassifications: parseSurfaceClassifications(markdown),
    safeMessageTemplates: parseSafeMessageTemplates(markdown),
    routes: parseRoutes(markdown),
    httpStatusMappings: parseHttpStatuses(markdown),
    eventPayloads: parseEventPayloads(markdown),
    toolDescriptions: parseToolDescriptions(markdown),
    webviewMessageNames: declarations.types.LcmWebviewMessageName?.literals ?? [],
    eventNames: declarations.types.LcmEventName?.literals ?? [],
  })
}

export async function writeContract(input: { artifactPath?: string; specPath?: string } = {}) {
  const artifactPath = input.artifactPath ?? DEFAULT_PATHS.artifactPath
  const contract = await generateContract({ specPath: input.specPath })
  await fs.mkdir(path.dirname(artifactPath), { recursive: true })
  await fs.writeFile(artifactPath, JSON.stringify(contract, null, 2) + "\n")
  return contract
}

async function readArtifact(artifactPath: string): Promise<LcmApiContractArtifact | undefined> {
  try {
    return JSON.parse(await fs.readFile(artifactPath, "utf8")) as LcmApiContractArtifact
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function diff(actual: unknown, expected: unknown, at = ""): ContractDiagnostic[] {
  if (Object.is(actual, expected)) return []
  if (typeof actual !== typeof expected) {
    return [{ code: "artifact_drift", path: at || "$", message: `type mismatch at ${at || "$"}` }]
  }
  if (!actual || !expected || typeof actual !== "object") {
    return [{ code: "artifact_drift", path: at || "$", message: `value mismatch at ${at || "$"}` }]
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return [{ code: "artifact_drift", path: at || "$", message: `array mismatch at ${at || "$"}` }]
    }
    if (actual.length !== expected.length) {
      return [{ code: "artifact_drift", path: `${at}.length`, message: `array length mismatch at ${at}` }]
    }
    return actual.flatMap((item, index) => diff(item, expected[index], `${at}[${index}]`))
  }

  const actualObject = actual as Record<string, unknown>
  const expectedObject = expected as Record<string, unknown>
  const keys = new Set([...Object.keys(actualObject), ...Object.keys(expectedObject)])
  const diagnostics: ContractDiagnostic[] = []
  for (const key of [...keys].sort()) {
    if (!(key in actualObject)) {
      diagnostics.push({ code: "artifact_drift", path: `${at}.${key}`, message: `missing key ${key}` })
      continue
    }
    if (!(key in expectedObject)) {
      diagnostics.push({ code: "artifact_drift", path: `${at}.${key}`, message: `extra key ${key}` })
      continue
    }
    diagnostics.push(...diff(actualObject[key], expectedObject[key], at ? `${at}.${key}` : key))
  }
  return diagnostics
}

async function implementationContract(typesPath: string) {
  const source = await fs.readFile(typesPath, "utf8")
  return parseCodeDeclarations("```ts\n" + source + "\n```")
}

async function activeMilestoneStarted(number: string) {
  const milestoneFiles: Record<string, string> = {
    "30": "30-config-backed-lcm-settings-and-sessionless-ui.md",
  }
  const milestoneFile = milestoneFiles[number]
  if (!milestoneFile) return false
  try {
    const milestone = await fs.readFile(path.join(specRoot, milestoneFile), "utf8")
    const status = milestone.match(/^Status:\s*(.+)$/m)?.[1]?.trim()
    return !!status && status !== "Not Started"
  } catch {
    return false
  }
}

async function checkGeneratedSdkMirrors(artifact: LcmApiContractArtifact) {
  const diagnostics: ContractDiagnostic[] = []
  const needsSessionlessSettings = artifact.routes.some(
    (route) => route.path === "/lcm/settings" && (route.method === "GET" || route.method === "PATCH"),
  )
  if (!needsSessionlessSettings || !(await activeMilestoneStarted("30"))) return diagnostics

  const sdkPath = path.resolve(packageRoot, "../sdk/js/src/v2/gen/sdk.gen.ts")
  let source = ""
  try {
    source = await fs.readFile(sdkPath, "utf8")
  } catch {
    diagnostics.push({
      code: "sdk_drift",
      path: sdkPath,
      message: "generated SDK file is missing",
    })
    return diagnostics
  }

  if (!/url: "\/lcm\/settings"/.test(source) || !/get settings\(\):/.test(source)) {
    diagnostics.push({
      code: "sdk_drift",
      path: sdkPath,
      message: "generated SDK is missing primary client.lcm.settings.get/update surface",
    })
  }
  return diagnostics
}

function checkImplementationMirrors(
  artifact: LcmApiContractArtifact,
  implementation: Awaited<ReturnType<typeof implementationContract>>,
) {
  const diagnostics: ContractDiagnostic[] = []
  for (const [name, expected] of Object.entries(artifact.declarations.types)) {
    const actual = implementation.types[name]
    if (!actual) continue
    if (actual.literals.join("\n") !== expected.literals.join("\n")) {
      diagnostics.push({
        code: "implementation_drift",
        path: `declarations.types.${name}.literals`,
        message: `literal drift in ${name}`,
      })
    }
  }

  for (const [name, expected] of Object.entries(artifact.declarations.interfaces)) {
    const actual = implementation.interfaces[name]
    if (!actual) continue
    for (const [fieldName, expectedField] of Object.entries(expected.fields)) {
      const actualField = actual.fields[fieldName]
      if (!actualField) {
        diagnostics.push({
          code: "implementation_drift",
          path: `declarations.interfaces.${name}.fields.${fieldName}`,
          message: `missing public field ${name}.${fieldName}`,
        })
        continue
      }
      if (actualField.optional !== expectedField.optional) {
        diagnostics.push({
          code: "implementation_drift",
          path: `declarations.interfaces.${name}.fields.${fieldName}.optional`,
          message: `optional drift in ${name}.${fieldName}`,
        })
      }
    }
    for (const [methodName] of Object.entries(expected.methods)) {
      if (!actual.methods[methodName]) {
        diagnostics.push({
          code: "implementation_drift",
          path: `declarations.interfaces.${name}.methods.${methodName}`,
          message: `missing public method ${name}.${methodName}`,
        })
      }
    }
  }
  return diagnostics
}

export async function checkContract(
  input: { artifactPath?: string; specPath?: string; implementationTypesPath?: string } = {},
): Promise<CheckResult> {
  const artifactPath = input.artifactPath ?? DEFAULT_PATHS.artifactPath
  const artifact = await readArtifact(artifactPath)
  if (!artifact) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "artifact_missing",
          path: artifactPath,
          message: "LCM API contract artifact is missing",
        },
      ],
    }
  }

  const expected = await generateContract({ specPath: input.specPath })
  const implementation = await implementationContract(
    input.implementationTypesPath ?? DEFAULT_PATHS.implementationTypesPath,
  )
  const diagnostics = [
    ...diff(artifact, expected),
    ...checkImplementationMirrors(expected, implementation),
    ...(await checkGeneratedSdkMirrors(expected)),
  ]

  return { ok: diagnostics.length === 0, diagnostics }
}

if (import.meta.main) {
  const command = process.argv[2]
  const artifactArgIndex = process.argv.indexOf("--artifact")
  const artifactPath = artifactArgIndex >= 0 ? process.argv[artifactArgIndex + 1] : undefined

  if (command === "generate") {
    await writeContract({ artifactPath })
    console.log(`Generated ${artifactPath ?? DEFAULT_PATHS.artifactPath}`)
    process.exit(0)
  }

  if (command === "check") {
    const result = await checkContract({ artifactPath })
    if (result.ok) {
      console.log("LCM API contract check passed.")
      process.exit(0)
    }
    for (const diagnostic of result.diagnostics) {
      console.error(`${diagnostic.code}: ${diagnostic.path}: ${diagnostic.message}`)
    }
    process.exit(1)
  }

  console.error("Usage: bun run script/lcm-contracts.ts <generate|check> [--artifact path]")
  process.exit(1)
}
