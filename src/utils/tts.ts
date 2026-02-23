import type { TtsGenderPreference } from '@/store/settingsStore'

const normalize = (v: string) => v.trim().toLowerCase()

const inferGender = (voice: SpeechSynthesisVoice): 'female' | 'male' | 'unknown' => {
  const s = normalize(`${voice.name} ${voice.voiceURI}`)
  const female = /(female|woman|girl|feminine)/i.test(s)
  const male = /(male|man|boy|masculine)/i.test(s)
  if (female && !male) return 'female'
  if (male && !female) return 'male'
  return 'unknown'
}

export function speakTts({
  text,
  lang,
  voiceUri,
  gender,
  rate,
  pitch,
  volume,
}: {
  text: string
  lang: string
  voiceUri: string
  gender: TtsGenderPreference
  rate: number
  pitch: number
  volume: number
}) {
  if (typeof window === 'undefined') return false
  if (!('speechSynthesis' in window)) return false
  const trimmed = text.trim()
  if (!trimmed) return false

  const utter = new SpeechSynthesisUtterance(trimmed)
  utter.lang = lang
  utter.rate = Math.min(2, Math.max(0.5, rate))
  utter.pitch = Math.min(2, Math.max(0, pitch))
  utter.volume = Math.min(1, Math.max(0, volume))

  const voices = window.speechSynthesis.getVoices()
  const lowerLang = normalize(lang)

  let selected: SpeechSynthesisVoice | undefined
  if (voiceUri) {
    selected = voices.find((v) => v.voiceURI === voiceUri)
  }

  if (!selected) {
    const langMatches = voices.filter((v) => normalize(v.lang).startsWith(lowerLang))
    const defaults = langMatches.filter((v) => v.default)

    const pickByGender = (list: SpeechSynthesisVoice[]) => {
      if (gender === 'any') return undefined
      return list.find((v) => inferGender(v) === gender)
    }

    selected = pickByGender(langMatches) ?? pickByGender(defaults) ?? defaults[0] ?? langMatches[0]
  }

  if (selected) utter.voice = selected
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utter)
  return true
}

