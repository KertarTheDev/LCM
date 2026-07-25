interface Request {
  pattern: string
  flags: string
  values: Array<{ id: string; text: string }>
  limit: number
}

interface Match {
  id: string
  ranges: Array<{ start: number; end: number }>
}

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    if (event.data.pattern.length > 512) throw new Error("pattern_too_large")
    const expression = new RegExp(
      event.data.pattern,
      event.data.flags.includes("g") ? event.data.flags : `${event.data.flags}g`,
    )
    const matches: Match[] = []
    let count = 0
    for (const value of event.data.values) {
      if (value.text.length > 1_000_000) continue
      expression.lastIndex = 0
      const ranges: Match["ranges"] = []
      while (count < event.data.limit) {
        const match = expression.exec(value.text)
        if (!match) break
        ranges.push({ start: match.index, end: match.index + match[0].length })
        count++
        if (match[0].length === 0) expression.lastIndex++
      }
      if (ranges.length > 0) matches.push({ id: value.id, ranges })
      if (count >= event.data.limit) break
    }
    self.postMessage({ matches })
  } catch {
    self.postMessage({ error: "lcm_invalid_regex" })
  }
}
