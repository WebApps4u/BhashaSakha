import type { PersonaKind } from './types'

export type Option = { value: string; label: string }

const opts = (pairs: Array<[string, string]>): Option[] => pairs.map(([value, label]) => ({ value, label }))

export const EXPERIENCE_OPTIONS = opts([
  ['fresher', 'Fresher'],
  ['junior', 'Junior'],
  ['mid', 'Mid-level'],
  ['senior', 'Senior'],
  ['lead', 'Lead'],
  ['manager', 'Manager'],
  ['director', 'Director'],
])

export const LEVEL_OPTIONS = opts([
  ['basic', 'Basic'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
  ['expert', 'Expert'],
])

export const TYPE_OPTIONS = opts([
  ['mixed', 'Mixed panel'],
  ['technical', 'Technical'],
  ['behavioral', 'Behavioral'],
  ['hr', 'HR'],
  ['managerial', 'Managerial'],
  ['system_design', 'System design'],
  ['case_study', 'Case study'],
  ['coding', 'Coding (verbal)'],
  ['domain', 'Domain-specific'],
  ['final_round', 'Final round'],
])

export const DURATION_OPTIONS = opts([
  ['10', '10 min'],
  ['20', '20 min'],
  ['30', '30 min'],
  ['45', '45 min'],
  ['60', '60 min'],
])

export const DIFFICULTY_OPTIONS = opts([
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
  ['very_hard', 'Very hard'],
])

export const STYLE_OPTIONS = opts([
  ['friendly', 'Friendly'],
  ['professional', 'Professional'],
  ['challenging', 'Challenging'],
  ['aggressive', 'Cross-questioning'],
  ['executive', 'Executive'],
])

export const MODE_OPTIONS: Array<Option & { hint: string }> = [
  { value: 'simulation', label: 'Simulation', hint: 'Behaves like a real interview. Feedback only at the end.' },
  { value: 'practice', label: 'Practice', hint: 'Helpful panel with a quick coaching tip after each answer.' },
  { value: 'stress', label: 'Stress interview', hint: 'Challenging follow-ups, interruptions, pressure-tested answers.' },
  { value: 'deep_dive', label: 'Technical deep dive', hint: 'Digs several levels deep into architecture and problem solving.' },
  { value: 'final_round', label: 'Final round', hint: 'Mixed HR, technical and managerial panel at a senior bar.' },
]

export const INTENSITY_OPTIONS = opts([
  ['normal', 'Normal'],
  ['challenging', 'Challenging'],
  ['very_challenging', 'Very challenging'],
])

export const labelOf = (options: Option[], value: string | number | null | undefined) =>
  options.find((o) => o.value === String(value ?? ''))?.label ?? String(value ?? '—')

export const PERSONA_ACCENT: Record<PersonaKind, { ring: string; avatar: string; chip: string }> = {
  hr: { ring: 'ring-rose-400', avatar: 'bg-rose-500/20 text-rose-100', chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-200' },
  technical: { ring: 'ring-sky-400', avatar: 'bg-sky-500/20 text-sky-100', chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-200' },
  hiring_manager: { ring: 'ring-amber-400', avatar: 'bg-amber-500/20 text-amber-100', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-200' },
  principal: { ring: 'ring-violet-400', avatar: 'bg-violet-500/20 text-violet-100', chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-200' },
  domain: { ring: 'ring-emerald-400', avatar: 'bg-emerald-500/20 text-emerald-100', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200' },
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

export const formatClock = (totalSec: number) => {
  const s = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const MISTAKE_LABELS: Record<string, string> = {
  rambling: 'Rambling',
  off_question: 'Did not answer the question',
  generic: 'Generic answer',
  no_example: 'No concrete example',
  no_metrics: 'No measurable result',
  weak_technical: 'Weak technical explanation',
  resume_contradiction: 'Contradicts resume',
  overclaiming: 'Overclaiming',
  no_clarifying_question: 'No clarifying question',
  missing_business_impact: 'Missing business impact',
  poor_structure: 'Poor structure',
  filler_words: 'Filler words',
  long_pause: 'Long pause',
  repetition: 'Repetition',
}
