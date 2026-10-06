import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import multer from 'multer'
import { runModelRequest } from '../lib/aiModelLayer.js'
import {
  DIFFICULTY_BASELINE,
  buildPanel,
  buildRoundPlan,
  normalizeConfig,
  roundIndexAt,
  type InterviewConfig,
  type Panelist,
  type Round,
} from '../lib/interview/catalog.js'
import { extractTextFromFile, fetchJobPosting, MAX_EXTRACTED_CHARS } from '../lib/interview/extract.js'
import {
  computeAnswerMetrics,
  computeScorecard,
  guardBorrowedMetrics,
  measuredMistakes,
  normalizeScores,
  quoteOccursIn,
  verifyEvidence,
  type AnswerMetrics,
  CATEGORY_LABELS,
} from '../lib/interview/metrics.js'
import {
  DIRECTOR_ACTIONS,
  MISTAKE_TYPES,
  buildAnalysisPrompt,
  buildDirectorPrompt,
  buildEvaluationPrompt,
  buildSummaryPrompt,
} from '../lib/interview/prompts.js'

const router = Router()

// Thinking budgets keep each AI call well inside the gateway's 35 s timeout.
const ANALYSIS_THINKING_BUDGET = 1024
const EVALUATION_THINKING_BUDGET = 1024
/** A rejoin after this much inactivity pauses the clock for the time away (minus a short grace). */
const REJOIN_IDLE_PAUSE_MS = 90_000
const REJOIN_GRACE_MS = 15_000

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } })

const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const parseBearer = (req: Request) => {
  const auth = req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
}

const adminClient = () => {
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey()
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL')
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

const verifyUser = async (req: Request) => {
  const token = parseBearer(req)
  if (!token) return { ok: false as const, status: 401, error: 'Unauthorized' }
  const SUPABASE_URL = getSupabaseUrl()
  const SUPABASE_ANON_KEY = getSupabaseAnonKey()
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false as const, status: 500, error: 'Server is missing Supabase configuration' }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return { ok: false as const, status: 401, error: 'Unauthorized' }
  return { ok: true as const, userId: data.user.id, token }
}

const jsonError = (res: Response, status: number, error: string, extra?: Record<string, unknown>) => {
  res.status(status).json({ success: false, error, ...(extra ?? {}) })
}

const sendModelError = (res: Response, err: unknown, context: string) => {
  const msg = err instanceof Error ? err.message : 'model_request_failed'
  if (msg === 'quota_exceeded') return jsonError(res, 429, "You've reached this month's interview AI limit for your plan.", { code: 'quota_exceeded' })
  if (msg === 'model_not_allowed') return jsonError(res, 403, 'Interview practice is not enabled for your plan.', { code: 'model_not_allowed' })
  console.error(`[interview] ${context} failed:`, msg, (err as any)?.details ?? '')
  // The AI provider's own rate/usage limit (not the user's plan quota).
  if (msg === 'provider_http_429') return jsonError(res, 503, 'The AI service has reached its usage limit for now. Please try again later.', { code: 'provider_capacity' })
  return jsonError(res, 502, 'The AI service is temporarily unavailable. Please try again.', { code: 'model_unavailable' })
}

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const cleanUrl = (value: unknown) => {
  const v = cleanText(value, 500)
  return /^https?:\/\//i.test(v) ? v : ''
}
const asArray = (value: unknown) => (Array.isArray(value) ? value : [])
const strings = (value: unknown, max = 12, len = 300) =>
  asArray(value)
    .map((v) => (typeof v === 'string' ? v.trim().slice(0, len) : ''))
    .filter(Boolean)
    .slice(0, max)

type Db = ReturnType<typeof adminClient>

