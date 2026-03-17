export type RiskType =
  | 'amount'
  | 'date'
  | 'account'
  | 'pan'
  | 'aadhaar'
  | 'upi'
  | 'ifsc'
  | 'phone'
  | 'email'

export type RiskItem = {
  type: RiskType
  raw: string
  redacted: string
  start: number
  end: number
}

const maskKeepLast4Digits = (s: string) => {
  const digits = s.replace(/\D/g, '')
  if (digits.length <= 4) return s
  const last4 = digits.slice(-4)
  return `****${last4}`
}

const redact = (type: RiskType, raw: string) => {
  if (type === 'pan') {
    const v = raw.toUpperCase().replace(/\s+/g, '')
    if (v.length === 10) return `${v.slice(0, 3)}*****${v.slice(-2)}`
    return v
  }
  if (type === 'aadhaar') return maskKeepLast4Digits(raw)
  if (type === 'account') return maskKeepLast4Digits(raw)
  if (type === 'phone') return maskKeepLast4Digits(raw)
  if (type === 'ifsc') return raw.toUpperCase()
  if (type === 'email') {
    const [u, d] = raw.split('@')
    if (!d) return raw
    const user = u.length <= 2 ? `${u[0] ?? '*'}*` : `${u.slice(0, 2)}***`
    return `${user}@${d}`
  }
  if (type === 'upi') {
    const [u, h] = raw.split('@')
    if (!h) return raw
    const user = u.length <= 2 ? `${u[0] ?? '*'}*` : `${u.slice(0, 2)}***`
    return `${user}@${h}`
  }
  return raw
}

const pushMatches = (out: RiskItem[], type: RiskType, text: string, re: RegExp) => {
  for (const m of text.matchAll(re)) {
    const raw = String(m[0])
    const start = typeof m.index === 'number' ? m.index : -1
    if (start < 0) continue
    const end = start + raw.length
    out.push({ type, raw, redacted: redact(type, raw), start, end })
  }
}

export const extractRisks = (text: string): RiskItem[] => {
  const t = text ?? ''
  if (!t) return []

  const out: RiskItem[] = []

  // PAN (strict) + PAN (loose: ASR often drops one leading letter or inserts spaces)
  pushMatches(out, 'pan', t, /\b[A-Z]{5}\d{4}[A-Z]\b/gi)
  pushMatches(out, 'pan', t, /\b[A-Z]{4,5}[\s-]*\d{4}[\s-]*[A-Z]\b/gi)
  pushMatches(out, 'aadhaar', t, /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g)
  pushMatches(out, 'ifsc', t, /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi)
  // UPI IDs (try to avoid emails by requiring no dot in domain)
  pushMatches(out, 'upi', t, /\b[\w.-]{2,64}@[a-zA-Z]{2,20}\b/g)
  pushMatches(out, 'email', t, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)
  pushMatches(out, 'phone', t, /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g)
  pushMatches(out, 'date', t, /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g)
  pushMatches(out, 'date', t, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/gi)
  pushMatches(out, 'amount', t, /(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d+)?/gi)
  pushMatches(out, 'amount', t, /\b\d+(?:\.\d+)?\s*(?:lakh|lac|crore|cr)\b/gi)
  // Generic long digit strings as account numbers (avoid Aadhaar already captured)
  pushMatches(out, 'account', t, /\b\d{9,18}\b/g)

  out.sort((a, b) => a.start - b.start || b.end - a.end)

  const deduped: RiskItem[] = []
  let lastEnd = -1
  for (const r of out) {
    if (r.start < lastEnd) continue
    deduped.push(r)
    lastEnd = r.end
  }
  return deduped
}
