import fs from 'fs'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const m = env.match(/^GEMINI_API_KEY=(.+)$/m) ?? env.match(/^GOOGLE_API_KEY=(.+)$/m)
if (!m) {
  console.error('missing GEMINI_API_KEY or GOOGLE_API_KEY in .env')
  process.exit(1)
}

const apiKey = m[1].trim()

const models = [
  'gemini-2.5-flash-tts',
  'gemini-2.5-pro-tts',
  'gemini-2.5-flash-lite-preview-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
]

const tryModel = async (model) => {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Read verbatim in Marathi (mr-IN): नमस्कार! हे मराठी भाषण चाचणी आहे.' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
    }),
  })
  const text = await resp.text().catch(() => '')
  let msg = text
  try {
    const j = JSON.parse(text)
    msg = j?.error?.message ?? text
  } catch {}
  const ok = resp.ok
  const mimeType = (() => {
    try {
      const j = JSON.parse(text)
      return j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType ?? ''
    } catch {
      return ''
    }
  })()
  const dataLen = (() => {
    try {
      const j = JSON.parse(text)
      const d = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      return typeof d === 'string' ? d.length : 0
    } catch {
      return 0
    }
  })()

  console.log(model, resp.status, ok ? 'ok' : 'fail', mimeType, dataLen || msg.slice(0, 120).replace(/\s+/g, ' '))
}

for (const model of models) {
  await tryModel(model)
}

