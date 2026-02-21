export default function LevelBar({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(1, level))
  return (
    <div className="h-2 w-28 overflow-hidden rounded-full bg-white/10">
      <div className="h-full bg-[#60A5FA]" style={{ width: `${Math.round(pct * 100)}%` }} />
    </div>
  )
}

