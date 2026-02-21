import { msToVttTimestamp } from '@/utils/time'

export type Segment = {
  id: string
  seq: number
  speaker_label: string
  start_ms: number
  end_ms: number
  text: string
}

export function buildTxt(segments: Segment[]) {
  return segments
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((s) => `[${s.speaker_label}] ${s.text}`)
    .join('\n')
}

export function buildVtt(segments: Segment[]) {
  const lines: string[] = ['WEBVTT', '']

  const sorted = segments.slice().sort((a, b) => a.seq - b.seq)
  for (const seg of sorted) {
    const start = msToVttTimestamp(seg.start_ms)
    const end = msToVttTimestamp(seg.end_ms)
    lines.push(`${start} --> ${end}`)
    lines.push(`${seg.speaker_label}: ${seg.text}`)
    lines.push('')
  }

  return lines.join('\n')
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

