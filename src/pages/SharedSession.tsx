import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import LiveCanvas from '@/components/live/LiveCanvas'

type SessionRow = {
  id: string
  title: string
  source_lang: string
  target_langs: string[]
  visibility: 'private' | 'public'
}

type SegmentRow = {
  id: string
  session_id: string
  seq: number
  speaker_label: string
  detected_lang?: string | null
  text: string
  is_edited: boolean
}

type TranslationRow = {
  id: string
  segment_id: string
  target_lang: string
  text: string
}

export default function SharedSession() {
  const params = useParams()
  const sessionId = params.shareId

  const [session, setSession] = useState<SessionRow | null>(null)
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [translationsBySegmentId, setTranslationsBySegmentId] = useState<Record<string, TranslationRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canView = useMemo(() => !!session && session.visibility === 'public', [session])

  useEffect(() => {
    if (!sessionId) return
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)
      const { data: s, error: sErr } = await supabase
        .from('sessions')
        .select('id,title,source_lang,target_langs,visibility')
        .eq('id', sessionId)
        .maybeSingle()
      if (!mounted) return
      if (sErr) {
        setError(sErr.message)
        setLoading(false)
        return
      }
      if (!s || s.visibility !== 'public') {
        setSession(null)
        setLoading(false)
        return
      }
      setSession(s as SessionRow)

      const { data: segData, error: segErr } = await supabase
        .from('transcript_segments')
        .select('id,seq,speaker_label,detected_lang,text,is_edited')
        .eq('session_id', sessionId)
        .order('seq', { ascending: true })
      if (!mounted) return
      if (segErr) {
        setError(segErr.message)
      } else {
        const list = (segData ?? []) as SegmentRow[]
        setSegments(list)

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
      .channel(`shared:${sessionId}`)
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
      .channel(`shared-translations:${sessionId}`)
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
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  if (loading) {
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/10" />
  }

  if (!canView) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h1 className="text-lg font-semibold">Shared session</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">This session is not public, or it does not exist.</p>
        <div className="mt-4">
          <Link to="/live" className="text-sm font-medium text-slate-900 underline dark:text-slate-50">
            Go to Live
          </Link>
        </div>
      </div>
    )
  }

  const primaryTarget = session.target_langs?.[0] ?? ''
  const showRight = !!primaryTarget
  const leftLines = segments.map((s) => ({ id: s.id, text: s.text }))
  const rightLines = segments.map((s) => {
    const rows = translationsBySegmentId[s.id] ?? []
    const preferred = primaryTarget ? rows.find((r) => r.target_lang === primaryTarget) : null
    const fallback = rows[0]
    return { id: s.id, text: preferred?.text ?? fallback?.text ?? '' }
  })

  return (
    <div className="relative min-h-[calc(100vh-57px)] bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-300">Public live view</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{session.title || 'Untitled session'}</h1>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Captions and translations update in real-time.</div>
          </div>
          <div className="text-right">
            <Link to="/live" className="text-sm font-medium text-slate-900 underline dark:text-slate-50">
              Start your own
            </Link>
            {error ? <div className="mt-2 max-w-xs text-xs text-rose-700 dark:text-rose-200">{error}</div> : null}
          </div>
        </div>
      </div>

      <LiveCanvas
        showRight={showRight}
        leftLines={leftLines}
        interim=""
        rightLines={rightLines}
        translatingIds={{}}
        footerLeft="Viewer mode"
        languageChip={showRight ? `${session.source_lang} ⇄ ${primaryTarget}` : session.source_lang}
        ttsEnabled={false}
      />
    </div>
  )
}
