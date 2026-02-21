export function msToVttTimestamp(totalMs: number) {
  const ms = Math.max(0, Math.floor(totalMs))

  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1_000)
  const millis = ms % 1_000

  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const mmm = String(millis).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${mmm}`
}

