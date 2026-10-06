// Interview simulator domain catalog: settings, personas, panel selection and round plans.
// Panel and round selection are deterministic so they are predictable and explainable to the candidate.

export const EXPERIENCE_LEVELS = ['fresher', 'junior', 'mid', 'senior', 'lead', 'manager', 'director'] as const
export const INTERVIEW_LEVELS = ['basic', 'intermediate', 'advanced', 'expert'] as const
export const INTERVIEW_TYPES = [
  'hr',
  'behavioral',
  'technical',
  'managerial',
  'system_design',
  'case_study',
  'coding',
  'domain',
  'final_round',
  'mixed',
] as const
export const DURATIONS = [10, 20, 30, 45, 60] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'very_hard'] as const
export const STYLES = ['friendly', 'professional', 'challenging', 'aggressive', 'executive'] as const
export const MODES = ['practice', 'simulation', 'stress', 'deep_dive', 'final_round'] as const
export const INTENSITIES = ['normal', 'challenging', 'very_challenging'] as const
export const ROLE_FAMILIES = [
  'software_engineering',
  'data',
  'product',
  'design',
  'management',
  'sales_marketing',
  'banking_finance',
  'operations',
  'hr',
  'other',
] as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]
export type InterviewLevel = (typeof INTERVIEW_LEVELS)[number]
export type InterviewType = (typeof INTERVIEW_TYPES)[number]
export type Difficulty = (typeof DIFFICULTIES)[number]
export type InterviewStyle = (typeof STYLES)[number]
export type InterviewMode = (typeof MODES)[number]
export type Intensity = (typeof INTENSITIES)[number]
export type RoleFamily = (typeof ROLE_FAMILIES)[number]

export type InterviewConfig = {
  target_role: string
  role_family: RoleFamily
  domain: string | null
  experience_level: ExperienceLevel
  years_experience: number | null
  interview_level: InterviewLevel
  interview_type: InterviewType
  duration_min: number
  difficulty: Difficulty
  style: InterviewStyle
  mode: InterviewMode
  intensity: Intensity
  company_name: string | null
  focus_topics: string[]
}

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export const DEFAULT_CONFIG: InterviewConfig = {
  target_role: 'Software Engineer',
  role_family: 'software_engineering',
  domain: null,
  experience_level: 'mid',
  years_experience: null,
  interview_level: 'intermediate',
  interview_type: 'mixed',
  duration_min: 20,
  difficulty: 'medium',
  style: 'professional',
  mode: 'simulation',
  intensity: 'normal',
  company_name: null,
  focus_topics: [],
}

