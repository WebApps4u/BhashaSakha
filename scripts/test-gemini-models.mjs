import fs from 'fs'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const m = env.match(/^GOOGLE_API_KEY=(.+)$/m)
if (!m) {
  console.error('missing GOOGLE_API_KEY in .env')
  process.exit(1)
}

const apiKey = m[1].trim()
const baseUrl = 'https://generativelanguage.googleapis.com'

const call = async (apiVersion, model) => {
  const url = `${baseUrl}/${apiVersion}/models/${encodeURIComponent(model)}:generateContent`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Return ONLY JSON: {"ok": true}' }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  })
  const text = await resp.text()
  let msg = text
  try {
    msg = JSON.parse(text)?.error?.message ?? text
  } catch {
    msg = text
  }
  return { status: resp.status, ok: resp.ok, msg: String(msg).slice(0, 200).replace(/\s+/g, ' ') }
}

const models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-pro-latest', 'gemini-2.0-flash']
for (const model of models) {
  const v1 = await call('v1', model)
  const v1b = v1.ok ? null : await call('v1beta', model)
  console.log(model, 'v1', v1.status, v1.ok ? 'ok' : 'fail', v1.msg)
  if (v1b) console.log(model, 'v1beta', v1b.status, v1b.ok ? 'ok' : 'fail', v1b.msg)
}

