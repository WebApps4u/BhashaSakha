import { Link } from 'react-router-dom'
import { Volume2 } from 'lucide-react'
import { LANGUAGES, getLanguageLabel } from '@/utils/languages'
import { useTranslation } from 'react-i18next'
import { UI_LOCALES, type UiLocale } from '@/lib/i18n'
import { useSettingsStore, type TtsGenderPreference } from '@/store/settingsStore'
import { useSpeechVoices } from '@/hooks/useSpeechVoices'

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
  const ttsGender = useSettingsStore((s) => s.ttsGender)
  const setTtsGender = useSettingsStore((s) => s.setTtsGender)
  const ttsRate = useSettingsStore((s) => s.ttsRate)
  const setTtsRate = useSettingsStore((s) => s.setTtsRate)
  const ttsPitch = useSettingsStore((s) => s.ttsPitch)
  const setTtsPitch = useSettingsStore((s) => s.setTtsPitch)
  const ttsVolume = useSettingsStore((s) => s.ttsVolume)
  const setTtsVolume = useSettingsStore((s) => s.setTtsVolume)
  const { voices } = useSpeechVoices()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4 dark:bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{t('settings.sessionTitle')}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-300">{t('settings.advanced')}</div>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">
            {t('common.close')}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            {t('settings.uiLanguage')}
            <select
              value={uiLocale}
              onChange={(e) => setUiLocale(e.target.value as UiLocale)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            >
              {UI_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            {t('settings.currentSpeaker')}
            <select
              value={speakerLabel}
              onChange={(e) => onSpeakerLabel(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            >
              {SPEAKERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            {t('settings.primaryTarget')}
            <select
              value={targetLang}
              onChange={(e) => onTargetLang(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2">
            <div className="text-xs text-slate-600 dark:text-slate-300">{t('settings.translateToMulti')}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LANGUAGES.map((l) => {
                const checked = targetLangs.includes(l.code)
                return (
                  <label key={l.code} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
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
                      className="h-4 w-4 rounded border-slate-300 dark:border-white/20"
                    />
                    {l.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{t('settings.voicePlayback')}</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t('settings.voicePlaybackHint')}</div>
              </div>
              <button
                type="button"
                onClick={() => onTtsEnabled(!ttsEnabled)}
                className={
                  'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm transition ' +
                  (ttsEnabled
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10')
                }
              >
                <Volume2 className="h-4 w-4" />
                {ttsEnabled ? t('common.on') : t('common.off')}
              </button>
            </div>

            <div className="mt-3 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
              {t('settings.ttsLanguage')}
              <select
                value={ttsLang}
                onChange={(e) => onTtsLang(e.target.value)}
                disabled={!ttsEnabled}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
              >
                {targetLangs.length === 0 ? <option value="">Select</option> : null}
                {targetLangs.map((code) => (
                  <option key={code} value={code}>
                    {getLanguageLabel(code)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                {t('settings.voice')}
                <select
                  value={ttsVoiceUri}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsVoiceUri(e.target.value)}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
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
                <div className="text-[11px] text-slate-500 dark:text-slate-300">{t('settings.voiceHint')}</div>
              </label>

              <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                {t('settings.genderPreference')}
                <select
                  value={ttsGender}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsGender(e.target.value as TtsGenderPreference)}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
                >
                  <option value="any">{t('settings.genderAny')}</option>
                  <option value="female">{t('settings.genderFemale')}</option>
                  <option value="male">{t('settings.genderMale')}</option>
                </select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                {t('settings.toneRate')}
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={ttsRate}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsRate(Number(e.target.value))}
                />
              </label>
              <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                {t('settings.tonePitch')}
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={ttsPitch}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsPitch(Number(e.target.value))}
                />
              </label>
              <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                {t('settings.toneVolume')}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ttsVolume}
                  disabled={!ttsEnabled}
                  onChange={(e) => setTtsVolume(Number(e.target.value))}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          {editorHref ? (
            <Link to={editorHref} className="text-sm font-medium text-slate-900 underline dark:text-slate-50">
              {t('live.openEditor')}
            </Link>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-300">Start capture to create a session.</div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
