import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useSettingsStore } from '@/store/settingsStore'
import { playServerTts } from '@/utils/tts'

type SegmentRow = {
  id: string
  seq: number
  speaker_label: string
  detected_lang?: string | null
  text: string
}

type TranslationRow = {
  id?: string
  segment_id: string
  target_lang: string
  text: string
}

export function useLiveController({
  userId,
  privacy,
  sourceLang,
  isTranslateOn,
  targetLangs,
  speakerLabel,
  ttsEnabled,
  ttsLang,
}: {
  userId: string | null
  privacy: 'private' | 'shareable'
  sourceLang: string
  isTranslateOn: boolean
  targetLangs: string[]
  speakerLabel: string
  ttsEnabled: boolean
  ttsLang: string
}) {
  const ttsGender = useSettingsStore((s) => s.ttsGender)
  const ttsRate = useSettingsStore((s) => s.ttsRate)
  const ttsPitch = useSettingsStore((s) => s.ttsPitch)
  const ttsVolume = useSettingsStore((s) => s.ttsVolume)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [translationsBySegmentId, setTranslationsBySegmentId] = useState<Record<string, TranslationRow[]>>({})
  const [translatingIds, setTranslatingIds] = useState<Record<string, true>>({})
  const nextSeqRef = useRef(1)

  const inflightRef = useRef(0)
  const queueRef = useRef<Array<() => Promise<void>>>([])

  const desiredVisibility = useMemo(() => (privacy === 'shareable' ? 'public' : 'private'), [privacy])

  const ensureSession = async () => {
    if (!userId) return null
    if (sessionId) return sessionId
    const { data, error: err } = await supabase
      .from('sessions')
      .insert({
        owner_id: userId,
        title: 'Live session',
        source_lang: sourceLang,
        target_langs: isTranslateOn ? targetLangs : [],
        visibility: desiredVisibility,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (err) throw err
    setSessionId(data.id)
    const url = `${window.location.origin}/s/${data.id}`
    setShareUrl(url)
    return data.id as string
  }

  const translateOnly = async (text: string, targets: string[]) => {
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token ?? ''

    const resp = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ text, targets }),
    })

    const json = (await resp.json()) as {
      success?: boolean
      detected_language?: string
      translations?: Record<string, string>
      error?: string
      details?: string
      tried_models?: string[]
    }

    if (!resp.ok || !json.success) {
      const tried = json.tried_models?.length ? ` Tried: ${json.tried_models.join(', ')}` : ''
      const details = json.details ? ` ${json.details}` : ''
      throw new Error((json.error ?? 'Translation failed') + tried + details)
    }

    return {
      detected: json.detected_language ?? 'und',
      translations: json.translations ?? {},
    }
  }

  const persistTranslation = async (segId: string, detected: string, translations: Record<string, string>) => {
    await supabase.from('transcript_segments').update({ detected_lang: detected }).eq('id', segId)

    const translationRows = Object.entries(translations).map(([lang, translatedText]) => ({
      segment_id: segId,
      target_lang: lang,
      text: translatedText,
    }))

    if (!translationRows.length) return
    const { data: upserted, error: upsertErr } = await supabase
      .from('translations')
      .upsert(translationRows, { onConflict: 'segment_id,target_lang' })
      .select('id,segment_id,target_lang,text')
    if (upsertErr) throw upsertErr

    const rows = (upserted ?? []) as TranslationRow[]
    setTranslationsBySegmentId((prev) => ({ ...prev, [segId]: rows }))
  }

  const enqueue = (fn: () => Promise<void>) => {
    queueRef.current.push(fn)
    void drainQueue()
  }

  const drainQueue = async () => {
    if (inflightRef.current >= 2) return
    const job = queueRef.current.shift()
    if (!job) return
    inflightRef.current += 1
    try {
      await job()
    } finally {
      inflightRef.current -= 1
      void drainQueue()
    }
  }

  const onFinal = async ({ text, startMs, endMs }: { text: string; startMs: number; endMs: number }) => {
    try {
      if (!userId) return
      const sid = await ensureSession()
      if (!sid) return

      const seq = nextSeqRef.current++
      const optimisticId = crypto.randomUUID()
      setSegments((prev) => [...prev, { id: optimisticId, seq, speaker_label: speakerLabel, detected_lang: null, text }].sort((a, b) => a.seq - b.seq))

      const shouldTranslate = isTranslateOn && targetLangs.length > 0
      const translatePromise = shouldTranslate ? translateOnly(text, targetLangs) : null

      if (shouldTranslate) {
        setTranslatingIds((prev) => ({ ...prev, [optimisticId]: true }))
      }

      const { data, error: insertErr } = await supabase
        .from('transcript_segments')
        .insert({
          session_id: sid,
          seq,
          speaker_label: speakerLabel,
          start_ms: startMs,
          end_ms: endMs,
          text,
          is_final: true,
          is_edited: false,
        })
        .select('id')
        .single()
      if (insertErr) throw insertErr

      setSegments((prev) => prev.map((s) => (s.id === optimisticId ? { ...s, id: data.id } : s)))

      if (shouldTranslate) {
        setTranslatingIds((prev) => {
          const next = { ...prev }
          delete next[optimisticId]
          next[data.id] = true
          return next
        })
        setTranslationsBySegmentId((prev) => {
          if (!prev[optimisticId]) return prev
          const next = { ...prev }
          next[data.id] = prev[optimisticId]
          delete next[optimisticId]
          return next
        })
      }

      if (!shouldTranslate || !translatePromise) return
      enqueue(async () => {
        try {
          const result = await translatePromise
          const rows = Object.entries(result.translations).map(([lang, translatedText]) => ({
            segment_id: data.id,
            target_lang: lang,
            text: translatedText,
          }))
          setTranslationsBySegmentId((prev) => ({ ...prev, [data.id]: rows }))

          if (ttsEnabled && ttsLang) {
            const speakText = rows.find((r) => r.target_lang === ttsLang)?.text
            if (speakText) {
              await playServerTts({
                text: speakText,
                lang: ttsLang,
                gender: ttsGender,
                rate: ttsRate,
                pitch: ttsPitch,
                volume: ttsVolume,
              })
            }
          }

          await persistTranslation(data.id, result.detected, result.translations)
        } finally {
          setTranslatingIds((prev) => {
            const next = { ...prev }
            delete next[data.id]
            return next
          })
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live capture failed')
    }
  }

  const endSession = async () => {
    if (!sessionId) return
    await supabase.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId)
  }

  useEffect(() => {
    if (!userId || !sessionId) return
    void (async () => {
      await supabase
        .from('sessions')
        .update({ visibility: desiredVisibility, source_lang: sourceLang, target_langs: isTranslateOn ? targetLangs : [] })
        .eq('id', sessionId)
    })()
  }, [desiredVisibility, isTranslateOn, sessionId, sourceLang, targetLangs, userId])

  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`live:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'translations' }, async (payload) => {
        const row = payload.new as TranslationRow
        if (!row?.id || !row.segment_id) return
        const { data: seg } = await supabase
          .from('transcript_segments')
          .select('session_id')
          .eq('id', row.segment_id)
          .maybeSingle()
        if (!seg || seg.session_id !== sessionId) return

        setTranslationsBySegmentId((prev) => {
          const list = prev[row.segment_id] ?? []
          const idx = list.findIndex((x) => x.id === row.id)
          const nextList = idx >= 0 ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row]
          return { ...prev, [row.segment_id]: nextList }
        })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  return {
    sessionId,
    shareUrl,
    error,
    setError,
    segments,
    translationsBySegmentId,
    translatingIds,
    onFinal,
    endSession,
  }
}
