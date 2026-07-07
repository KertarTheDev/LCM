// kilocode_change - focused prompt-path binding gate without building the full TS program
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const packageRoot = path.resolve(import.meta.dir, "..")
const promptPath = path.join(packageRoot, "src/session/prompt.ts")
const indexPath = path.join(packageRoot, "src/index.ts")
const processorPath = path.join(packageRoot, "src/session/processor.ts")
const processorCheckpointTestPath = path.join(packageRoot, "test/kilocode/session-processor-lcm-checkpoint.test.ts")

type ImportBinding = {
  readonly module: string
  readonly imported: string
  readonly local: string
  readonly typeOnly: boolean
}

type ParsedSource = {
  readonly file: string
  readonly text: string
  readonly imports: ImportBinding[]
  readonly localVariables: Set<string>
  readonly identifiers: Set<string>
}

function parseSource(file: string): ParsedSource {
  const text = fs.readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const imports: ImportBinding[] = []
  const localVariables = new Set<string>()
  const identifiers = new Set<string>()

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) localVariables.add(node.name.text)
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text
      const clause = node.importClause
      if (clause?.name) {
        imports.push({
          module,
          imported: "default",
          local: clause.name.text,
          typeOnly: clause.isTypeOnly,
        })
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.push({
            module,
            imported: element.propertyName?.text ?? element.name.text,
            local: element.name.text,
            typeOnly: clause.isTypeOnly || element.isTypeOnly,
          })
        }
      }
    }
    node.forEachChild(visit)
  }

  visit(sourceFile)
  return { file, text, imports, localVariables, identifiers }
}

const errors: string[] = []
const hasImport = (source: ParsedSource, input: { module: string; local: string; runtime?: boolean }) =>
  source.imports.some(
    (binding) =>
      binding.module === input.module &&
      binding.local === input.local &&
      (input.runtime === true ? !binding.typeOnly : true),
  )

const prompt = parseSource(promptPath)
const index = parseSource(indexPath)
const processor = parseSource(processorPath)
const processorCheckpointTest = parseSource(processorCheckpointTestPath)

if (
  prompt.identifiers.has("CODE_SWITCH") &&
  !prompt.localVariables.has("CODE_SWITCH") &&
  !hasImport(prompt, { module: "ai", local: "CODE_SWITCH" })
) {
  errors.push("CODE_SWITCH is used in session/prompt.ts without a local binding")
}

if (prompt.identifiers.has("asSchema") && !hasImport(prompt, { module: "ai", local: "asSchema", runtime: true })) {
  errors.push("asSchema is used in session/prompt.ts without a runtime import from ai")
}

if (
  prompt.identifiers.has("ToolExecutionOptions") &&
  !hasImport(prompt, { module: "ai", local: "ToolExecutionOptions" })
) {
  errors.push("ToolExecutionOptions is used in session/prompt.ts without an import from ai")
}

if (
  index.identifiers.has("Telemetry") &&
  !hasImport(index, { module: "@kilocode/kilo-telemetry", local: "Telemetry", runtime: true })
) {
  errors.push("Telemetry is used in src/index.ts without a runtime import from @kilocode/kilo-telemetry")
}

if (processor.text.includes("LLM.Event")) {
  errors.push("src/session/processor.ts must not reference non-existent LLM.Event")
}

if (processorCheckpointTest.text.includes("LLM.Event")) {
  errors.push("test/kilocode/session-processor-lcm-checkpoint.test.ts must not reference non-existent LLM.Event")
}

if (errors.length > 0) {
  console.error("LCM prompt/runtime static check failed:")
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log("LCM prompt/runtime static check passed")
