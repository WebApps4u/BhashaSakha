import { Link } from 'react-router-dom'
import { Volume2, X } from 'lucide-react'
import { LANGUAGES, getLanguageLabel } from '@/utils/languages'
import { useTranslation } from 'react-i18next'
import { UI_LOCALES, type UiLocale } from '@/lib/i18n'
import { useSettingsStore, type TtsGenderPreference } from '@/store/settingsStore'
import { useSpeechVoices } from '@/hooks/useSpeechVoices'
import { useTtsStyleAccess } from '@/hooks/useTtsStyleAccess'

const SPEAKERS = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4']

export default function LiveSettingsModal({
  open,
  speakerLabel,
  onSpeakerLabel,
  targetLang,
  onTargetLang,
  targetLangs,
  onTargetLangs,
  ttsEnabled,
  onTtsEnabled,
  ttsLang,
  onTtsLang,
  editorHref,
  onClose,
}: {
  open: boolean
  speakerLabel: string
  onSpeakerLabel: (label: string) => void
  targetLang: string
  onTargetLang: (lang: string) => void
  targetLangs: string[]
  onTargetLangs: (langs: string[]) => void
  ttsEnabled: boolean
  onTtsEnabled: (enabled: boolean) => void
  ttsLang: string
  onTtsLang: (lang: string) => void
  editorHref: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const uiLocale = useSettingsStore((s) => s.uiLocale)
  const setUiLocale = useSettingsStore((s) => s.setUiLocale)
  const ttsVoiceUri = useSettingsStore((s) => s.ttsVoiceUri)
  const setTtsVoiceUri = useSettingsStore((s) => s.setTtsVoiceUri)
  const ttsStylePrompt = useSettingsStore((s) => s.ttsStylePrompt)
  const setTtsStylePrompt = useSettingsStore((s) => s.setTtsStylePrompt)
  const ttsGender = useSettingsStore((s) => s.ttsGender)
  const setTtsGender = useSettingsStore((s) => s.setTtsGender)
  const ttsRate = useSettingsStore((s) => s.ttsRate)
  const setTtsRate = useSettingsStore((s) => s.setTtsRate)
  const ttsPitch = useSettingsStore((s) => s.ttsPitch)
  const setTtsPitch = useSettingsStore((s) => s.setTtsPitch)
  const ttsVolume = useSettingsStore((s) => s.ttsVolume)
  const setTtsVolume = useSettingsStore((s) => s.setTtsVolume)
  const { voices } = useSpeechVoices()
  const { allowed: stylePromptAllowed } = useTtsStyleAccess()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4 backdrop-blur-sm dark:bg-black/80" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl border border-neutral-200 bg-white p-8 shadow-2xl dark:border-neutral-800 dark:bg-black">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold uppercase tracking-widest text-black dark:text-white">{t('settings.sessionTitle')}</h2>
            <div className="mt-1 text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('settings.advanced')}</div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="group p-2 text-black transition-colors hover:bg-black hover:text-white dark:text-white dark:hover:bg-white dark:hover:text-black"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('settings.uiLanguage')}
            <select
              value={uiLocale}
              onChange={(e) => setUiLocale(e.target.value as UiLocale)}
              className="minimal-input text-black dark:text-white"
            >
              {UI_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('settings.currentSpeaker')}
            <select
              value={speakerLabel}
              onChange={(e) => onSpeakerLabel(e.target.value)}
              className="minimal-input text-black dark:text-white"
            >
              {SPEAKERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('settings.primaryTarget')}
            <select
              value={targetLang}
              onChange={(e) => onTargetLang(e.target.value)}
              className="minimal-input text-black dark:text-white"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2">
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-4">{t('settings.translateToMulti')}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {LANGUAGES.map((l) => {
                const checked = targetLangs.includes(l.code)
                return (
                  <label key={l.code} className="inline-flex items-center gap-3 text-sm text-black dark:text-white cursor-pointer group">
                    <div className={`h-4 w-4 border border-neutral-300 transition-colors group-hover:border-black dark:border-neutral-700 dark:group-hover:border-white ${checked ? 'bg-black dark:bg-white' : 'bg-transparent'}`} />
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked ? targetLangs.filter((c) => c !== l.code) : [...targetLangs, l.code]
                        onTargetLangs(next)
                        if (!next.includes(targetLang)) {
                          onTargetLang(next[0] ?? targetLang)
                        }
                        if (!next.includes(ttsLang)) {
                          onTtsLang(next[0] ?? '')
                        }
                      }}
                      className="hidden"
                    />
                    <span className="uppercase tracking-wide text-xs">{l.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="border border-neutral-200 p-6 md:col-span-2 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-3 mb-6">
              <div>
                <div className="text-sm font-bold uppercase tracking-wider text-black dark:text-white">{t('settings.voicePlayback')}</div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('settings.voicePlaybackHint')}</div>
              </div>
              <button
                type="button"
                onClick={() => onTtsEnabled(!ttsEnabled)}
                className={
                  'minimal-btn text-xs px-4 py-2 ' +
                  (ttsEnabled
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'border border-neutral-200 text-neutral-500 hover:border-black hover:text-black dark:border-neutral-800 dark:hover:border-white dark:hover:text-white')
                }
              >
                <Volume2 className="h-4 w-4 mr-2" />
                {ttsEnabled ? t('common.on') : t('common.off')}
              </button>
            </div>

            <div className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-6">
              {t('settings.ttsLanguage')}
              <select
                value={ttsLang}
                onChange={(e) => onTtsLang(e.target.value)}
                disabled={!ttsEnabled}
                className="minimal-input text-black dark:text-white"
              >
                {targetLangs.length === 0 ? <option value="">Select</option> : null}
                {targetLangs.map((code) => (
                  <option key={code} value={code}>
                    {getLanguageLabel(code)}
                  </option>
                ))}
              </select>
            </div>

            {stylePromptAllowed ? (
              <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-6">
                {t('settings.ttsStylePrompt')}
                <textarea
                  rows={3}
                  value={ttsStylePrompt}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsStylePrompt(e.target.value)}
                  placeholder={t('settings.ttsStylePromptPlaceholder')}
                  className="w-full border border-neutral-200 bg-transparent p-3 text-sm outline-none focus:border-black disabled:opacity-50 dark:border-neutral-800 dark:focus:border-white text-black dark:text-white placeholder:text-neutral-300 dark:placeholder:text-neutral-700"
                />
                <div className="text-[10px] normal-case tracking-normal text-neutral-400">{t('settings.ttsStylePromptHint')}</div>
              </label>
            ) : null}

            <div className="grid gap-6 md:grid-cols-2 mb-6">
              <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {t('settings.voice')}
                <select
                  value={ttsVoiceUri}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsVoiceUri(e.target.value)}
                  className="minimal-input text-black dark:text-white"
                >
                  <option value="">Auto</option>
                  {voices
                    .filter((v) => {
                      if (!ttsLang) return true
                      return (v.lang ?? '').toLowerCase().startsWith(ttsLang.toLowerCase())
                    })
                    .map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                </select>
              </label>

              <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {t('settings.genderPreference')}
                <select
                  value={ttsGender}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsGender(e.target.value as TtsGenderPreference)}
                  className="minimal-input text-black dark:text-white"
                >
                  <option value="any">{t('settings.genderAny')}</option>
                  <option value="female">{t('settings.genderFemale')}</option>
                  <option value="male">{t('settings.genderMale')}</option>
                </select>
              </label>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {t('settings.toneRate')}
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={ttsRate}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsRate(Number(e.target.value))}
                  className="accent-black dark:accent-white"
                />
              </label>
              <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {t('settings.tonePitch')}
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={ttsPitch}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsPitch(Number(e.target.value))}
                  className="accent-black dark:accent-white"
                />
              </label>
              <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {t('settings.toneVolume')}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ttsVolume}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsVolume(Number(e.target.value))}
                  className="accent-black dark:accent-white"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-neutral-100 pt-6 dark:border-neutral-800">
          {editorHref ? (
            <Link to={editorHref} className="text-xs font-bold uppercase tracking-widest text-black underline dark:text-white">
              {t('live.openEditor')}
            </Link>
          ) : (
            <div className="text-xs text-neutral-400">Start capture to create a session.</div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="minimal-btn-primary"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
