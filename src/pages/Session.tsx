import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/store/authStore'
import EditorPanel from '@/components/session/EditorPanel'
import { buildTxt, buildVtt, downloadTextFile, type Segment } from '@/utils/exporters'
import { useSpeechCaptions } from '@/hooks/useSpeechCaptions'
import LiveTab from '@/components/session/LiveTab'
import SessionHeader from '@/components/session/SessionHeader'
import { useSettingsStore } from '@/store/settingsStore'
import { playServerTts } from '@/utils/tts'

type SessionRow = {
  id: string
  owner_id: string
  title: string
  source_lang: string
  target_langs: string[]
  visibility: 'private' | 'public'
}

type SegmentRow = Segment & {
  session_id: string
  is_edited: boolean
  detected_lang?: string | null
  created_at: string
  updated_at: string
}

type TranslationRow = {
  id: string
  segment_id: string
  target_lang: string
  text: string
}

export default function Session() {
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionId = params.sessionId
  const tab = (searchParams.get('tab') ?? 'live') as 'live' | 'edit'

  const { user, isReady } = useAuthStore()

  const [session, setSession] = useState<SessionRow | null>(null)
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [translationsBySegmentId, setTranslationsBySegmentId] = useState<Record<string, TranslationRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [exportBusy, setExportBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)

  const [speakerLabel, setSpeakerLabel] = useState('Speaker 1')
  const [targetLangs, setTargetLangs] = useState<string[]>([])
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [ttsLang, setTtsLang] = useState('')
  const [translatingSegmentIds, setTranslatingSegmentIds] = useState<Record<string, true>>({})

  const ttsGender = useSettingsStore((s) => s.ttsGender)
  const ttsRate = useSettingsStore((s) => s.ttsRate)
  const ttsPitch = useSettingsStore((s) => s.ttsPitch)
  const ttsVolume = useSettingsStore((s) => s.ttsVolume)

  const isOwner = useMemo(() => !!user && !!session && user.id === session.owner_id, [session, user])
  const shareUrl = useMemo(() => (session ? `${window.location.origin}/s/${session.id}` : ''), [session])

  const nextSeqRef = useRef<number>(1)

  useEffect(() => {
    if (!isReady) return
    if (!user) navigate('/auth')
  }, [isReady, navigate, user])

  useEffect(() => {
    if (!sessionId) return
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      const { data: sessionData, error: sessionErr } = await supabase
        .from('sessions')
        .select('id,owner_id,title,visibility,source_lang,target_langs')
        .eq('id', sessionId)
        .single()
      if (!mounted) return
      if (sessionErr) {
        setError(sessionErr.message)
        setLoading(false)
        return
      }
      const s = sessionData as SessionRow
      setSession(s)
      setTargetLangs(Array.isArray(s.target_langs) ? s.target_langs : [])
      setTtsLang(Array.isArray(s.target_langs) && s.target_langs.length ? s.target_langs[0] : '')

      const { data: segData, error: segErr } = await supabase
        .from('transcript_segments')
        .select('id,seq,speaker_label,detected_lang,start_ms,end_ms,text,session_id,is_edited,created_at,updated_at')
        .eq('session_id', sessionId)
        .order('seq', { ascending: true })
      if (!mounted) return
      if (segErr) {
        setError(segErr.message)
      } else {
        const list = (segData ?? []) as SegmentRow[]
        setSegments(list)
        nextSeqRef.current = list.reduce((m, s) => Math.max(m, s.seq), 0) + 1

        const ids = list.map((x) => x.id)
        if (ids.length) {
          const { data: tData } = await supabase
            .from('translations')
            .select('id,segment_id,target_lang,text')
            .in('segment_id', ids)
          const map: Record<string, TranslationRow[]> = {}
          for (const row of (tData ?? []) as TranslationRow[]) {
            map[row.segment_id] = map[row.segment_id] ? [...map[row.segment_id], row] : [row]
          }
          setTranslationsBySegmentId(map)
        }
      }
      setLoading(false)
    }

    void load()
    return () => {
      mounted = false
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`segments:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transcript_segments', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as SegmentRow
          if (!row?.id) return
          setSegments((prev) => {
            const idx = prev.findIndex((p) => p.id === row.id)
            if (idx >= 0) {
              const next = prev.slice()
              next[idx] = row
              return next.sort((a, b) => a.seq - b.seq)
            }
            return [...prev, row].sort((a, b) => a.seq - b.seq)
          })

          if (payload.eventType === 'INSERT') {
            void (async () => {
              const { data: tData } = await supabase
                .from('translations')
                .select('id,segment_id,target_lang,text')
                .eq('segment_id', row.id)
              const rows = (tData ?? []) as TranslationRow[]
              if (!rows.length) return
              setTranslationsBySegmentId((prev) => ({ ...prev, [row.id]: rows }))
            })()
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`translations:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'translations' },
        async (payload) => {
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
          setTranslatingSegmentIds((prev) => {
            const next = { ...prev }
            delete next[row.segment_id]
            return next
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  const speech = useSpeechCaptions({
    enabled: isOwner,
    onFinal: async ({ text, startMs, endMs }) => {
      if (!sessionId) return
      const seq = nextSeqRef.current++

      const optimistic: SegmentRow = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        seq,
        speaker_label: speakerLabel,
        start_ms: startMs,
        end_ms: endMs,
        text,
        is_edited: false,
        detected_lang: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setSegments((prev) => [...prev, optimistic].sort((a, b) => a.seq - b.seq))

      const { data, error: insertErr } = await supabase
        .from('transcript_segments')
        .insert({
          session_id: sessionId,
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

      if (insertErr) {
        setError(insertErr.message)
        setSegments((prev) => prev.filter((s) => s.id !== optimistic.id))
        return
      }

      setSegments((prev) => prev.map((s) => (s.id === optimistic.id ? { ...s, id: data.id } : s)))

      if (!targetLangs.length) return

      setTranslatingSegmentIds((prev) => ({ ...prev, [data.id]: true }))

      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token ?? ''
        const resp = await fetch('/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ text, targets: targetLangs }),
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
          setError((json.error ?? 'Translation failed') + tried + details)
          return
        }

        const detected = json.detected_language ?? 'und'
        await supabase.from('transcript_segments').update({ detected_lang: detected }).eq('id', data.id)

        const translationRows = Object.entries(json.translations ?? {}).map(([lang, translatedText]) => ({
          segment_id: data.id,
          target_lang: lang,
          text: translatedText,
        }))

        if (translationRows.length) {
          const { data: upserted, error: upsertErr } = await supabase
            .from('translations')
            .upsert(translationRows, { onConflict: 'segment_id,target_lang' })
            .select('id,segment_id,target_lang,text')
          if (upsertErr) throw upsertErr
          const rows = (upserted ?? []) as TranslationRow[]
          setTranslationsBySegmentId((prev) => ({ ...prev, [data.id]: rows }))
            setTranslatingSegmentIds((prev) => {
              const next = { ...prev }
              delete next[data.id]
              return next
            })

          if (ttsEnabled && ttsLang) {
            const speakText = rows.find((r) => r.target_lang === ttsLang)?.text
            if (speakText) {
              await playServerTts({ text: speakText, lang: ttsLang, gender: ttsGender, rate: ttsRate, pitch: ttsPitch, volume: ttsVolume })
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Translation failed')
        setTranslatingSegmentIds((prev) => {
          const next = { ...prev }
          delete next[data.id]
          return next
        })
      }
    },
  })

  useEffect(() => {
    if (speech.error) setError(speech.error)
  }, [speech.error])

  useEffect(() => {
    if (!isOwner || !sessionId) return
    if (!session) return
    if (targetLangs.join(',') === (session.target_langs ?? []).join(',')) return

    void (async () => {
      const { error: updateErr } = await supabase.from('sessions').update({ target_langs: targetLangs }).eq('id', sessionId)
      if (updateErr) setError(updateErr.message)
      setSession((s) => (s ? { ...s, target_langs: targetLangs } : s))
    })()
  }, [isOwner, session, sessionId, targetLangs])

  const enableShare = async () => {
    if (!isOwner) return
    setShareBusy(true)
    setError(null)
    try {
      const { error: updateErr } = await supabase.from('sessions').update({ visibility: 'public' }).eq('id', sessionId)
      if (updateErr) throw updateErr
      setSession((s) => (s ? { ...s, visibility: 'public' } : s))
      await navigator.clipboard.writeText(shareUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable sharing')
    } finally {
      setShareBusy(false)
    }
  }

  const uploadLatestVtt = async () => {
    if (!user || !isOwner) return
    setExportBusy(true)
    setError(null)
    try {
      const exportId = crypto.randomUUID()
      const content = buildVtt(segments)
      const path = `user/${user.id}/session/${sessionId}/exports/${exportId}.vtt`
      const { error: uploadErr } = await supabase
        .storage
        .from('session-exports')
        .upload(path, new Blob([content], { type: 'text/vtt' }), { upsert: true })
      if (uploadErr) throw uploadErr
      const { error: insertErr } = await supabase.from('exports').insert({
        session_id: sessionId,
        requested_by: user.id,
        format: 'vtt',
        status: 'completed',
        storage_path: path,
        completed_at: new Date().toISOString(),
      })
      if (insertErr) throw insertErr
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload export')
    } finally {
      setExportBusy(false)
    }
  }

  if (loading) {
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/10" />
  }

  if (!sessionId || !session) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="text-sm text-slate-600 dark:text-slate-300">Session not found.</div>
        <div className="mt-3">
          <Link className="text-sm font-medium text-slate-900 underline dark:text-slate-50" to="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SessionHeader
        title={session.title || 'Untitled session'}
        visibility={session.visibility}
        tab={tab}
        canEdit={isOwner}
        supportsSpeech={speech.isSupported}
        onTab={(nextTab) => setSearchParams({ tab: nextTab })}
      />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          {error}
        </div>
      ) : null}

      {tab === 'live' ? (
        <LiveTab
          isOwner={isOwner}
          status={speech.status}
          micLevel={speech.micLevel}
          interim={speech.interim}
          segments={segments.map((s) => ({ id: s.id, seq: s.seq, speaker_label: s.speaker_label, detected_lang: s.detected_lang, text: s.text, is_edited: s.is_edited }))}
          translationsBySegmentId={translationsBySegmentId}
          speakerLabel={speakerLabel}
          onSpeakerLabel={setSpeakerLabel}
          targetLangs={targetLangs}
          onTargetLangs={setTargetLangs}
          ttsEnabled={ttsEnabled}
          onTtsEnabled={setTtsEnabled}
          ttsLang={ttsLang}
          onTtsLang={setTtsLang}
          isTranslating={Object.keys(translatingSegmentIds).length > 0}
          shareEnabled={session.visibility === 'public'}
          shareUrl={shareUrl}
          shareBusy={shareBusy}
          exportBusy={exportBusy}
          onStart={() => void speech.start()}
          onPause={speech.pause}
          onResume={() => void speech.resume()}
          onStop={() => {
            void (async () => {
              speech.stop()
              if (isOwner) {
                await supabase.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId)
              }
            })()
          }}
          onEnableShare={() => void enableShare()}
          onCopyShare={() => void navigator.clipboard.writeText(shareUrl)}
          onExportTxt={() => downloadTextFile(`session-${sessionId}.txt`, buildTxt(segments), 'text/plain')}
          onExportVtt={() => downloadTextFile(`session-${sessionId}.vtt`, buildVtt(segments), 'text/vtt')}
          onUploadVtt={() => void uploadLatestVtt()}
        />
      ) : (
        <EditorPanel
          sessionId={sessionId}
          isOwner={isOwner}
          segments={segments}
          onSegmentUpdated={(seg) => setSegments((prev) => prev.map((p) => (p.id === seg.id ? seg : p)))}
        />
      )}
    </div>
  )
}
