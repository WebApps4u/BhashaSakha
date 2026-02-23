import { create } from 'zustand'
import i18n, { type UiLocale, UI_LOCALE_STORAGE_KEY, persistUiLocale } from '@/lib/i18n'

export type TtsGenderPreference = 'any' | 'female' | 'male'

export type SettingsState = {
  uiLocale: UiLocale
  ttsVoiceUri: string
  ttsGender: TtsGenderPreference
  ttsRate: number
  ttsPitch: number
  ttsVolume: number
  init: () => void
  setUiLocale: (locale: UiLocale) => void
  setTtsVoiceUri: (voiceUri: string) => void
  setTtsGender: (pref: TtsGenderPreference) => void
  setTtsRate: (value: number) => void
  setTtsPitch: (value: number) => void
  setTtsVolume: (value: number) => void
}

const pickStoredLocale = (): UiLocale => {
  if (typeof window === 'undefined') return (i18n.language as UiLocale) || 'en'
  const raw = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY) ?? ''
  const v = raw as UiLocale
  return v || ((i18n.language as UiLocale) || 'en')
}

const numFromStorage = (key: string, fallback: number) => {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const strFromStorage = (key: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback
  return window.localStorage.getItem(key) ?? fallback
}

const SETTINGS_KEYS = {
  ttsVoiceUri: 'bs_tts_voice_uri',
  ttsGender: 'bs_tts_gender',
  ttsRate: 'bs_tts_rate',
  ttsPitch: 'bs_tts_pitch',
  ttsVolume: 'bs_tts_volume',
} as const

export const useSettingsStore = create<SettingsState>((set) => ({
  uiLocale: pickStoredLocale(),
  ttsVoiceUri: strFromStorage(SETTINGS_KEYS.ttsVoiceUri, ''),
  ttsGender: (strFromStorage(SETTINGS_KEYS.ttsGender, 'any') as TtsGenderPreference) || 'any',
  ttsRate: numFromStorage(SETTINGS_KEYS.ttsRate, 1),
  ttsPitch: numFromStorage(SETTINGS_KEYS.ttsPitch, 1),
  ttsVolume: numFromStorage(SETTINGS_KEYS.ttsVolume, 1),
  init: () => {
    const locale = pickStoredLocale()
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale)
    }
    set({ uiLocale: locale })
  },
  setUiLocale: (locale) => {
    persistUiLocale(locale)
    void i18n.changeLanguage(locale)
    set({ uiLocale: locale })
  },
  setTtsVoiceUri: (voiceUri) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(SETTINGS_KEYS.ttsVoiceUri, voiceUri)
    set({ ttsVoiceUri: voiceUri })
  },
  setTtsGender: (pref) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(SETTINGS_KEYS.ttsGender, pref)
    set({ ttsGender: pref })
  },
  setTtsRate: (value) => {
    const v = Math.min(2, Math.max(0.5, value))
    if (typeof window !== 'undefined') window.localStorage.setItem(SETTINGS_KEYS.ttsRate, String(v))
    set({ ttsRate: v })
  },
  setTtsPitch: (value) => {
    const v = Math.min(2, Math.max(0, value))
    if (typeof window !== 'undefined') window.localStorage.setItem(SETTINGS_KEYS.ttsPitch, String(v))
    set({ ttsPitch: v })
  },
  setTtsVolume: (value) => {
    const v = Math.min(1, Math.max(0, value))
    if (typeof window !== 'undefined') window.localStorage.setItem(SETTINGS_KEYS.ttsVolume, String(v))
    set({ ttsVolume: v })
  },
}))
