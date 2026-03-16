import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSpeechCaptions } from '@/hooks/useSpeechCaptions'
import { useLanguageDetector } from '@/hooks/useLanguageDetector'
import { getLanguageLabel } from '@/utils/languages'
import LiveHeader, { type LiveMode } from '@/components/live/LiveHeader'
import LiveCanvas from '@/components/live/LiveCanvas'
import LiveFloatingControls from '@/components/live/LiveFloatingControls'
import LiveShareModal from '@/components/live/LiveShareModal'
import LiveSettingsModal from '@/components/live/LiveSettingsModal'
import { useLiveController } from '@/hooks/useLiveController'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import { cn } from '@/lib/utils'

export default function Live() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, isReady } = useAuthStore()

  const [mode, setMode] = useState<LiveMode>('translate')
  const [privacy, setPrivacy] = useState<'private' | 'shareable'>('private')

  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('hi')
  const [targetLangs, setTargetLangs] = useState<string[]>(['hi'])

  const [speakerLabel, setSpeakerLabel] = useState('Speaker 1')
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled)
  const setTtsEnabled = useSettingsStore((s) => s.setTtsEnabled)
  const [ttsLang, setTtsLang] = useState('hi')

  const [showSettings, setShowSettings] = useState(false)
  const [showShare, setShowShare] = useState(false)

  const isTranslateOn = mode === 'translate'
  const speechLang = useMemo(() => (sourceLang === 'auto' ? 'en-US' : sourceLang), [sourceLang])
  const activeTarget = isTranslateOn ? targetLang : ''

  const live = useLiveController({
    userId: user?.id ?? null,
    privacy,
    sourceLang,
    isTranslateOn,
    targetLangs,
    speakerLabel,
    ttsEnabled,
    ttsLang,
  })

  const detector = useLanguageDetector()

  const speech = useSpeechCaptions({
    enabled: !!user,
    lang: speechLang,
    onFinal: live.onFinal,
  })

  const orderedSegments = useMemo(() => live.segments.slice().sort((a, b) => a.seq - b.seq), [live.segments])
  const leftLines = useMemo(() => orderedSegments.map((s) => ({ id: s.id, text: s.text })), [orderedSegments])
  const rightLines = useMemo(() => {
    return orderedSegments.map((s) => {
      const rows = live.translationsBySegmentId[s.id] ?? []
      const preferred = activeTarget ? rows.find((r) => r.target_lang === activeTarget) : null
      const fallback = rows[0]
      return { id: s.id, text: preferred?.text ?? fallback?.text ?? '' }
    })
  }, [activeTarget, orderedSegments, live.translationsBySegmentId])

  const showRight = isTranslateOn
  const languageChip = showRight ? `${getLanguageLabel(sourceLang)} ⇄ ${getLanguageLabel(targetLang)}` : getLanguageLabel(sourceLang)

  const canStart = useMemo(() => isReady && !!user, [isReady, user])
  const editorHref = live.sessionId ? `/session/${live.sessionId}` : null
  const canShare = !!live.sessionId && privacy === 'shareable'

  const primaryAction = async () => {
    if (!isReady) return
    if (!user) {
      navigate('/login')
      return
    }

    if (speech.status === 'idle') {
      live.setError(null)
      
      if (sourceLang === 'auto') {
        const { language, error } = await detector.detect()
        if (language) {
          setSourceLang(language)
          await speech.start(language)
        } else {
          if (error) live.setError(error)
        }
      } else {
        await speech.start()
      }
      return
    }

    if (speech.status === 'paused') {
      live.setError(null)
      await speech.resume()
      return
    }

    if (speech.status === 'listening') {
      speech.stop()
      await live.endSession()
    }
  }

  const swap = () => {
    if (sourceLang === 'auto') return
    const a = sourceLang
    const b = targetLang
    setSourceLang(b)
    setTargetLang(a)
    setTargetLangs((prev) => {
      const rest = prev.filter((x) => x !== b)
      return Array.from(new Set([a, ...rest]))
    })
    setTtsLang(a)
  }

  const isListening = speech.status === 'listening' || detector.isDetecting

  return (
    <div className="relative min-h-[calc(100vh-57px)] bg-white dark:bg-black overflow-hidden">
      <div className={cn(
        "transition-all duration-700 ease-in-out",
        isListening ? "-translate-y-full opacity-0 h-0" : "translate-y-0 opacity-100"
      )}>
        <LiveHeader
          mode={mode}
          onMode={setMode}
          privacy={privacy}
          onPrivacy={setPrivacy}
          sourceLang={sourceLang}
          onSourceLang={(v) => setSourceLang(v)}
          targetLang={targetLang}
          onTargetLang={(v) => {
            setTargetLang(v)
            setTargetLangs((prev) => [v, ...prev.filter((x) => x !== v)])
            setTtsLang(v)
            setMode('translate')
          }}
          onSwap={swap}
          canShare={canShare}
          onOpenShare={() => setShowShare(true)}
          editorHref={editorHref}
          isSignedIn={!!user}
        />
      </div>

      {live.error || speech.error ? (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div className="border border-red-100 bg-red-50/50 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-red-800 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
            {live.error ?? speech.error}
          </div>
        </div>
      ) : null}

      <div className={cn(
        "transition-all duration-700 ease-in-out",
        isListening ? "h-[85vh]" : "h-auto"
      )}>
        <LiveCanvas
          showRight={showRight}
          leftLines={leftLines}
          interim={speech.interim}
          rightLines={rightLines}
          translatingIds={live.translatingIds}
          footerLeft={user ? t('live.savedHint') : t('live.signInHintFooter')}
          languageChip={languageChip}
          ttsEnabled={ttsEnabled}
          onToggleTts={() => setTtsEnabled(!ttsEnabled)}
        />
      </div>

      <LiveFloatingControls
        status={speech.status}
        isDetecting={detector.isDetecting}
        supportsSpeech={speech.isSupported}
        onPrimary={() => void primaryAction()}
        onPause={speech.pause}
        onSettings={() => setShowSettings(true)}
      />

      <LiveShareModal open={showShare} shareUrl={live.shareUrl} onClose={() => setShowShare(false)} />
      <LiveSettingsModal
        open={showSettings}
        speakerLabel={speakerLabel}
        onSpeakerLabel={setSpeakerLabel}
        targetLang={targetLang}
        onTargetLang={(v) => {
          setTargetLang(v)
          setTargetLangs((prev) => [v, ...prev.filter((x) => x !== v)])
        }}
        targetLangs={targetLangs}
        onTargetLangs={setTargetLangs}
        ttsEnabled={ttsEnabled}
        onTtsEnabled={setTtsEnabled}
        ttsLang={ttsLang}
        onTtsLang={setTtsLang}
        editorHref={editorHref}
        onClose={() => setShowSettings(false)}
      />

      {!canStart ? (
        <div className="fixed inset-x-0 bottom-28 z-10">
          <div className="mx-auto max-w-6xl px-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
              {t('live.signInToStart')}{' '}
              <Link className="font-medium text-slate-900 underline dark:text-slate-50" to="/login">
                {t('auth.goToLogin')}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
