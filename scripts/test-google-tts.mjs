import fs from 'fs'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const keyMatch = env.match(/^GOOGLE_TTS_API_KEY=(.+)$/m) ?? env.match(/^GOOGLE_API_KEY=(.+)$/m)
if (!keyMatch) {
  console.error('missing GOOGLE_TTS_API_KEY or GOOGLE_API_KEY in .env')
  process.exit(1)
}

const apiKey = keyMatch[1].trim()
const lang = process.argv[2] || 'mr-IN'

const listVoices = async () => {
  const url = `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(lang)}`
  const resp = await fetch(url, { headers: { 'X-Goog-Api-Key': apiKey } })
  const text = await resp.text()
  console.log('voices', resp.status)
  if (!resp.ok) {
    console.log(text.slice(0, 500))
    process.exit(2)
  }
  const json = JSON.parse(text)
  const names = (json.voices || []).slice(0, 5).map((v) => v.name)
  console.log('sample_voices', names)
  return names[0]
}

const synth = async (voiceName) => {
  const resp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({
      input: { text: 'नमस्कार! हे मराठी भाषण चाचणी आहे.' },
      voice: { languageCode: lang, name: voiceName, ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })
  const text = await resp.text()
  console.log('synth', resp.status)
  if (!resp.ok) {
    console.log(text.slice(0, 500))
    process.exit(3)
  }
  const json = JSON.parse(text)
  console.log('audioContent_len', (json.audioContent || '').length)
}

const voice = await listVoices()
await synth(voice)

