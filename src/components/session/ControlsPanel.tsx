import { Copy, FileText, Globe, Mic, Pause, Play, Square, Subtitles, UploadCloud } from 'lucide-react'
import LevelBar from '@/components/session/LevelBar'
import { LANGUAGES, getLanguageLabel } from '@/utils/languages'
import { useSpeechVoices } from '@/hooks/useSpeechVoices'
import { useSettingsStore, type TtsGenderPreference } from '@/store/settingsStore'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type SpeechStatus = 'idle' | 'listening' | 'paused'

export default function ControlsPanel({
  isOwner,
  status,
  micLevel,
  speakerLabel,
  onSpeakerLabel,
  targetLangs,
  onTargetLangs,
  ttsEnabled,
  onTtsEnabled,
  ttsLang,
  onTtsLang,
  shareEnabled,
  shareUrl,
  shareBusy,
  exportBusy,
  onStart,
  onPause,
  onResume,
  onStop,
  onEnableShare,
  onCopyShare,
  onExportTxt,
  onExportVtt,
  onUploadVtt,
}: {
  isOwner: boolean
  status: SpeechStatus
  micLevel: number
  speakerLabel: string
  onSpeakerLabel: (label: string) => void
  targetLangs: string[]
  onTargetLangs: (langs: string[]) => void
  ttsEnabled: boolean
  onTtsEnabled: (enabled: boolean) => void
  ttsLang: string
  onTtsLang: (lang: string) => void
  shareEnabled: boolean
  shareUrl: string
  shareBusy: boolean
  exportBusy: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onEnableShare: () => void
  onCopyShare: () => void
  onExportTxt: () => void
  onExportVtt: () => void
  onUploadVtt: () => void
}) {
  const { t } = useTranslation()
  const { voices } = useSpeechVoices()
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

  return (
    <div className="space-y-6">
      <div className="minimal-card">
        <h2 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-6">Controls</h2>

        <div className="flex items-center justify-between border border-neutral-200 px-4 py-3 dark:border-neutral-800 mb-6">
          <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Mic Level</div>
          <LevelBar level={micLevel} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!isOwner || status !== 'idle'}
            onClick={onStart}
            className="minimal-btn-primary w-full disabled:opacity-50"
          >
            <Mic className="h-4 w-4 mr-2" />
            Start
          </button>
          <button
            type="button"
            disabled={!isOwner || status !== 'listening'}
            onClick={onPause}
            className="minimal-btn-outline w-full disabled:opacity-30"
          >
            <Pause className="h-4 w-4 mr-2" />
            Pause
          </button>
          <button
            type="button"
            disabled={!isOwner || status !== 'paused'}
            onClick={onResume}
            className="minimal-btn-outline w-full disabled:opacity-30"
          >
            <Play className="h-4 w-4 mr-2" />
            Resume
          </button>
          <button
            type="button"
            disabled={!isOwner || status === 'idle'}
            onClick={onStop}
            className="minimal-btn-outline w-full disabled:opacity-30"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop
          </button>
        </div>
      </div>

      <div className="minimal-card">
        <div className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-1">Conversation</div>
        <div className="text-xs text-neutral-500 mb-6">Select “Translate to” languages to enable realtime translation.</div>
        
        <div className="space-y-6">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Current Speaker</span>
            <select
              disabled={!isOwner}
              value={speakerLabel}
              onChange={(e) => onSpeakerLabel(e.target.value)}
              className="minimal-input text-black dark:text-white mt-2"
            >
              {['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3">Translate To</div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              {LANGUAGES.map((l) => {
                const checked = targetLangs.includes(l.code)
                return (
                  <label key={l.code} className="inline-flex items-center gap-3 cursor-pointer group">
                    <div className={`h-3 w-3 border border-neutral-300 transition-colors group-hover:border-black dark:border-neutral-700 dark:group-hover:border-white ${checked ? 'bg-black dark:bg-white' : 'bg-transparent'}`} />
                    <input
                      type="checkbox"
                      disabled={!isOwner}
                      checked={checked}
                      onChange={() => {
                        const next = checked ? targetLangs.filter((c) => c !== l.code) : [...targetLangs, l.code]
                        onTargetLangs(next)
                        if (!next.includes(ttsLang)) {
                          onTtsLang(next[0] ?? '')
                        }
                      }}
                      className="hidden"
                    />
                    <span className="text-xs uppercase tracking-wide text-black dark:text-white">{l.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="border-t border-neutral-200 pt-6 dark:border-neutral-800">
            <label className="flex items-center justify-between gap-2 mb-4 cursor-pointer">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('settings.voicePlayback')}</span>
              <div className={`w-8 h-4 border border-black p-0.5 flex items-center ${ttsEnabled ? 'justify-end bg-black' : 'justify-start bg-transparent'}`}>
                <input
                  type="checkbox"
                  disabled={!isOwner}
                  checked={ttsEnabled}
                  onChange={(e) => onTtsEnabled(e.target.checked)}
                  className="hidden"
                />
                <div className={`h-2.5 w-2.5 ${ttsEnabled ? 'bg-white' : 'bg-black'}`} />
              </div>
            </label>
            
            <div className="space-y-4">
              <select
                disabled={!isOwner || !ttsEnabled || targetLangs.length === 0}
                value={ttsLang}
                onChange={(e) => onTtsLang(e.target.value)}
                className="minimal-input text-black dark:text-white"
              >
                {targetLangs.length === 0 ? <option value="">Select target language</option> : null}
                {targetLangs.map((code) => (
                  <option key={code} value={code}>
                    {getLanguageLabel(code)}
                  </option>
                ))}
              </select>

              <div className="space-y-4">
                <select
                  disabled={!isOwner || !ttsEnabled}
                  value={ttsVoiceUri}
                  onChange={(e) => setTtsVoiceUri(e.target.value)}
                  className="minimal-input text-black dark:text-white"
                >
                  <option value="">Auto voice</option>
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

                <select
                  disabled={!isOwner || !ttsEnabled}
                  value={ttsGender}
                  onChange={(e) => setTtsGender(e.target.value as TtsGenderPreference)}
                  className="minimal-input text-black dark:text-white"
                >
                  <option value="any">{t('settings.genderAny')}</option>
                  <option value="female">{t('settings.genderFemale')}</option>
                  <option value="male">{t('settings.genderMale')}</option>
                </select>

                <div className="space-y-4 pt-2">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{t('settings.toneRate')}</span>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={ttsRate}
                      disabled={!isOwner || !ttsEnabled}
                      onChange={(e) => setTtsRate(Number(e.target.value))}
                      className="w-full accent-black dark:accent-white h-1 bg-neutral-200 rounded-none appearance-none cursor-pointer mt-2"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{t('settings.tonePitch')}</span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={ttsPitch}
                      disabled={!isOwner || !ttsEnabled}
                      onChange={(e) => setTtsPitch(Number(e.target.value))}
                      className="w-full accent-black dark:accent-white h-1 bg-neutral-200 rounded-none appearance-none cursor-pointer mt-2"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{t('settings.toneVolume')}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={ttsVolume}
                      disabled={!isOwner || !ttsEnabled}
                      onChange={(e) => setTtsVolume(Number(e.target.value))}
                      className="w-full accent-black dark:accent-white h-1 bg-neutral-200 rounded-none appearance-none cursor-pointer mt-2"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="minimal-card">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-1">
          <Globe className="h-4 w-4" />
          Sharing
        </div>
        <div className="text-xs text-neutral-500 mb-6">Makes the session public for anon viewers.</div>
        
        <div className="flex gap-3 mb-4">
          <button
            type="button"
            disabled={!isOwner || shareBusy}
            onClick={onEnableShare}
            className="minimal-btn-primary flex-1 disabled:opacity-50 text-[10px]"
          >
            Enable public link
          </button>
          <button
            type="button"
            disabled={!shareEnabled}
            onClick={onCopyShare}
            className="minimal-btn-outline flex-1 disabled:opacity-30 text-[10px]"
          >
            <Copy className="h-3 w-3 mr-2" />
            Copy
          </button>
        </div>
        {shareEnabled ? (
          <div className="truncate border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 font-mono">
            {shareUrl}
          </div>
        ) : null}
      </div>

      <div className="minimal-card">
        <div className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-1">Export</div>
        <div className="text-xs text-neutral-500 mb-6">Downloads as TXT or VTT (WebVTT captions).</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            type="button"
            disabled={exportBusy}
            onClick={onExportTxt}
            className="minimal-btn-outline w-full disabled:opacity-30 text-[10px]"
          >
            <FileText className="h-3 w-3 mr-2" />
            TXT
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={onExportVtt}
            className="minimal-btn-outline w-full disabled:opacity-30 text-[10px]"
          >
            <Subtitles className="h-3 w-3 mr-2" />
            VTT
          </button>
        </div>

        <button
          type="button"
          disabled={!isOwner || exportBusy}
          onClick={onUploadVtt}
          className="minimal-btn-outline w-full disabled:opacity-30 text-[10px]"
        >
          <UploadCloud className="h-3 w-3 mr-2" />
          Upload VTT to Storage
        </button>
      </div>
    </div>
  )
}
