interface Request {
  pattern: string
  flags: string
  values: Array<{ id: string; text: string }>
  recordLimit: number
  rangeOffset: number
  rangeLimit: number
}

interface Match {
  id: string
  ranges: Array<{ start: number; end: number }>
  matchCount: number
  rangesComplete: boolean
}

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    if (event.data.pattern.length > 512) throw new Error("pattern_too_large")
    const expression = new RegExp(
      event.data.pattern,
      event.data.flags.includes("g") ? event.data.flags : `${event.data.flags}g`,
    )
    const matches: Match[] = []
    for (const value of event.data.values) {
      expression.lastIndex = 0
      const ranges: Match["ranges"] = []
      let matchCount = 0
      while (true) {
        const match = expression.exec(value.text)
        if (!match) break
        const occurrence = matchCount++
        if (occurrence >= event.data.rangeOffset && ranges.length < event.data.rangeLimit) {
          ranges.push({ start: match.index, end: match.index + match[0].length })
        }
        if (match[0].length === 0) expression.lastIndex++
      }
      if (ranges.length > 0) {
        matches.push({
          id: value.id,
          ranges,
          matchCount,
          rangesComplete: event.data.rangeOffset === 0 && ranges.length === matchCount,
        })
      }
      if (matches.length >= event.data.recordLimit) break
    }
    self.postMessage({ type: "result", matches })
  } catch {
    self.postMessage({ type: "error", error: "lcm_invalid_regex" })
  }
}

self.postMessage({ type: "ready" })