type TurnRow = {
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

type SessionState = {
  thread_seq?: number
  notes?: string[]
  probed_claims?: string[]
  closing_asked?: boolean
  final?: boolean
  last_difficulty?: number
}

const loadOwnedSession = async (supabase: Db, sessionId: string, userId: string) => {
  const { data, error } = await supabase.from('interview_sessions').select('*').eq('id', sessionId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || (data as any).owner_id !== userId) return null
  return data as any
}

const loadTurns = async (supabase: Db, sessionId: string) => {
  const { data, error } = await supabase.from('interview_turns').select('*').eq('session_id', sessionId).order('seq', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as TurnRow[]
}

const loadProfile = async (supabase: Db, profileId: string | null, userId: string) => {
  if (!profileId) return null
  const { data } = await supabase.from('interview_profiles').select('*').eq('id', profileId).maybeSingle()
  if (!data || (data as any).owner_id !== userId) return null
  return data as any
}

// ---------------------------------------------------------------------------
// Profile text helpers
// ---------------------------------------------------------------------------

const profileSummary = (analysis: any) => {
  if (!analysis) return 'No resume provided.'
  const c = analysis.candidate ?? {}
  const lines = [
    `Name: ${c.name ?? 'unknown'} | Current: ${c.current_role ?? 'unknown'}${c.current_company ? ` @ ${c.current_company}` : ''} | Experience: ${c.years_experience ?? '?'} yrs | Seniority: ${c.seniority ?? '?'}`,
    `Skills: ${[...strings(analysis.skills?.technical, 15), ...strings(analysis.skills?.tools, 10)].join(', ') || 'n/a'}`,
    `Previous roles: ${asArray(c.previous_roles).slice(0, 5).map((r: any) => `${r?.title ?? ''}${r?.company ? ` @ ${r.company}` : ''}${r?.period ? ` (${r.period})` : ''}`).join('; ') || 'n/a'}`,
    `Key projects: ${asArray(analysis.projects).slice(0, 5).map((p: any) => `${p?.name ?? ''} — ${p?.summary ?? ''}${p?.impact ? ` [impact: ${p.impact}]` : ''}`).join(' | ') || 'n/a'}`,
    `Achievements: ${strings(analysis.achievements, 6).join('; ') || 'n/a'}`,
    `JD match — matching: ${strings(analysis.match?.matching_skills, 10).join(', ') || 'n/a'}; missing: ${strings(analysis.match?.missing_skills, 10).join(', ') || 'none'}`,
    `Weak areas: ${strings(analysis.weak_areas, 6).join('; ') || 'n/a'}`,
    `Deep-dive areas: ${strings(analysis.deep_dive_areas, 6).join('; ') || 'n/a'}`,
    asArray(analysis.career_gaps).length ? `Career gaps: ${asArray(analysis.career_gaps).map((g: any) => `${g?.period}: ${g?.note}`).join('; ')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

const profileFacts = (analysis: any, resumeText: string | null) => {
  if (!analysis) return resumeText ? resumeText.slice(0, 4000) : ''
  return [profileSummary(analysis), `Education: ${strings(analysis.candidate?.education, 4).join('; ') || 'n/a'}`].join('\n')
}

const jdSummary = (analysis: any) => {
  const jd = analysis?.jd
  if (!jd) return ''
  return [jd.summary ?? '', `Required: ${strings(jd.required_skills, 15).join(', ')}`, `Responsibilities: ${strings(jd.responsibilities, 8).join('; ')}`].join('\n')
}

// ---------------------------------------------------------------------------
// Templated turns (instant, no AI call)
// ---------------------------------------------------------------------------

const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

const openingUtterance = (config: InterviewConfig, panel: Panelist[], candidateName: string | null) => {
  const lead = panel[0]
  const first = candidateName ? candidateName.split(/\s+/)[0] : ''
  const greeting: Record<InterviewConfig['style'], string> = {
    friendly: first ? `Hi ${first}, great to meet you, and thanks for making the time today.` : 'Hi, great to meet you, and thanks for making the time today.',
    professional: first ? `Hello ${first}, thank you for joining us.` : 'Hello, thank you for joining us.',
    challenging: first ? `Hello ${first}. Thanks for joining — let's get straight into it.` : "Hello. Thanks for joining — let's get straight into it.",
    aggressive: first ? `Hello ${first}. We have a lot to cover, so let's get started.` : "Hello. We have a lot to cover, so let's get started.",
    executive: first ? `Good to meet you, ${first}. Thanks for your time.` : 'Good to meet you. Thanks for your time.',
  }
  const others = panel.slice(1).map((p) => `${p.first_name}, our ${p.title}`)
  const intro = `I'm ${lead.first_name}, ${lead.title} here.${others.length ? ` With me ${others.length === 1 ? 'is' : 'are'} ${joinNames(others)}.` : ''}`
  const practice = config.mode === 'practice' ? " This is a practice round, so you'll see a quick coaching tip after each answer." : ''
  const question =
    config.experience_level === 'fresher'
      ? 'To start, could you tell us a little about yourself and your education?'
      : 'To start, could you walk us through your background and what you are working on right now?'
  return `${greeting[config.style]} ${intro} We have about ${config.duration_min} minutes.${practice} ${question}`
}

const closingQuestionUtterance = (candidateName: string | null) => {
  const first = candidateName ? candidateName.split(/\s+/)[0] : ''
  return `Thanks${first ? `, ${first}` : ''} — we're almost out of time, so I'll stop there. Before we wrap up, do you have any questions for us?`
}

const finalUtterance = (candidateName: string | null) => {
  const first = candidateName ? candidateName.split(/\s+/)[0] : ''
  return `That brings us to time. Thank you${first ? `, ${first}` : ''}, it was good speaking with you. We'll be in touch about next steps.`
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

router.post('/extract', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) return jsonError(res, 400, 'No file uploaded')
    const text = await extractTextFromFile({ buffer: file.buffer, filename: file.originalname, mimetype: file.mimetype })
    if (text.length < 50) return jsonError(res, 422, 'No readable text found. If this is a scanned PDF, paste the text instead.')
    res.status(200).json({ success: true, text, chars: text.length, truncated: text.length >= MAX_EXTRACTED_CHARS, filename: file.originalname })
  } catch (err) {
    jsonError(res, 400, err instanceof Error ? err.message : 'Could not read that file')
  }
})

router.post('/fetch-url', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const url = cleanUrl(req.body?.url)
    if (!url) return jsonError(res, 400, 'Enter a URL starting with https://')
    const posting = await fetchJobPosting(url)
    res.status(200).json({ success: true, ...posting })
  } catch (err) {
    jsonError(res, 422, err instanceof Error ? err.message : 'Could not load that page')
  }
})