/** Coerces untrusted input (model output or request body) into a valid config. */
export const normalizeConfig = (input: any, fallback: InterviewConfig = DEFAULT_CONFIG): InterviewConfig => {
  const src = input && typeof input === 'object' ? input : {}
  const years = Number(src.years_experience)
  const duration = Number(src.duration_min)
  const nearestDuration = DURATIONS.reduce((best, d) => (Math.abs(d - duration) < Math.abs(best - duration) ? d : best), DURATIONS[1])
  const focus = Array.isArray(src.focus_topics) ? src.focus_topics.map((t: unknown) => cleanText(t, 80)).filter(Boolean).slice(0, 8) : fallback.focus_topics

  return {
    target_role: cleanText(src.target_role, 120) || fallback.target_role,
    role_family: pick(ROLE_FAMILIES, src.role_family, fallback.role_family),
    domain: cleanText(src.domain, 80) || fallback.domain,
    experience_level: pick(EXPERIENCE_LEVELS, src.experience_level, fallback.experience_level),
    years_experience: Number.isFinite(years) && years >= 0 && years <= 50 ? Math.round(years * 10) / 10 : fallback.years_experience,
    interview_level: pick(INTERVIEW_LEVELS, src.interview_level, fallback.interview_level),
    interview_type: pick(INTERVIEW_TYPES, src.interview_type, fallback.interview_type),
    duration_min: Number.isFinite(duration) ? nearestDuration : fallback.duration_min,
    difficulty: pick(DIFFICULTIES, src.difficulty, fallback.difficulty),
    style: pick(STYLES, src.style, fallback.style),
    mode: pick(MODES, src.mode, fallback.mode),
    intensity: pick(INTENSITIES, src.intensity, fallback.intensity),
    company_name: cleanText(src.company_name, 120) || fallback.company_name,
    focus_topics: focus,
  }
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export type PersonaKind = 'hr' | 'technical' | 'hiring_manager' | 'principal' | 'domain'

export type Panelist = {
  id: string
  kind: PersonaKind
  kind_label: string
  name: string
  first_name: string
  title: string
  gender: 'female' | 'male'
  voice: string
  focus: string[]
  is_lead: boolean
}

const KIND_LABEL: Record<PersonaKind, string> = {
  hr: 'HR / Recruiter',
  technical: 'Technical Interviewer',
  hiring_manager: 'Hiring Manager',
  principal: 'Senior Leader',
  domain: 'Domain Expert',
}

export const PERSONA_FOCUS: Record<PersonaKind, string[]> = {
  hr: ['communication', 'motivation', 'career goals', 'strengths and weaknesses', 'culture and team fit', 'salary and notice period'],
  technical: ['technical knowledge', 'architecture', 'coding approach', 'troubleshooting', 'trade-offs', 'edge cases'],
  hiring_manager: ['ownership', 'leadership', 'decision-making', 'conflict management', 'delivery', 'stakeholder management'],
  principal: ['architecture', 'scalability', 'design decisions', 'performance', 'security', 'trade-offs'],
  domain: ['domain knowledge', 'industry practices', 'regulation and compliance', 'business context', 'real-world scenarios'],
}

const TITLES: Record<PersonaKind, Partial<Record<RoleFamily, string>> & { default: string }> = {
  hr: { default: 'HR Manager' },
  technical: {
    software_engineering: 'Senior Software Engineer',
    data: 'Lead Data Scientist',
    product: 'Senior Product Manager',
    design: 'Principal Designer',
    management: 'Engineering Director',
    sales_marketing: 'Sales Director',
    banking_finance: 'Senior Risk Manager',
    operations: 'Operations Lead',
    hr: 'HR Business Partner',
    default: 'Subject Matter Lead',
  },
  hiring_manager: {
    software_engineering: 'Engineering Manager',
    data: 'Analytics Manager',
    product: 'Director of Product',
    design: 'Design Manager',
    management: 'VP Engineering',
    sales_marketing: 'Regional Sales Head',
    banking_finance: 'Business Head',
    operations: 'Operations Manager',
    default: 'Hiring Manager',
  },
  principal: {
    software_engineering: 'Principal Engineer',
    data: 'Principal Data Architect',
    product: 'Group Product Manager',
    design: 'Head of Design',
    management: 'CTO',
    default: 'Principal Consultant',
  },
  domain: { default: 'Domain Expert' },
}

const NAME_POOL: Record<PersonaKind, Array<{ name: string; gender: 'female' | 'male' }>> = {
  hr: [
    { name: 'Priya Sharma', gender: 'female' },
    { name: 'Neha Kapoor', gender: 'female' },
    { name: 'Rohan Desai', gender: 'male' },
  ],
  technical: [
    { name: 'Arjun Mehta', gender: 'male' },
    { name: 'Divya Krishnan', gender: 'female' },
    { name: 'Karthik Iyer', gender: 'male' },
  ],
  hiring_manager: [
    { name: 'Vikram Singh', gender: 'male' },
    { name: 'Sneha Reddy', gender: 'female' },
    { name: 'Aditya Rao', gender: 'male' },
  ],
  principal: [
    { name: 'Meera Nair', gender: 'female' },
    { name: 'David Fernandes', gender: 'male' },
    { name: 'Rahul Verma', gender: 'male' },
  ],
  domain: [
    { name: 'Kavya Menon', gender: 'female' },
    { name: 'Sanjay Gupta', gender: 'male' },
    { name: 'Farah Khan', gender: 'female' },
  ],
}

// Gemini TTS prebuilt voices; each panelist gets a distinct one.
const VOICES: Record<'female' | 'male', string[]> = {
  female: ['Aoede', 'Kore', 'Leda', 'Zephyr'],
  male: ['Puck', 'Charon', 'Orus', 'Fenrir'],
}

const PANEL_BY_TYPE: Record<InterviewType, PersonaKind[]> = {
  hr: ['hr'],
  behavioral: ['hiring_manager', 'hr'],
  technical: ['technical', 'principal'],
  managerial: ['hiring_manager', 'hr'],
  system_design: ['principal', 'technical'],
  case_study: ['hiring_manager', 'domain'],
  coding: ['technical'],
  domain: ['domain', 'technical'],
  final_round: ['hr', 'hiring_manager', 'principal'],
  mixed: ['hr', 'technical', 'hiring_manager'],
}

const hashSeed = (seed: string) => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const selectPanelKinds = (config: InterviewConfig): PersonaKind[] => {
  let kinds = [...PANEL_BY_TYPE[config.interview_type]]
  if (config.mode === 'final_round') kinds = ['hr', 'hiring_manager', 'principal']
  if (config.mode === 'deep_dive' && !kinds.includes('technical') && !kinds.includes('principal')) kinds = ['technical', 'principal']
  if (config.interview_type === 'technical' && (config.experience_level === 'fresher' || config.experience_level === 'junior')) {
    kinds = kinds.map((k) => (k === 'principal' ? 'hiring_manager' : k))
  }
  if ((config.interview_type === 'case_study' || config.interview_type === 'domain') && !config.domain) {
    kinds = kinds.map((k) => (k === 'domain' ? 'principal' : k))
  }
  if (config.mode === 'final_round' && config.domain && config.duration_min >= 45) kinds.push('domain')
  return Array.from(new Set(kinds)).slice(0, 4)
}

export const buildPanel = (config: InterviewConfig, seed: string): Panelist[] => {
  const h = hashSeed(seed)
  const usedVoices = new Set<string>()
  const usedNames = new Set<string>()

  return selectPanelKinds(config).map((kind, idx) => {
    const pool = NAME_POOL[kind]
    let person = pool[(h + idx * 7) % pool.length]
    for (let i = 0; usedNames.has(person.name) && i < pool.length; i++) person = pool[(h + idx * 7 + i + 1) % pool.length]
    usedNames.add(person.name)

    const voicePool = VOICES[person.gender]
    const voice = voicePool.find((v) => !usedVoices.has(v)) ?? voicePool[idx % voicePool.length]
    usedVoices.add(voice)

    const titles = TITLES[kind]
    const title =
      kind === 'domain' && config.domain
        ? `${config.domain} Expert`
        : titles[config.role_family] ?? titles.default

    return {
      id: `p${idx + 1}`,
      kind,
      kind_label: kind === 'principal' && config.role_family === 'software_engineering' ? 'Principal Engineer' : KIND_LABEL[kind],
      name: person.name,
      first_name: person.name.split(' ')[0],
      title,
      gender: person.gender,
      voice,
      focus: PERSONA_FOCUS[kind],
      is_lead: idx === 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Round progression (Easy → Medium → Advanced → Deep dive)
// ---------------------------------------------------------------------------

export type RoundId =
  | 'intro'
  | 'resume'
  | 'motivation'
  | 'fundamentals'
  | 'role'
  | 'scenario'
  | 'deep_dive'
  | 'design'
  | 'behavioral'
  | 'leadership'
  | 'compensation'
  | 'closing'

export type Round = {
  id: RoundId
  label: string
  description: string
  persona_kinds: PersonaKind[]
  base_difficulty: number
  start_sec: number
  end_sec: number
}

const ROUND_INFO: Record<RoundId, Omit<Round, 'id' | 'start_sec' | 'end_sec'>> = {
  intro: { label: 'Introduction', description: 'Opening and "tell me about yourself"', persona_kinds: ['hr', 'hiring_manager', 'technical'], base_difficulty: 1 },
  resume: { label: 'Resume discussion', description: 'Walk through experience; cross-question resume claims', persona_kinds: ['hiring_manager', 'technical', 'principal'], base_difficulty: 2 },
  motivation: { label: 'Motivation & fit', description: 'Why this role, career goals, culture fit', persona_kinds: ['hr', 'hiring_manager'], base_difficulty: 2 },
  fundamentals: { label: 'Fundamentals', description: 'Core concepts for the role', persona_kinds: ['technical', 'domain'], base_difficulty: 2 },
  role: { label: 'Role-specific', description: 'Questions specific to the target role and JD', persona_kinds: ['technical', 'domain', 'principal'], base_difficulty: 3 },
  scenario: { label: 'Scenario', description: 'Realistic situations and how the candidate would handle them', persona_kinds: ['principal', 'hiring_manager', 'domain'], base_difficulty: 3 },
  deep_dive: { label: 'Deep dive', description: 'Probe one area in depth: trade-offs, failures, measurement', persona_kinds: ['principal', 'technical'], base_difficulty: 4 },
  design: { label: 'System design', description: 'Design a system; requirements, architecture, scaling, trade-offs', persona_kinds: ['principal', 'technical'], base_difficulty: 4 },
  behavioral: { label: 'Behavioral', description: 'Past situations: conflict, failure, teamwork, pressure', persona_kinds: ['hiring_manager', 'hr'], base_difficulty: 3 },
  leadership: { label: 'Leadership & ownership', description: 'Ownership, decisions, stakeholders, delivery', persona_kinds: ['hiring_manager', 'principal'], base_difficulty: 3 },
  compensation: { label: 'Expectations', description: 'Notice period, compensation expectations, logistics', persona_kinds: ['hr'], base_difficulty: 2 },
  closing: { label: 'Closing', description: 'Candidate questions for the panel and wrap-up', persona_kinds: ['hr', 'hiring_manager'], base_difficulty: 1 },
}

const PLAN_BY_TYPE: Record<InterviewType, Array<[RoundId, number]>> = {
  technical: [['intro', 1], ['resume', 2], ['fundamentals', 2], ['role', 3], ['scenario', 2], ['deep_dive', 3], ['behavioral', 1], ['closing', 1]],
  coding: [['intro', 1], ['resume', 1], ['fundamentals', 3], ['role', 3], ['deep_dive', 3], ['closing', 1]],
  domain: [['intro', 1], ['resume', 2], ['fundamentals', 2], ['role', 3], ['scenario', 3], ['deep_dive', 2], ['closing', 1]],
  system_design: [['intro', 1], ['resume', 2], ['design', 5], ['deep_dive', 3], ['closing', 1]],
  hr: [['intro', 1], ['motivation', 2], ['resume', 2], ['behavioral', 3], ['compensation', 2], ['closing', 1]],
  behavioral: [['intro', 1], ['resume', 2], ['behavioral', 4], ['leadership', 2], ['closing', 1]],
  managerial: [['intro', 1], ['resume', 2], ['leadership', 3], ['scenario', 2], ['behavioral', 2], ['closing', 1]],
  case_study: [['intro', 1], ['resume', 1], ['scenario', 5], ['deep_dive', 2], ['closing', 1]],
  final_round: [['intro', 1], ['resume', 2], ['role', 2], ['deep_dive', 2], ['leadership', 2], ['motivation', 1], ['compensation', 1], ['closing', 1]],
  mixed: [['intro', 1], ['resume', 2], ['role', 2], ['scenario', 2], ['behavioral', 2], ['motivation', 1], ['closing', 1]],
}

/** Seconds reserved at the end for "do you have any questions for us?". */
export const CLOSING_SECONDS = 90

export const buildRoundPlan = (config: InterviewConfig): Round[] => {
  let plan = [...PLAN_BY_TYPE[config.mode === 'final_round' ? 'final_round' : config.interview_type]]
  if (config.mode === 'deep_dive') plan = plan.map(([id, w]) => [id, id === 'deep_dive' ? w + 2 : id === 'behavioral' || id === 'motivation' ? 1 : w] as [RoundId, number])

  // Short interviews keep the opening, the closing and the heaviest middle rounds (in order).
  const maxRounds = Math.max(3, Math.min(plan.length, Math.floor(config.duration_min / 3.5) + 1))
  if (plan.length > maxRounds) {
    const middle = plan.slice(1, -1)
    const keep = new Set(
      middle
        .map((r, i) => ({ r, i }))
        .sort((a, b) => b.r[1] - a.r[1] || a.i - b.i)
        .slice(0, maxRounds - 2)
        .map((x) => x.r[0]),
    )
    plan = [plan[0], ...middle.filter(([id]) => keep.has(id)), plan[plan.length - 1]]
  }

  const totalSec = config.duration_min * 60
  const mainSec = totalSec - CLOSING_SECONDS
  const weights = plan.slice(0, -1).reduce((sum, [, w]) => sum + w, 0)
  let cursor = 0
  return plan.map(([id, w], idx) => {
    const isClosing = idx === plan.length - 1
    const span = isClosing ? CLOSING_SECONDS : Math.round((mainSec * w) / weights)
    const start = cursor
    const end = isClosing ? totalSec : idx === plan.length - 2 ? mainSec : start + span
    cursor = end
    return { id, ...ROUND_INFO[id], start_sec: start, end_sec: end }
  })
}

export const roundIndexAt = (plan: Round[], elapsedSec: number) => {
  const idx = plan.findIndex((r) => elapsedSec < r.end_sec)
  return idx === -1 ? plan.length - 1 : idx
}

export const DIFFICULTY_BASELINE: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3, very_hard: 4 }

export const LABELS = {
  experience_level: { fresher: 'Fresher', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead', manager: 'Manager', director: 'Director' },
  interview_type: {
    hr: 'HR',
    behavioral: 'Behavioral',
    technical: 'Technical',
    managerial: 'Managerial',
    system_design: 'System design',
    case_study: 'Case study',
    coding: 'Coding',
    domain: 'Domain-specific',
    final_round: 'Final round',
    mixed: 'Mixed panel',
  },
} as const
