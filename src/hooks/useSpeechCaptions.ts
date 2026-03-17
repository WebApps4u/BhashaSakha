import { useEffect, useMemo, useRef, useState } from 'react'

export type SpeechStatus = 'idle' | 'listening' | 'paused'

function getRecognitionCtor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useSpeechCaptions({
  enabled,
  onFinal,
  lang,
}: {
  enabled: boolean
  onFinal: (payload: { text: string; startMs: number; endMs: number }) => Promise<void> | void
  lang?: string
}) {
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [interim, setInterim] = useState('')
  const [micLevel, setMicLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const shouldListenRef = useRef(false)
  const desiredLangRef = useRef<string>('en-US')
  const restartTimerRef = useRef<number | null>(null)
  const restartAttemptRef = useRef(0)

  const interimTextRef = useRef<string>('')
  const pendingFinalsRef = useRef<Promise<void>[]>([])

  const flushTimerRef = useRef<number | null>(null)
  const lastInterimAtRef = useRef<number>(0)
  const lastDeliveredAtRef = useRef<number>(0)
  const lastDeliveredTextRef = useRef<string>('')

  const startTimeRef = useRef<number | null>(null)
  const currentStartMsRef = useRef<number | null>(null)

  const isSupported = useMemo(() => !!getRecognitionCtor(), [])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current)
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      recognitionRef.current?.abort()
      audioContextRef.current?.close()
    }
  }, [])

  const beginMicMeter = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    micStreamRef.current = stream

    const audioContext = new AudioContext()
    audioContextRef.current = audioContext

    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)

    const data = new Uint8Array(analyser.frequencyBinCount)
    const loop = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      setMicLevel(rms)
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()
  }

  const stopMicMeter = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setMicLevel(0)
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
  }

  const elapsedNowMs = () => {
    const startRef = startTimeRef.current ?? performance.now()
    return Math.max(0, Math.round(performance.now() - startRef))
  }

  const deliverFinal = async (text: string, endMs: number) => {
    const cleaned = text.trim()
    if (!cleaned) return
    const now = Date.now()
    if (lastDeliveredTextRef.current === cleaned && now - lastDeliveredAtRef.current < 1500) return

    lastDeliveredTextRef.current = cleaned
    lastDeliveredAtRef.current = now

    const startMs = currentStartMsRef.current ?? endMs
    const safeEndMs = Math.max(endMs, startMs + 200)
    currentStartMsRef.current = null
    interimTextRef.current = ''
    setInterim('')
    try {
      await onFinal({ text: cleaned, startMs, endMs: safeEndMs })
    } catch {
      // ignore
    }
  }

  const clearFlushTimer = () => {
    if (!flushTimerRef.current) return
    window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = null
  }

  const scheduleFlushOnSilence = () => {
    if (!enabled) return
    if (!shouldListenRef.current) return
    if (flushTimerRef.current) return
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      if (!enabled) return
      if (!shouldListenRef.current) return
      const snapshot = interimTextRef.current
      if (!snapshot.trim()) return
      if (Date.now() - lastInterimAtRef.current < 1100) {
        scheduleFlushOnSilence()
        return
      }
      const endMs = elapsedNowMs()
      const p = deliverFinal(snapshot, endMs)
      pendingFinalsRef.current.push(p)
      void p.finally(() => {
        pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
      })
    }, 1200)
  }

  const scheduleRestart = (reason: string) => {
    void reason
    if (!enabled) return
    if (!shouldListenRef.current) return
    if (restartTimerRef.current) return

    const attempt = restartAttemptRef.current
    const delay = Math.min(2000, 200 * Math.pow(2, attempt))
    restartAttemptRef.current = Math.min(6, attempt + 1)

    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null
      if (!enabled) return
      if (!shouldListenRef.current) return

      try {
        recognitionRef.current?.abort()
      } catch {
        // ignore
      }

      // Re-create recognition each time to avoid stuck instances
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        setError('SpeechRecognition is not supported in this browser. Try Chrome on desktop.')
        shouldListenRef.current = false
        setStatus('idle')
        stopMicMeter()
        return
      }

      const recognition = new Ctor()
      recognitionRef.current = recognition
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.lang = desiredLangRef.current

      recognition.onerror = (e) => {
        const errCode = (e as any).error ?? ''
        const msg = (e as any).message || errCode || 'Speech recognition error'
        setError(msg)
        if (errCode === 'no-speech' || errCode === 'aborted' || errCode === 'network' || errCode === 'audio-capture') {
          scheduleRestart(errCode)
          return
        }
        shouldListenRef.current = false
        setStatus('idle')
        stopMicMeter()
      }

      recognition.onend = () => {
        if (!shouldListenRef.current) {
          setStatus('idle')
          stopMicMeter()
          return
        }
        if (interimTextRef.current.trim()) {
          clearFlushTimer()
          const p = deliverFinal(interimTextRef.current, elapsedNowMs())
          pendingFinalsRef.current.push(p)
          void p.finally(() => {
            pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
          })
        }
        scheduleRestart('onend')
      }

      recognition.onresult = (event) => {
        const elapsedMs = elapsedNowMs()

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]
          const text = res[0]?.transcript?.trim() ?? ''
          if (!text) continue

          if (!res.isFinal) {
            if (currentStartMsRef.current == null) currentStartMsRef.current = elapsedMs
            interimTextRef.current = text
            setInterim(text)
            lastInterimAtRef.current = Date.now()
            scheduleFlushOnSilence()
            continue
          }
          clearFlushTimer()
          const p = deliverFinal(text, elapsedMs)
          pendingFinalsRef.current.push(p)
          void p.finally(() => {
            pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
          })
        }
      }

      try {
        recognition.start()
        setStatus('listening')
        setError(null)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start SpeechRecognition'
        setError(msg)
        scheduleRestart('start_failed')
      }
    }, delay)
  }

  const start = async (overrideLang?: string) => {
    if (!enabled) return
    if (status !== 'idle') return

    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('SpeechRecognition is not supported in this browser. Try Chrome on desktop.')
      return
    }

    setError(null)
    interimTextRef.current = ''
    setInterim('')
    lastDeliveredAtRef.current = 0
    lastDeliveredTextRef.current = ''
    lastInterimAtRef.current = 0
    clearFlushTimer()

    shouldListenRef.current = true
    restartAttemptRef.current = 0
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }

    await beginMicMeter()

    const recognition = new Ctor()
    recognitionRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    
    const targetLang = overrideLang || lang
    const normalizedLang = targetLang?.trim() ? targetLang.trim() : 'en-US'
    desiredLangRef.current = normalizedLang
    recognition.lang = normalizedLang

    startTimeRef.current = performance.now()
    currentStartMsRef.current = null

    recognition.onerror = (e) => {
      const errCode = (e as any).error ?? ''
      const msg = (e as any).message || errCode || 'Speech recognition error'
      setError(msg)
      if (shouldListenRef.current && (errCode === 'no-speech' || errCode === 'aborted' || errCode === 'network' || errCode === 'audio-capture')) {
        scheduleRestart(errCode)
        return
      }
      shouldListenRef.current = false
      setStatus('idle')
      stopMicMeter()
    }

    recognition.onend = () => {
      if (!shouldListenRef.current) {
        setStatus((s) => {
          if (s === 'listening') {
            stopMicMeter()
            return 'idle'
          }
          return s
        })
        return
      }

      if (interimTextRef.current.trim()) {
        clearFlushTimer()
        const p = deliverFinal(interimTextRef.current, elapsedNowMs())
        pendingFinalsRef.current.push(p)
        void p.finally(() => {
          pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
        })
      }

      scheduleRestart('onend')
    }

    recognition.onresult = (event) => {
      const elapsedMs = elapsedNowMs()

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const text = res[0]?.transcript?.trim() ?? ''
        if (!text) continue

        if (!res.isFinal) {
          if (currentStartMsRef.current == null) currentStartMsRef.current = elapsedMs
          interimTextRef.current = text
          setInterim(text)
          lastInterimAtRef.current = Date.now()
          scheduleFlushOnSilence()
          continue
        }
        clearFlushTimer()
        const p = deliverFinal(text, elapsedMs)
        pendingFinalsRef.current.push(p)
        void p.finally(() => {
          pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
        })
      }
    }

    recognition.start()
    setStatus('listening')
  }

  const restart = async (overrideLang?: string) => {
    if (!enabled) return
    const nextLang = (overrideLang ?? lang)?.trim() ? (overrideLang ?? lang)!.trim() : 'en-US'
    desiredLangRef.current = nextLang
    restartAttemptRef.current = 0

    // Keep shouldListen true so onend triggers restart
    shouldListenRef.current = true
    setStatus('listening')
    setError(null)
    interimTextRef.current = ''
    setInterim('')

    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }

    // If onend doesn't fire, force a restart shortly
    if (!restartTimerRef.current) {
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        scheduleRestart('manual_restart')
      }, 250)
    }
  }

  const pause = () => {
    if (!enabled) return
    if (status !== 'listening') return
    if (interimTextRef.current.trim()) {
      clearFlushTimer()
      const p = deliverFinal(interimTextRef.current, elapsedNowMs())
      pendingFinalsRef.current.push(p)
      void p.finally(() => {
        pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
      })
    }
    shouldListenRef.current = false
    recognitionRef.current?.stop()
    stopMicMeter()
    setStatus('paused')
  }

  const resume = async () => {
    if (!enabled) return
    if (status !== 'paused') return
    setStatus('idle')
    await start()
  }

  const stop = async () => {
    if (interimTextRef.current.trim()) {
      clearFlushTimer()
      const p = deliverFinal(interimTextRef.current, elapsedNowMs())
      pendingFinalsRef.current.push(p)
      void p.finally(() => {
        pendingFinalsRef.current = pendingFinalsRef.current.filter((x) => x !== p)
      })
    }
    shouldListenRef.current = false
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    clearFlushTimer()
    recognitionRef.current?.stop()
    recognitionRef.current = null
    stopMicMeter()
    interimTextRef.current = ''
    setInterim('')
    setStatus('idle')

    const pending = pendingFinalsRef.current.slice()
    pendingFinalsRef.current = []
    if (pending.length) {
      await Promise.allSettled(pending)
    }
  }

  return { isSupported, status, interim, micLevel, error, setError, start, restart, pause, resume, stop }
}