router.post('/profiles/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)

    const input = {
      targetTitle: cleanText(req.body?.target_title, 160),
      companyName: cleanText(req.body?.company_name, 160),
      resumeText: cleanText(req.body?.resume_text, MAX_EXTRACTED_CHARS),
      jdText: cleanText(req.body?.jd_text, MAX_EXTRACTED_CHARS),
      linkedinUrl: cleanUrl(req.body?.linkedin_url),
      portfolioUrl: cleanUrl(req.body?.portfolio_url),
    }
    const jobUrl = cleanUrl(req.body?.job_url)
    if (input.resumeText.length < 100 && input.jdText.length < 100 && !input.targetTitle) {
      return jsonError(res, 400, 'Add your resume, a job description, or at least a target job title.')
    }

    const supabase = adminClient()
    const promptText = buildAnalysisPrompt(input)
    let analysis: any
    try {
      const result = await runModelRequest({
        supabase: supabase as any,
        userId: v.userId,
        requestedModelId: 'interview_pro',
        promptText,
        unitCounts: { inputUnits: promptText.length, outputUnits: 0 },
        generation: { temperature: 0.2, thinkingBudget: ANALYSIS_THINKING_BUDGET },
      })
      analysis = result.output_json
    } catch (err) {
      return sendModelError(res, err, 'analyze')
    }
    if (!analysis || typeof analysis !== 'object') return jsonError(res, 502, 'The analysis came back incomplete. Please try again.')

    // Resume claims are only kept when their quote really appears in the resume.
    const claims = asArray(analysis.resume_claims)
      .map((c: any, i: number) => ({
        id: `c${i + 1}`,
        claim: cleanText(c?.claim, 240),
        source_quote: cleanText(c?.source_quote, 300),
        topic: cleanText(c?.topic, 80),
        priority: Math.min(3, Math.max(1, Number(c?.priority) || 2)),
      }))
      .filter((c) => c.claim && c.source_quote && quoteOccursIn(c.source_quote, input.resumeText))
    analysis.resume_claims = claims

    const companyName = input.companyName || cleanText(analysis.jd?.company, 160) || null
    const recommended = normalizeConfig({
      ...(analysis.recommended_config ?? {}),
      role_family: analysis.role_family,
      domain: analysis.domain,
      company_name: companyName,
      target_role: cleanText(analysis.recommended_config?.target_role, 120) || input.targetTitle || cleanText(analysis.jd?.title, 120),
      focus_topics: [],
    })
    // Long interviews are reserved for final rounds and senior leadership; otherwise recommend ≤ 30 min.
    if (recommended.duration_min > 30 && recommended.mode !== 'final_round' && recommended.interview_type !== 'final_round' && recommended.experience_level !== 'director') {
      recommended.duration_min = 30
      if (analysis.recommendation_reasons && typeof analysis.recommendation_reasons === 'object') delete analysis.recommendation_reasons.duration_min
    }
    analysis.recommended_config = recommended
    analysis.recommendation_reasons = analysis.recommendation_reasons && typeof analysis.recommendation_reasons === 'object' ? analysis.recommendation_reasons : {}

    const { data: profile, error } = await supabase
      .from('interview_profiles')
      .insert({
        owner_id: v.userId,
        target_title: input.targetTitle || recommended.target_role,
        company_name: companyName,
        resume_text: input.resumeText || null,
        jd_text: input.jdText || null,
        job_url: jobUrl || null,
        linkedin_url: input.linkedinUrl || null,
        portfolio_url: input.portfolioUrl || null,
        analysis_json: analysis,
      })
      .select('id,target_title,company_name,analysis_json,created_at')
      .single()
    if (error || !profile) return jsonError(res, 500, error?.message ?? 'Failed to save profile')

    res.status(200).json({
      success: true,
      profile,
      recommended_config: recommended,
      panel: buildPanel(recommended, (profile as any).id, analysis.candidate?.name),
      round_plan: buildRoundPlan(recommended),
    })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.get('/profiles/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const profile = await loadProfile(supabase, req.params.id, v.userId)
    if (!profile) return jsonError(res, 404, 'Profile not found')
    const recommended = normalizeConfig(profile.analysis_json?.recommended_config)
    res.status(200).json({
      success: true,
      profile: { id: profile.id, target_title: profile.target_title, company_name: profile.company_name, analysis_json: profile.analysis_json, created_at: profile.created_at },
      recommended_config: recommended,
      panel: buildPanel(recommended, profile.id, profile.analysis_json?.candidate?.name),
      round_plan: buildRoundPlan(recommended),
    })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

/** Panel + round plan for a candidate-edited config (no AI call). */
router.post('/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const config = normalizeConfig(req.body?.config)
    const profileId = cleanText(req.body?.profile_id, 64)
    const profile = profileId ? await loadProfile(adminClient(), profileId, v.userId) : null
    const seed = profile?.id ?? v.userId
    res.status(200).json({ success: true, config, panel: buildPanel(config, seed, profile?.analysis_json?.candidate?.name), round_plan: buildRoundPlan(config) })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const interviewQuota = async (supabase: Db, userId: string) => {
  try {
    const { data } = await (supabase as any).rpc('ai_get_allowed_models', { uid: userId })
    const row = asArray(data).find((r: any) => r?.model_id === 'interview_session') as any
    if (!row) return { enabled: false, remaining: 0 }
    return { enabled: true, remaining: typeof row.remaining_requests === 'number' ? row.remaining_requests : null }
  } catch {
    return { enabled: true, remaining: null }
  }
}

router.get('/sessions', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const { data, error } = await supabase
      .from('interview_sessions')
      .select('id,title,status,config_json,readiness,scores_json,profile_id,parent_session_id,created_at,started_at,ended_at')
      .eq('owner_id', v.userId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return jsonError(res, 500, error.message)
    const sessions = (data ?? []).map((s: any) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      config: s.config_json,
      readiness: s.readiness,
      categories: s.scores_json?.categories ?? null,
      profile_id: s.profile_id,
      parent_session_id: s.parent_session_id,
      created_at: s.created_at,
      started_at: s.started_at,
      ended_at: s.ended_at,
    }))
    res.status(200).json({ success: true, sessions, quota: await interviewQuota(supabase, v.userId) })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/sessions', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const profile = await loadProfile(supabase, cleanText(req.body?.profile_id, 64) || null, v.userId)
    if (!profile) return jsonError(res, 400, 'Complete the profile analysis first')

    const recommended = normalizeConfig(profile.analysis_json?.recommended_config)
    const config = normalizeConfig(req.body?.config, recommended)
    const panel = buildPanel(config, profile.id, profile.analysis_json?.candidate?.name)
    const roundPlan = buildRoundPlan(config)
    const parentId = cleanText(req.body?.parent_session_id, 64) || null

    const { data, error } = await supabase
      .from('interview_sessions')
      .insert({
        owner_id: v.userId,
        profile_id: profile.id,
        parent_session_id: parentId,
        title: `${config.target_role}${config.company_name ? ` · ${config.company_name}` : ''}`,
        recommended_config_json: recommended,
        config_json: config,
        panel_json: panel,
        round_plan_json: roundPlan,
        state_json: { thread_seq: 1, notes: [], probed_claims: [] },
        status: 'ready',
      })
      .select('id,status')
      .single()
    if (error || !data) return jsonError(res, 500, error?.message ?? 'Failed to create interview')
    res.status(200).json({ success: true, session: data })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

const sessionPayload = (session: any) => ({
  id: session.id,
  title: session.title,
  status: session.status,
  config: session.config_json,
  recommended_config: session.recommended_config_json,
  panel: session.panel_json,
  round_plan: session.round_plan_json,
  started_at: session.started_at,
  ended_at: session.ended_at,
  readiness: session.readiness,
  scores: session.scores_json,
  report: session.report_json,
  profile_id: session.profile_id,
  parent_session_id: session.parent_session_id,
  created_at: session.created_at,
  is_final: !!session.state_json?.final,
})

router.get('/sessions/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const session = await loadOwnedSession(supabase, req.params.id, v.userId)
    if (!session) return jsonError(res, 404, 'Interview not found')
    const [turns, feedbackRes, profile] = await Promise.all([
      loadTurns(supabase, session.id),
      supabase.from('interview_feedback').select('thread_id,question_turn_id,feedback_json').eq('session_id', session.id),
      loadProfile(supabase, session.profile_id, v.userId),
    ])
    const feedback = ((feedbackRes.data ?? []) as any[])
      .map((f) => ({ thread_id: f.thread_id, question_turn_id: f.question_turn_id, ...f.feedback_json }))
      .sort((a, b) => (a.q_number ?? 0) - (b.q_number ?? 0))
    res.status(200).json({
      success: true,
      session: sessionPayload(session),
      turns,
      feedback,
      profile: profile ? { id: profile.id, target_title: profile.target_title, company_name: profile.company_name, analysis: profile.analysis_json } : null,
    })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.post('/sessions/:id/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const session = await loadOwnedSession(supabase, req.params.id, v.userId)
    if (!session) return jsonError(res, 404, 'Interview not found')

    if (session.status === 'live') {
      // Pause the clock while the candidate was away: shift started_at by the idle gap since the last turn,
      // so rejoining later doesn't find the interview already "out of time".
      const turns = await loadTurns(supabase, session.id)
      const lastActivity = Math.max(...turns.map((t) => new Date(t.created_at).getTime()), new Date(session.started_at ?? Date.now()).getTime())
      const idleMs = Date.now() - lastActivity
      let current = session
      if (session.started_at && idleMs > REJOIN_IDLE_PAUSE_MS) {
        const startedAt = new Date(new Date(session.started_at).getTime() + idleMs - REJOIN_GRACE_MS).toISOString()
        const { data: updated } = await supabase
          .from('interview_sessions')
          .update({ started_at: startedAt, updated_at: new Date().toISOString() })
          .eq('id', session.id)
          .select('*')
          .maybeSingle()
        if (updated) current = updated
      }
      res.status(200).json({ success: true, session: sessionPayload(current), turns, resumed: true })
      return
    }
    if (session.status !== 'ready') return jsonError(res, 409, 'This interview has already finished')

    // Claim the start atomically so a double click cannot meter twice.
    const startedAt = new Date().toISOString()
    const { data: claimed } = await supabase
      .from('interview_sessions')
      .update({ status: 'live', started_at: startedAt, updated_at: startedAt })
      .eq('id', session.id)
      .eq('status', 'ready')
      .select('*')
      .maybeSingle()
    if (!claimed) {
      const current = await loadOwnedSession(supabase, session.id, v.userId)
      res.status(200).json({ success: true, session: sessionPayload(current), turns: await loadTurns(supabase, session.id), resumed: true })
      return
    }

    const { data: model } = await supabase.from('ai_models').select('id').eq('model_id', 'interview_session').maybeSingle()
    const { error: meterErr } = model
      ? await (supabase as any).rpc('ai_meter_model_request', { uid: v.userId, model_pk: (model as any).id, input_units: 0, output_units: 0, request_inc: 1 })
      : { error: { message: 'model_not_allowed' } }
    if (meterErr) {
      await supabase.from('interview_sessions').update({ status: 'ready', started_at: null }).eq('id', session.id)
      const msg = meterErr.message ?? ''
      if (msg.includes('quota_exceeded')) return jsonError(res, 429, "You've used all your interviews for this month. Upgrade your plan or wait for next month's reset.", { code: 'quota_exceeded' })
      if (msg.includes('model_not_allowed')) return jsonError(res, 403, 'Interview practice is not enabled for your plan.', { code: 'model_not_allowed' })
      return jsonError(res, 500, 'Could not start the interview. Please try again.')
    }

    const config = normalizeConfig(claimed.config_json)
    const panel = claimed.panel_json as Panelist[]
    const plan = claimed.round_plan_json as Round[]
    const profile = await loadProfile(supabase, claimed.profile_id, v.userId)
    const candidateName = cleanText(profile?.analysis_json?.candidate?.name, 80) || null

    const { error: turnErr } = await supabase.from('interview_turns').insert({
      session_id: claimed.id,
      owner_id: v.userId,
      seq: 1,
      speaker: 'interviewer',
      persona_id: panel[0].id,
      action: 'next_topic',
      round: plan[0].id,
      difficulty: 1,
      thread_id: 't1',
      text: openingUtterance(config, panel, candidateName),
      rationale: 'Opening question',
    })
    if (turnErr) return jsonError(res, 500, turnErr.message)

    res.status(200).json({ success: true, session: sessionPayload(claimed), turns: await loadTurns(supabase, claimed.id), resumed: false })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

const MAX_CANDIDATE_TURNS = 60
const SAME_THREAD_ACTIONS = new Set(['follow_up', 'challenge', 'respond'])

const progressFor = (plan: Round[], config: InterviewConfig, startedAt: string, turns: TurnRow[]) => {
  const elapsedSec = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000)
  const idx = roundIndexAt(plan, elapsedSec)
  return {
    elapsed_sec: Math.round(elapsedSec),
    duration_sec: config.duration_min * 60,
    round_index: idx,
    round_count: plan.length,
    round_id: plan[idx].id,
    round_label: plan[idx].label,
    question_number: turns.filter((t) => t.speaker === 'interviewer').length,
  }
}

router.post('/sessions/:id/turns', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const session = await loadOwnedSession(supabase, req.params.id, v.userId)
    if (!session) return jsonError(res, 404, 'Interview not found')
    if (session.status !== 'live') return jsonError(res, 409, 'This interview is not live')

    const text = cleanText(req.body?.text, 6000)
    const inputMode = req.body?.input_mode === 'voice' ? 'voice' : 'text'
    const config = normalizeConfig(session.config_json)
    const panel = session.panel_json as Panelist[]
    const plan = session.round_plan_json as Round[]
    const state: SessionState = { ...(session.state_json ?? {}) }
    const turns = await loadTurns(supabase, session.id)
    const last = turns[turns.length - 1]
    if (!last) return jsonError(res, 409, 'The interview has not started')
    if (state.final) return jsonError(res, 409, 'The interview has ended')

    // A retry after a failed AI call re-uses the candidate turn that was already saved.
    let candidateTurn: TurnRow
    if (last.speaker === 'candidate') {
      candidateTurn = last
    } else {
      if (!text) return jsonError(res, 400, 'Your answer is empty')
      const { data, error } = await supabase
        .from('interview_turns')
        .insert({
          session_id: session.id,
          owner_id: v.userId,
          seq: last.seq + 1,
          speaker: 'candidate',
          round: last.round,
          thread_id: last.thread_id,
          text,
          input_mode: inputMode,
          metrics_json: computeAnswerMetrics(text, req.body ?? {}),
        })
        .select('*')
        .single()
      if (error) return jsonError(res, error.code === '23505' ? 409 : 500, error.code === '23505' ? 'Answer already received' : error.message)
      candidateTurn = data as TurnRow
      turns.push(candidateTurn)
    }

    const profile = await loadProfile(supabase, session.profile_id, v.userId)
    const analysis = profile?.analysis_json ?? null
    const candidateName = cleanText(analysis?.candidate?.name, 80) || null
    const elapsedSec = Math.max(0, (Date.now() - new Date(session.started_at).getTime()) / 1000)
    const totalSec = config.duration_min * 60
    const candidateCount = turns.filter((t) => t.speaker === 'candidate').length
    const roundIdx = roundIndexAt(plan, elapsedSec)
    const round = plan[roundIdx]
    const lead = panel[0]

    const saveInterviewerTurn = async (fields: Partial<TurnRow> & { text: string; persona_id: string }, nextState: SessionState) => {
      const { data, error } = await supabase
        .from('interview_turns')
        .insert({ session_id: session.id, owner_id: v.userId, seq: candidateTurn.seq + 1, speaker: 'interviewer', ...fields })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      await supabase.from('interview_sessions').update({ state_json: nextState, updated_at: new Date().toISOString() }).eq('id', session.id)
      const all = [...turns, data as TurnRow]
      res.status(200).json({
        success: true,
        candidate_turn: candidateTurn,
        interviewer_turn: data,
        progress: progressFor(plan, config, session.started_at, all),
        is_final: !!nextState.final,
      })
    }

    // Hard stop well past time or after too many turns: close without an AI call.
    if (elapsedSec > totalSec + 180 || candidateCount >= MAX_CANDIDATE_TURNS) {
      await saveInterviewerTurn(
        { persona_id: lead.id, action: 'wrap_up', round: 'closing', thread_id: 'closing', text: finalUtterance(candidateName), rationale: 'Time limit reached' },
        { ...state, final: true },
      )
      return
    }

    // Entering the closing window: ask for the candidate's questions (templated, instant).
    if (round.id === 'closing' && !state.closing_asked) {
      await saveInterviewerTurn(
        { persona_id: lead.id, action: 'next_topic', round: 'closing', thread_id: 'closing', text: closingQuestionUtterance(candidateName), rationale: 'Closing: candidate questions' },
        { ...state, closing_asked: true },
      )
      return
    }

    const closingReply = !!state.closing_asked
    const currentThreadId = last.speaker === 'candidate' ? candidateTurn.thread_id ?? 't1' : last.thread_id ?? 't1'
    const threadInterviewerTurns = turns.filter((t) => t.speaker === 'interviewer' && t.thread_id === currentThreadId).length
    const lastInterviewer = [...turns].reverse().find((t) => t.speaker === 'interviewer')
    const roundChanged = !closingReply && !!lastInterviewer && lastInterviewer.round !== round.id
    const maxFollowUps = config.mode === 'deep_dive' || config.mode === 'stress' ? 4 : 3
    const probed = new Set(state.probed_claims ?? [])
    const unprobedClaims = asArray(analysis?.resume_claims)
      .filter((c: any) => c?.id && !probed.has(c.id))
      .sort((a: any, b: any) => (a.priority ?? 2) - (b.priority ?? 2))
      .slice(0, 6)
      .map((c: any) => ({ id: c.id, claim: c.claim }))

    const nameFor = (personaId: string | null) => panel.find((p) => p.id === personaId)
    const priorTurns = turns.filter((t) => t.seq < candidateTurn.seq).slice(-8)
    const recentTranscript = priorTurns
      .map((t) => {
        const p = nameFor(t.persona_id)
        const who = t.speaker === 'candidate' ? 'Candidate' : `${p?.name ?? 'Interviewer'} (${p?.title ?? 'panel'}, ${t.persona_id})`
        return `[T${t.seq}] ${who}: ${t.text.slice(0, 700)}`
      })
      .join('\n')
    const m = candidateTurn.metrics_json
    const meta = [
      candidateTurn.input_mode ?? 'text',
      m ? `${m.word_count} words` : '',
      m?.duration_ms ? `${Math.round(m.duration_ms / 1000)}s` : '',
      m?.interrupted ? 'the interviewer cut the answer off because it ran long' : '',
    ]
      .filter(Boolean)
      .join(', ')
    const intensityBonus = config.intensity === 'very_challenging' ? 1 : config.intensity === 'challenging' ? 0.5 : 0
    const baseline = Math.min(5, Math.max(1, Math.round((round.base_difficulty + DIFFICULTY_BASELINE[config.difficulty]) / 2 + intensityBonus)))

    const promptText = buildDirectorPrompt({
      config,
      panel,
      profileSummary: profileSummary(analysis),
      unprobedClaims,
      round,
      nextRound: plan[roundIdx + 1] ?? null,
      roundChanged,
      roundSecondsLeft: round.end_sec - elapsedSec,
      totalSecondsLeft: totalSec - elapsedSec,
      currentThread: { id: currentThreadId, followUps: Math.max(0, threadInterviewerTurns - 1), maxFollowUps },
      notes: (state.notes ?? []).slice(-20),
      recentTranscript,
      latestAnswerRef: `T${candidateTurn.seq}`,
      latestAnswer: candidateTurn.text,
      latestAnswerMeta: meta,
      baselineDifficulty: state.last_difficulty ?? baseline,
      closingReply,
      recentOpeners: turns
        .filter((t) => t.speaker === 'interviewer')
        .slice(-2)
        .map((t) => t.text.split(/\s+/).slice(0, 4).join(' ')),
    })

    let out: any
    try {
      const result = await runModelRequest({
        supabase: supabase as any,
        userId: v.userId,
        requestedModelId: 'interview_lite',
        promptText,
        unitCounts: { inputUnits: promptText.length, outputUnits: 0 },
        generation: { temperature: 0.7, thinkingBudget: 0 },
      })
      out = result.output_json
    } catch (err) {
      return sendModelError(res, err, 'director')
    }

    const utterance = cleanText(out?.utterance, 700).replace(/\s+/g, ' ')
    if (!utterance) return jsonError(res, 502, 'The interviewer lost its train of thought. Please try again.', { code: 'model_unavailable' })

    let action = (DIRECTOR_ACTIONS as readonly string[]).includes(out?.action) ? (out.action as string) : 'next_topic'
    if (closingReply) action = 'wrap_up'
    else if (action === 'wrap_up') action = 'next_topic'

    const preferred = panel.find((p) => round.persona_kinds.includes(p.kind)) ?? lead
    const persona = panel.find((p) => p.id === out?.persona_id) ?? (SAME_THREAD_ACTIONS.has(action) ? nameFor(lastInterviewer?.persona_id ?? null) : null) ?? preferred

    const keepThread = SAME_THREAD_ACTIONS.has(action) && !roundChanged
    const threadSeq = keepThread ? state.thread_seq ?? 1 : (state.thread_seq ?? 1) + 1
    const threadId = closingReply ? 'closing' : keepThread ? currentThreadId : `t${threadSeq}`

    const claimId = cleanText(out?.resume_claim_id, 16)
    const validClaim = unprobedClaims.some((c) => c.id === claimId) ? claimId : null
    const difficulty = Math.min(5, Math.max(1, Math.round(Number(out?.difficulty) || baseline)))
    const quality = ['strong', 'adequate', 'weak', 'non_answer'].includes(out?.answer_quality) ? out.answer_quality : 'adequate'
    const note = cleanText(out?.answer_note, 200)

    const nextState: SessionState = {
      ...state,
      thread_seq: threadSeq,
      notes: note ? [...(state.notes ?? []), `T${candidateTurn.seq} (${quality}): ${note}`].slice(-40) : state.notes ?? [],
      probed_claims: validClaim ? Array.from(new Set([...(state.probed_claims ?? []), validClaim])) : state.probed_claims ?? [],
      last_difficulty: difficulty,
      final: closingReply ? true : state.final,
    }

    await saveInterviewerTurn(
      {
        persona_id: persona.id,
        action,
        round: closingReply ? 'closing' : round.id,
        difficulty,
        thread_id: threadId,
        resume_claim_ref: validClaim,
        text: utterance,
        rationale: cleanText(out?.rationale, 300) || null,
        practice_tip: config.mode === 'practice' ? cleanText(out?.practice_tip, 300) || null : null,
      },
      nextState,
    )
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

/** Room diagnostics: metadata-only milestones from the browser, written to the server log (never answer text). */
router.post('/sessions/:id/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const sessionRef = cleanText(req.params.id, 64).slice(0, 8)
    for (const e of asArray(req.body?.events).slice(0, 25)) {
      const type = cleanText((e as any)?.type, 40).replace(/[^a-z0-9_:.-]/gi, '')
      if (!type) continue
      const detail = cleanText((e as any)?.detail, 160).replace(/[\r\n]+/g, ' ')
      const at = Math.max(0, Math.round((Number((e as any)?.t) || 0) / 1000))
      console.log(`[interview-room] session=${sessionRef} user=${v.userId.slice(0, 8)} +${at}s ${type}${detail ? ` ${detail}` : ''}`)
    }
    res.status(204).end()
  } catch {
    res.status(204).end()
  }
})

router.post('/sessions/:id/end', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const session = await loadOwnedSession(supabase, req.params.id, v.userId)
    if (!session) return jsonError(res, 404, 'Interview not found')
    if (session.status !== 'live') {
      res.status(200).json({ success: true, status: session.status })
      return
    }
    const turns = await loadTurns(supabase, session.id)
    const answered = turns.some((t) => t.speaker === 'candidate')
    const status = answered ? 'evaluating' : 'abandoned'
    const now = new Date().toISOString()
    await supabase.from('interview_sessions').update({ status, ended_at: now, updated_at: now }).eq('id', session.id)
    res.status(200).json({ success: true, status })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

// ---------------------------------------------------------------------------
// Evaluation (resumable: each call does as much as fits in its time budget)
// ---------------------------------------------------------------------------

const EVALUATION_BUDGET_MS = 38_000
const EVALUATION_CONCURRENCY = 4

type Thread = { id: string; turns: TurnRow[]; question: TurnRow; answers: TurnRow[] }

const buildThreads = (turns: TurnRow[]): Thread[] => {
  const byId = new Map<string, TurnRow[]>()
  for (const t of turns) {
    const id = t.thread_id ?? 't1'
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id)!.push(t)
  }
  return Array.from(byId.entries())
    .filter(([id, ts]) => id !== 'closing' && ts.some((t) => t.speaker === 'candidate') && ts[0].speaker === 'interviewer')
    .map(([id, ts]) => ({ id, turns: ts, question: ts[0], answers: ts.filter((t) => t.speaker === 'candidate') }))
    .sort((a, b) => a.question.seq - b.question.seq)
}

const metricsLine = (t: TurnRow) => {
  const m = t.metrics_json
  if (!m) return ''
  const parts = [`T${t.seq}: ${m.word_count} words`]
  if (m.duration_ms) parts.push(`${Math.round(m.duration_ms / 1000)}s`)
  if (m.wpm) parts.push(`${m.wpm} wpm`)
  if (m.latency_ms != null) parts.push(`started after ${(m.latency_ms / 1000).toFixed(1)}s`)
  if (m.longest_pause_ms != null) parts.push(`longest pause ${(m.longest_pause_ms / 1000).toFixed(1)}s`)
  if (m.interrupted) parts.push('interrupted for length')
  return parts.join(', ')
}

const evaluateThread = async ({
  supabase,
  userId,
  thread,
  qNumber,
  config,
  panel,
  analysis,
  resumeText,
}: {
  supabase: Db
  userId: string
  thread: Thread
  qNumber: number
  config: InterviewConfig
  panel: Panelist[]
  analysis: any
  resumeText: string | null
}) => {
  const transcript = thread.turns
    .map((t) => {
      if (t.speaker === 'candidate') return `[T${t.seq}] Candidate: ${t.text}`
      const p = panel.find((x) => x.id === t.persona_id)
      return `[T${t.seq}] Interviewer — ${p?.name ?? 'Interviewer'} (${p?.title ?? 'panel'}): ${t.text}`
    })
    .join('\n')
  const promptText = buildEvaluationPrompt({
    config,
    profileFacts: profileFacts(analysis, resumeText),
    jdSummary: jdSummary(analysis),
    threadTranscript: transcript,
    metricsSummary: thread.answers.map(metricsLine).filter(Boolean).join('\n'),
  })
  const result = await runModelRequest({
    supabase: supabase as any,
    userId,
    requestedModelId: 'interview_pro',
    promptText,
    unitCounts: { inputUnits: promptText.length, outputUnits: 0 },
    generation: { temperature: 0.2, thinkingBudget: EVALUATION_THINKING_BUDGET },
  })
  const out: any = result.output_json ?? {}

  const answerText = new Map(thread.answers.map((a) => [`T${a.seq}`, a.text]))
  let dropped = 0
  const didWell = asArray(out.did_well)
    .map((d: any) => ({ point: cleanText(d?.point, 300), evidence: verifyEvidence(d?.evidence, answerText) }))
    .filter((d) => {
      const ok = !!d.point && d.evidence.length > 0
      if (!ok) dropped++
      return ok
    })
  const mistakes = asArray(out.mistakes)
    .filter((x: any) => (MISTAKE_TYPES as readonly string[]).includes(x?.type))
    .map((x: any) => ({
      type: x.type as string,
      what_happened: cleanText(x.what_happened, 400),
      evidence: verifyEvidence(x.evidence, answerText),
      why_it_matters: cleanText(x.why_it_matters, 300),
      how_to_improve: cleanText(x.how_to_improve, 400),
    }))
    .filter((x) => {
      const ok = !!x.what_happened && x.evidence.length > 0
      if (!ok) dropped++
      return ok
    })
  const measured = measuredMistakes(thread.answers.map((a) => ({ ref: `T${a.seq}`, metrics: a.metrics_json })))
  const star = out.star && typeof out.star === 'object' ? { situation: !!out.star.situation, task: !!out.star.task, action: !!out.star.action, result: !!out.star.result } : null
  const stronger = guardBorrowedMetrics(cleanText(out.stronger_answer, 2000), resumeText)

  return {
    q_number: qNumber,
    question: cleanText(out.question, 400) || thread.question.text,
    question_ref: `T${thread.question.seq}`,
    answer_refs: thread.answers.map((a) => `T${a.seq}`),
    persona_id: thread.question.persona_id,
    round: thread.question.round,
    category: cleanText(out.category, 40) || 'general',
    verdict: ['strong', 'adequate', 'weak'].includes(out.verdict) ? out.verdict : 'adequate',
    did_well: didWell,
    missing: strings(out.missing, 8, 300),
    mistakes: [...mistakes, ...measured],
    better_approach: strings(out.better_approach, 8, 300),
    framework: cleanText(out.framework, 40) || 'none',
    star,
    stronger_answer: stronger.text,
    borrowed_metrics_removed: stronger.replaced,
    why_stronger: strings(out.why_stronger, 6, 300),
    scores: normalizeScores(out.scores),
    unverified_findings_dropped: dropped,
  }
}

router.post('/sessions/:id/evaluate', async (req: Request, res: Response): Promise<void> => {
  const startedAt = Date.now()
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const session = await loadOwnedSession(supabase, req.params.id, v.userId)
    if (!session) return jsonError(res, 404, 'Interview not found')
    if (session.status === 'completed') {
      res.status(200).json({ success: true, status: 'completed' })
      return
    }
    if (session.status !== 'evaluating') return jsonError(res, 409, 'End the interview before requesting feedback')

    const config = normalizeConfig(session.config_json)
    const panel = session.panel_json as Panelist[]
    const turns = await loadTurns(supabase, session.id)
    const profile = await loadProfile(supabase, session.profile_id, v.userId)
    const analysis = profile?.analysis_json ?? null
    const threads = buildThreads(turns)

    const { data: existingRows } = await supabase.from('interview_feedback').select('thread_id,feedback_json').eq('session_id', session.id)
    const done = new Map(((existingRows ?? []) as any[]).map((r) => [r.thread_id as string, r.feedback_json]))
    const pending = threads.map((t, i) => ({ t, q: i + 1 })).filter(({ t }) => !done.has(t.id))

    let failures = 0
    for (let i = 0; i < pending.length; i += EVALUATION_CONCURRENCY) {
      if (Date.now() - startedAt > EVALUATION_BUDGET_MS) break
      const batch = pending.slice(i, i + EVALUATION_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(({ t, q }) =>
          evaluateThread({ supabase, userId: v.userId, thread: t, qNumber: q, config, panel, analysis, resumeText: profile?.resume_text ?? null }),
        ),
      )
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === 'rejected') {
          failures++
          const msg = r.reason instanceof Error ? r.reason.message : ''
          if (msg === 'quota_exceeded') return sendModelError(res, r.reason, 'evaluate')
          console.error('[interview] evaluate thread failed:', msg)
          continue
        }
        const { error } = await supabase.from('interview_feedback').upsert(
          { session_id: session.id, owner_id: v.userId, thread_id: batch[j].t.id, question_turn_id: batch[j].t.question.id, feedback_json: r.value },
          { onConflict: 'session_id,thread_id' },
        )
        if (!error) done.set(batch[j].t.id, r.value)
      }
    }

    const remaining = threads.filter((t) => !done.has(t.id)).length
    if (remaining > 0) {
      res.status(200).json({ success: true, status: 'partial', evaluated: threads.length - remaining, total: threads.length, failures })
      return
    }
    if (Date.now() - startedAt > EVALUATION_BUDGET_MS - 8_000) {
      res.status(200).json({ success: true, status: 'partial', evaluated: threads.length, total: threads.length, failures: 0 })
      return
    }

    // All questions evaluated → scorecard (deterministic) + debrief (AI).
    const feedback = threads.map((t) => done.get(t.id)).filter(Boolean) as any[]
    const answerMetrics = turns.filter((t) => t.speaker === 'candidate' && t.thread_id !== 'closing' && t.metrics_json).map((t) => t.metrics_json!)
    const scorecard = computeScorecard({
      threadScores: feedback.map((f) => f.scores ?? {}),
      answerMetrics,
      interviewType: config.interview_type,
      answeredThreads: feedback.length,
    })

    const threadDigest = feedback
      .map(
        (f) =>
          `Q${f.q_number} [${f.category}, ${f.verdict}] "${f.question}" — did well: ${f.did_well.map((d: any) => d.point).join('; ') || 'nothing notable'}; mistakes: ${f.mistakes.map((m: any) => m.type).join(', ') || 'none'}; missing: ${f.missing.join('; ') || 'nothing'}`,
      )
      .join('\n')
    const scoreText = [
      ...Object.entries(scorecard.categories).map(([k, val]) => `${CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS]}: ${val}`),
      `Readiness: ${scorecard.readiness ?? 'n/a'}`,
    ].join('\n')
    const voiceAnswers = answerMetrics.filter((m) => m.wpm != null)
    const deliveryDigest = answerMetrics.length
      ? [
          voiceAnswers.length ? `Average pace ${Math.round(voiceAnswers.reduce((s, m) => s + (m.wpm ?? 0), 0) / voiceAnswers.length)} wpm` : 'Typed answers',
          `Average answer ${Math.round(answerMetrics.reduce((s, m) => s + m.word_count, 0) / answerMetrics.length)} words`,
          `Filler words ${answerMetrics.reduce((s, m) => s + m.filler_count, 0)}`,
        ].join('; ')
      : ''

    let debrief: any = {}
    const summaryPrompt = buildSummaryPrompt({ config, profileSummary: profileSummary(analysis), threadDigest, scorecard: scoreText, deliveryDigest })
    try {
      const result = await runModelRequest({
        supabase: supabase as any,
        userId: v.userId,
        requestedModelId: 'interview_pro',
        promptText: summaryPrompt,
        unitCounts: { inputUnits: summaryPrompt.length, outputUnits: 0 },
        generation: { temperature: 0.3, thinkingBudget: EVALUATION_THINKING_BUDGET },
      })
      debrief = result.output_json ?? {}
    } catch (err) {
      return sendModelError(res, err, 'summary')
    }

    const areas = (value: unknown) =>
      asArray(value)
        .map((a: any) => ({ area: cleanText(a?.area, 120), detail: cleanText(a?.detail, 400), questions: strings(a?.questions, 6, 6) }))
        .filter((a) => a.area)
        .slice(0, 6)
    const practiceTypes = ['hr', 'behavioral', 'technical', 'managerial', 'system_design', 'mixed']
    const report = {
      overall_summary: cleanText(debrief.overall_summary, 1200),
      strong_areas: areas(debrief.strong_areas),
      weak_areas: areas(debrief.weak_areas),
      critical_areas: areas(debrief.critical_areas),
      biggest_risk: cleanText(debrief.biggest_risk, 400),
      communication_analysis: cleanText(debrief.communication_analysis, 800),
      action_plan: asArray(debrief.action_plan)
        .map((a: any) => ({
          title: cleanText(a?.title, 160),
          why: cleanText(a?.why, 400),
          how: cleanText(a?.how, 500),
          practice_type: practiceTypes.includes(a?.practice_type) ? a.practice_type : 'mixed',
        }))
        .filter((a) => a.title)
        .slice(0, 7),
      recommended_topics: strings(debrief.recommended_topics, 10, 120),
      questions_evaluated: feedback.length,
      generated_at: new Date().toISOString(),
    }

    const now = new Date().toISOString()
    await supabase
      .from('interview_sessions')
      .update({ status: 'completed', scores_json: scorecard, readiness: scorecard.readiness, report_json: report, updated_at: now })
      .eq('id', session.id)
    res.status(200).json({ success: true, status: 'completed' })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

router.delete('/sessions/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const v = await verifyUser(req)
    if (!v.ok) return jsonError(res, v.status, v.error)
    const supabase = adminClient()
    const session = await loadOwnedSession(supabase, req.params.id, v.userId)
    if (!session) return jsonError(res, 404, 'Interview not found')
    const { error } = await supabase.from('interview_sessions').delete().eq('id', session.id)
    if (error) return jsonError(res, 500, error.message)
    res.status(200).json({ success: true })
  } catch (err) {
    jsonError(res, 500, err instanceof Error ? err.message : 'Server error')
  }
})

export default router
