import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'

export type SegmentRow = {
  id: string
  seq: number
  speaker_label: string
  text: string
  session_id: string
  is_edited: boolean
  start_ms: number
  end_ms: number
  created_at: string
  updated_at: string
}

export default function EditorPanel({
  sessionId,
  isOwner,
  segments,
  onSegmentUpdated,
}: {
  sessionId: string
  isOwner: boolean
  segments: SegmentRow[]
  onSegmentUpdated: (seg: SegmentRow) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Post-session editor</h2>
          <p className="mt-1 text-sm text-white/70">Edit transcript text and save back to Supabase.</p>
        </div>
        <Link
          to={`/s/${sessionId}`}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 transition hover:bg-white/10"
        >
          Open shared view
        </Link>
      </div>

      {error ? <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="mt-4 space-y-3">
        {segments.map((seg) => {
          const draft = drafts[seg.id] ?? seg.text
          return (
            <div key={seg.id} className="rounded-lg border border-white/10 bg-[#0F172A] p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/60">
                  #{seg.seq} • {seg.speaker_label}
                </div>
                <button
                  type="button"
                  disabled={!isOwner || busyId === seg.id}
                  onClick={async () => {
                    if (!isOwner) return
                    setBusyId(seg.id)
                    setError(null)
                    try {
                      const { data, error: err } = await supabase
                        .from('transcript_segments')
                        .update({ text: draft, is_edited: true })
                        .eq('id', seg.id)
                        .select('id,seq,speaker_label,start_ms,end_ms,text,session_id,is_edited,created_at,updated_at')
                        .single()
                      if (err) throw err
                      onSegmentUpdated(data as SegmentRow)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to save')
                    } finally {
                      setBusyId(null)
                    }
                  }}
                  className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/90 transition hover:bg-white/15 disabled:opacity-50"
                >
                  {busyId === seg.id ? 'Saving…' : 'Save'}
                </button>
              </div>
              <textarea
                className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#111C33] px-3 py-2 text-sm text-white/90 outline-none focus:border-[#60A5FA]"
                rows={2}
                value={draft}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [seg.id]: e.target.value }))}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

