import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechCaptions } from '@/hooks/useSpeechCaptions'

export type CapturedAnswer = {
  text: string
  duration_ms: number | null
  latency_ms: number | null
  longest_pause_ms: number | null
  interrupted: boolean
}

// End-of-answer detection: a short pause to think must not cut the candidate off.
const MIN_WORDS_FOR_AUTO = 8
const SILENCE_WARN_MS = 2600
const SILENCE_SUBMIT_MS = 4400
const MAX_ANSWER_MS = 5 * 60 * 1000

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

/**
 * Captures one spoken answer at a time on top of the browser speech recognizer:
 * aggregates phrases, measures response latency and pauses, and detects when the candidate has finished.
 */
export function useAnswerCapture({
  autoDetect,
  interruptAfterMs,
  onAutoSubmit,
}: {
  autoDetect: boolean
  interruptAfterMs: number | null
  onAutoSubmit: (reason: 'silence' | 'interrupt') => void
}) {
  const activeRef = useRef(false)
  const partsRef = useRef<string[]>([])
  const [finalText, setFinalText] = useState('')
  const [pendingSubmit, setPendingSubmit] = useState(false)
  const timing = useRef({ questionEndAt: 0, firstSpeechAt: 0, lastActivityAt: 0, longestPauseMs: 0 })
  const onAutoSubmitRef = useRef(onAutoSubmit)
  onAutoSubmitRef.current = onAutoSubmit

  const markActivity = () => {
    const now = performance.now()
    const t = timing.current
    if (!t.firstSpeechAt) t.firstSpeechAt = now
    else t.longestPauseMs = Math.max(t.longestPauseMs, now - t.lastActivityAt)
    t.lastActivityAt = now
    setPendingSubmit(false)
  }

  const speech = useSpeechCaptions({
    enabled: true,
    lang: 'en-IN',
    onFinal: ({ text }) => {
      if (!activeRef.current) return
      partsRef.current.push(text)
      setFinalText(partsRef.current.join(' '))
      markActivity()
    },
  })
  const speechRef = useRef(speech)
  speechRef.current = speech

  useEffect(() => {
    if (activeRef.current && speech.interim) markActivity()
  }, [speech.interim])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!activeRef.current) return
      const s = speechRef.current
      if (s.status !== 'listening') return
      const t = timing.current
      const now = performance.now()
      const answering = t.firstSpeechAt ? now - t.firstSpeechAt : 0
      if (t.firstSpeechAt && (answering >= MAX_ANSWER_MS || (interruptAfterMs != null && answering >= interruptAfterMs))) {
        onAutoSubmitRef.current('interrupt')
        return
      }
      if (!autoDetect || !t.firstSpeechAt) return
      const words = countWords(`${partsRef.current.join(' ')} ${s.interim}`)
      const silence = now - t.lastActivityAt
      if (words >= MIN_WORDS_FOR_AUTO && silence >= SILENCE_SUBMIT_MS) {
        onAutoSubmitRef.current('silence')
      } else if (words >= MIN_WORDS_FOR_AUTO && silence >= SILENCE_WARN_MS) {
        setPendingSubmit(true)
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [autoDetect, interruptAfterMs])

  /** Opens the answer window; listening starts unless the mic is muted. */
  const begin = useCallback(async ({ listen }: { listen: boolean }) => {
    partsRef.current = []
    setFinalText('')
    setPendingSubmit(false)
    timing.current = { questionEndAt: performance.now(), firstSpeechAt: 0, lastActivityAt: 0, longestPauseMs: 0 }
    activeRef.current = true
    if (listen && speechRef.current.status === 'idle') await speechRef.current.start('en-IN')
  }, [])

  /** Stops listening and returns the complete answer with timing metrics. */
  const finish = useCallback(async (interrupted = false): Promise<CapturedAnswer> => {
    await speechRef.current.stop()
    activeRef.current = false
    setPendingSubmit(false)
    const t = timing.current
    const end = t.lastActivityAt || performance.now()
    return {
      text: partsRef.current.join(' ').replace(/\s+/g, ' ').trim(),
      duration_ms: t.firstSpeechAt ? Math.round(end - t.firstSpeechAt) : null,
      latency_ms: t.firstSpeechAt ? Math.round(t.firstSpeechAt - t.questionEndAt) : null,
      longest_pause_ms: t.firstSpeechAt ? Math.round(t.longestPauseMs) : null,
      interrupted,
    }
  }, [])

  /** Stops listening without keeping anything (e.g. the candidate switched to typing). */
  const cancel = useCallback(async () => {
    activeRef.current = false
    setPendingSubmit(false)
    await speechRef.current.stop()
    partsRef.current = []
    setFinalText('')
  }, [])

  // Muting stops the recognizer (keeping what was said so far); unmuting starts it again.
  // useSpeechCaptions.resume() cannot be used: it calls start() with a stale 'paused' status.
  const setMicMuted = useCallback(async (mutedNow: boolean) => {
    const s = speechRef.current
    if (mutedNow && s.status !== 'idle') await s.stop()
    if (!mutedNow && activeRef.current && s.status === 'idle') await s.start('en-IN')
  }, [])

  return {
    isSupported: speech.isSupported,
    status: speech.status,
    micLevel: speech.micLevel,
    error: speech.error,
    interim: speech.interim,
    finalText,
    liveText: `${finalText} ${speech.interim}`.trim(),
    pendingSubmit,
    begin,
    finish,
    cancel,
    setMicMuted,
  }
}
