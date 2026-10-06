// Text extraction for interview setup inputs: uploaded resume/JD files and public job-posting URLs.

import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'

export const MAX_EXTRACTED_CHARS = 40_000

const tidy = (text: string) =>
  text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS)

export const extractTextFromFile = async ({ buffer, filename, mimetype }: { buffer: Buffer; filename: string; mimetype: string }) => {
  const name = filename.toLowerCase()
  const type = mimetype.toLowerCase()

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const doc = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(doc, { mergePages: true })
    return tidy(Array.isArray(text) ? text.join('\n') : text)
  }

  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer })
    return tidy(value)
  }

  if (type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) {
    return tidy(buffer.toString('utf8'))
  }

  throw new Error('Unsupported file type. Upload a PDF, DOCX or TXT file.')
}

// ---------------------------------------------------------------------------
// Job posting URL fetch (SSRF-guarded)
// ---------------------------------------------------------------------------

const isPrivateIPv4 = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

const isPrivateIPv6 = (ip: string) => {
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIPv4(mapped[1]) : false
}

const assertPublicUrl = async (raw: string) => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Enter a valid URL starting with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http(s) URLs are supported')
  if (url.username || url.password) throw new Error('URLs with credentials are not supported')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Non-standard ports are not supported')

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('That address is not publicly reachable')
  }
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true })
  if (!addresses.length) throw new Error('Could not resolve that address')
  for (const a of addresses) {
    if ((a.family === 4 && isPrivateIPv4(a.address)) || (a.family === 6 && isPrivateIPv6(a.address))) {
      throw new Error('That address is not publicly reachable')
    }
  }
  return url
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const htmlToText = (html: string) =>
  tidy(
    decodeEntities(
      html
        .replace(/<(script|style|noscript|svg|head|nav|footer|iframe)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n• ')
        .replace(/<[^>]+>/g, ' '),
    ),
  )

/** Many job boards embed schema.org JobPosting JSON-LD, which is far cleaner than the page text. */
const extractJobPostingJsonLd = (html: string) => {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '')
    try {
      const parsed = JSON.parse(json)
      const nodes: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]
      const posting = nodes.find((n) => String(n?.['@type'] ?? '').toLowerCase() === 'jobposting')
      if (!posting) continue
      const description = typeof posting.description === 'string' ? htmlToText(posting.description) : ''
      if (!description) continue
      const company = typeof posting.hiringOrganization === 'object' ? String(posting.hiringOrganization?.name ?? '') : ''
      return { title: String(posting.title ?? '').trim(), company: company.trim(), text: description }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null
}

export const fetchJobPosting = async (rawUrl: string) => {
  let url = await assertPublicUrl(rawUrl.trim())
  if (/(^|\.)linkedin\.com$/i.test(url.hostname) && url.pathname.startsWith('/in/')) {
    throw new Error('LinkedIn profiles cannot be fetched. Upload your LinkedIn PDF export or paste the details instead.')
  }

  let resp: Response | null = null
  for (let hop = 0; hop < 4; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      resp = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BhashaSakhaInterviewPrep/1.0)', Accept: 'text/html,text/plain;q=0.9' },
      })
    } finally {
      clearTimeout(timer)
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
      url = await assertPublicUrl(new URL(resp.headers.get('location')!, url).toString())
      continue
    }
    break
  }

  if (!resp || !resp.ok) throw new Error(`The page could not be loaded (HTTP ${resp?.status ?? 'error'}). Paste the job description instead.`)
  const type = (resp.headers.get('content-type') ?? '').toLowerCase()
  if (!type.includes('text/html') && !type.includes('text/plain')) throw new Error('That URL is not a web page. Paste the job description instead.')

  const reader = resp.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) break
      total += value.length
      chunks.push(value)
      if (total > 1_500_000) {
        await reader.cancel()
        break
      }
    }
  }
  const body = Buffer.concat(chunks).toString('utf8')

  const posting = type.includes('text/html') ? extractJobPostingJsonLd(body) : null
  if (posting) return { ...posting, source: 'structured' as const, url: url.toString() }

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const text = type.includes('text/html') ? htmlToText(body) : tidy(body)
  if (text.length < 200) throw new Error('Not enough readable text on that page (it may require sign-in). Paste the job description instead.')
  return { title: titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 160) : '', company: '', text, source: 'page' as const, url: url.toString() }
}
