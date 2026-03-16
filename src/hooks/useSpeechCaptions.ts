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

  const startTimeRef = useRef<number | null>(null)
  const currentStartMsRef = useRef<number | null>(null)

  const isSupported = useMemo(() => !!getRecognitionCtor(), [])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
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

  const start = async (overrideLang?: string) => {
    if (!enabled) return
    if (status !== 'idle') return

    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('SpeechRecognition is not supported in this browser. Try Chrome on desktop.')
      return
    }

    setError(null)
    setInterim('')

    await beginMicMeter()

    const recognition = new Ctor()
    recognitionRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    
    const targetLang = overrideLang || lang
    recognition.lang = targetLang?.trim() ? targetLang.trim() : 'en-US'

    startTimeRef.current = performance.now()
    currentStartMsRef.current = null

    recognition.onerror = (e) => {
      setError(e.message || e.error || 'Speech recognition error')
      setStatus('idle')
      stopMicMeter()
    }

    recognition.onend = () => {
      setStatus((s) => {
        if (s === 'listening') {
          stopMicMeter()
          return 'idle'
        }
        return s
      })
    }

    recognition.onresult = (event) => {
      const startRef = startTimeRef.current ?? performance.now()
      const elapsedMs = Math.max(0, Math.round(performance.now() - startRef))

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        const text = res[0]?.transcript?.trim() ?? ''
        if (!text) continue

        if (!res.isFinal) {
          if (currentStartMsRef.current == null) currentStartMsRef.current = elapsedMs
          setInterim(text)
          continue
        }

        const startMs = currentStartMsRef.current ?? elapsedMs
        const endMs = Math.max(elapsedMs, startMs + 200)
        currentStartMsRef.current = null
        setInterim('')

        void onFinal({ text, startMs, endMs })
      }
    }

    recognition.start()
    setStatus('listening')
  }

  const pause = () => {
    if (!enabled) return
    if (status !== 'listening') return
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

  const stop = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    stopMicMeter()
    setInterim('')
    setStatus('idle')
  }

  return { isSupported, status, interim, micLevel, error, setError, start, pause, resume, stop }
}
