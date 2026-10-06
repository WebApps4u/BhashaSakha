// Client-side shapes of the /api/interview payloads (see server/routes/interview.ts).

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

export type Round = {
  id: string
  label: string
  description: string
  persona_kinds: PersonaKind[]
  base_difficulty: number
  start_sec: number
  end_sec: number
}

export type InterviewConfig = {
  target_role: string
  role_family: string
  domain: string | null
  experience_level: string
  years_experience: number | null
  interview_level: string
  interview_type: string
  duration_min: number
  difficulty: string
  style: string
  mode: string
  intensity: string
  company_name: string | null
  focus_topics: string[]
}

export type ResumeClaim = { id: string; claim: string; source_quote: string; topic: string; priority: number }

export type ProfileAnalysis = {
  candidate?: {
    name?: string | null
    current_role?: string | null
    current_company?: string | null
    years_experience?: number | null
    seniority?: string
    previous_roles?: Array<{ title: string; company: string | null; period: string | null }>
    education?: string[]
    certifications?: string[]
  }
  skills?: { technical?: string[]; tools?: string[]; domains?: string[]; soft?: string[] }
  projects?: Array<{ name: string; summary: string; technologies: string[]; impact: string | null }>
  achievements?: string[]
  jd?: { title: string | null; company: string | null; summary: string; required_skills: string[]; nice_to_have: string[]; responsibilities: string[] } | null
  match?: { matching_skills?: string[]; missing_skills?: string[]; partial_skills?: string[]; match_score?: number | null }
  weak_areas?: string[]
  career_gaps?: Array<{ period: string; note: string }>
  deep_dive_areas?: string[]
  resume_claims?: ResumeClaim[]
  focus_areas?: string[]
  likely_topics?: string[]
  recommended_config?: InterviewConfig
  recommendation_reasons?: Record<string, string>
  summary?: string
}

export type InterviewProfile = {
  id: string
  target_title: string | null
  company_name: string | null
  analysis_json: ProfileAnalysis
  created_at: string
}

export type AnswerMetrics = {
  word_count: number
  duration_ms: number | null
  wpm: number | null
  filler_count: number
  fillers: Record<string, number>
  filler_per_100: number
  repetition_ratio: number
  latency_ms: number | null
  longest_pause_ms: number | null
  interrupted: boolean
}

export type Turn = {
  id: string
  seq: number
  speaker: 'interviewer' | 'candidate'
  persona_id: string | null
  action: string | null
  round: string | null
  difficulty: number | null
  thread_id: string | null
  resume_claim_ref: string | null
  text: string
  rationale: string | null
  practice_tip: string | null
  input_mode: string | null
  metrics_json: AnswerMetrics | null
  created_at: string
}

export type Progress = {
  elapsed_sec: number
  duration_sec: number
  round_index: number
  round_count: number
  round_id: string
  round_label: string
  question_number: number
}

export type Evidence = { turn: string; quote: string }

export type Mistake = {
  type: string
  what_happened: string
  evidence: Evidence[]
  why_it_matters: string
  how_to_improve: string
  measured?: boolean
}

export type QuestionFeedback = {
  thread_id: string
  q_number: number
  question: string
  question_ref: string
  answer_refs: string[]
  persona_id: string | null
  round: string | null
  category: string
  verdict: 'strong' | 'adequate' | 'weak'
  did_well: Array<{ point: string; evidence: Evidence[] }>
  missing: string[]
  mistakes: Mistake[]
  better_approach: string[]
  framework: string
  star: { situation: boolean; task: boolean; action: boolean; result: boolean } | null
  stronger_answer: string
  why_stronger: string[]
  scores: Record<string, number>
  unverified_findings_dropped: number
}

export type Area = { area: string; detail: string; questions: string[] }

export type Report = {
  overall_summary: string
  strong_areas: Area[]
  weak_areas: Area[]
  critical_areas: Area[]
  biggest_risk: string
  communication_analysis: string
  action_plan: Array<{ title: string; why: string; how: string; practice_type: string }>
  recommended_topics: string[]
  questions_evaluated: number
  generated_at: string
}

export type Scorecard = {
  dimensions: Record<string, number>
  categories: Partial<Record<'technical' | 'communication' | 'behavioral' | 'role_alignment' | 'delivery', number>>
  delivery_score: number | null
  readiness: number | null
  low_confidence: boolean
}

export type SessionStatus = 'ready' | 'live' | 'evaluating' | 'completed' | 'abandoned'

export type InterviewSession = {
  id: string
  title: string
  status: SessionStatus
  config: InterviewConfig
  recommended_config: InterviewConfig | null
  panel: Panelist[]
  round_plan: Round[]
  started_at: string | null
  ended_at: string | null
  readiness: number | null
  scores: Scorecard | null
  report: Report | null
  profile_id: string | null
  parent_session_id: string | null
  created_at: string
  is_final: boolean
}

export type SessionListItem = {
  id: string
  title: string
  status: SessionStatus
  config: InterviewConfig
  readiness: number | null
  categories: Scorecard['categories'] | null
  profile_id: string | null
  parent_session_id: string | null
  created_at: string
  started_at: string | null
  ended_at: string | null
}
