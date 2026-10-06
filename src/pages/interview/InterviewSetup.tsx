import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileText, Link2, Loader2, Upload, X } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { interviewApi, InterviewApiError } from '@/lib/interview/api'
import {
  DIFFICULTY_OPTIONS,
  DURATION_OPTIONS,
  EXPERIENCE_OPTIONS,
  INTENSITY_OPTIONS,
  LEVEL_OPTIONS,
  MODE_OPTIONS,
  STYLE_OPTIONS,
  TYPE_OPTIONS,
  labelOf,
  type Option,
} from '@/lib/interview/options'
import type { InterviewConfig, InterviewProfile, Panelist, ProfileAnalysis, Round } from '@/lib/interview/types'
import { AiBadge, Chip, ErrorNote, PanelistRow, SectionLabel, Stepper } from '@/components/interview/ui'

const STEPS = ['Your profile', 'Target job', 'Analysis', 'Recommendation', 'Customize & prepare']
type Step = 0 | 1 | 2 | 3 | 4

const ANALYSIS_STAGES = [
  'Reading your resume',
  'Mapping your experience, projects and skills',
  'Matching you against the job description',
  'Finding claims worth cross-questioning',
  'Choosing your interview panel',
]

type AnalyzeResponse = { profile: InterviewProfile; recommended_config: InterviewConfig; panel: Panelist[]; round_plan: Round[] }

export default function InterviewSetup() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user, isReady } = useAuthStore()
  const userId = user?.id ?? null

  const [step, setStep] = useState<Step>(0)
  const [error, setError] = useState<string | null>(null)

  // Step 1–2 inputs
  const [resumeText, setResumeText] = useState('')
  const [resumeFile, setResumeFile] = useState<string | null>(null)
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [jdText, setJdText] = useState('')
  const [jdFile, setJdFile] = useState<string | null>(null)
  const [jobUrl, setJobUrl] = useState('')
  const [jobUrlNote, setJobUrlNote] = useState<string | null>(null)
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [targetTitle, setTargetTitle] = useState('')

  // Analysis result + editable config
  const [profile, setProfile] = useState<InterviewProfile | null>(null)
  const [recommended, setRecommended] = useState<InterviewConfig | null>(null)
  const [config, setConfig] = useState<InterviewConfig | null>(null)
  const [panel, setPanel] = useState<Panelist[]>([])
  const [plan, setPlan] = useState<Round[]>([])
  const [stage, setStage] = useState(0)
  const [starting, setStarting] = useState(false)

  const parentSessionId = params.get('parent')

  useEffect(() => {
    if (isReady && !user) navigate('/login')
  }, [isReady, user, navigate])

  const applyAnalysis = (r: AnalyzeResponse) => {
    setProfile(r.profile)
    setRecommended(r.recommended_config)
    const type = params.get('type')
    const startConfig = type && TYPE_OPTIONS.some((o) => o.value === type) ? { ...r.recommended_config, interview_type: type } : r.recommended_config
    setConfig(startConfig)
    setPanel(r.panel)
    setPlan(r.round_plan)
  }

  // "Practice again" re-uses an analysed profile and skips straight to the recommendation.
  useEffect(() => {
    const profileId = params.get('profile')
    if (!profileId || !userId) return
    let alive = true
    void interviewApi<AnalyzeResponse>(`/profiles/${profileId}`)
      .then((r) => {
        if (!alive) return
        applyAnalysis(r)
        setStep(params.get('type') ? 4 : 3)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Panel and round plan follow the candidate's edits (cheap server call, no AI).
  const previewSeq = useRef(0)
  useEffect(() => {
    if (!config || !profile || step !== 4) return
    const seq = ++previewSeq.current
    const t = window.setTimeout(() => {
      void interviewApi<{ panel: Panelist[]; round_plan: Round[] }>('/preview', { body: { config, profile_id: profile.id } })
        .then((r) => {
          if (seq !== previewSeq.current) return
          setPanel(r.panel)
          setPlan(r.round_plan)
        })
        .catch(() => undefined)
    }, 300)
    return () => window.clearTimeout(t)
  }, [config, profile, step])

  useEffect(() => {
    if (step !== 2) return
    setStage(0)
    const id = window.setInterval(() => setStage((s) => Math.min(ANALYSIS_STAGES.length - 1, s + 1)), 2600)
    return () => window.clearInterval(id)
  }, [step])

  const fetchJobUrl = async () => {
    setJobUrlNote(null)
    setFetchingUrl(true)
    try {
      const r = await interviewApi<{ title: string; company: string; text: string; source: string }>('/fetch-url', { body: { url: jobUrl } })
      setJdText(r.text)
      setJdFile(null)
      if (r.title && !targetTitle) setTargetTitle(r.title)
      if (r.company && !companyName) setCompanyName(r.company)
      setJobUrlNote(r.source === 'structured' ? 'Job description imported from the posting.' : 'Page text imported — trim anything that is not part of the job description.')
    } catch (e) {
      setJobUrlNote(e instanceof Error ? e.message : 'Could not load that page.')
    } finally {
      setFetchingUrl(false)
    }
  }

  const analyze = async () => {
    setError(null)
    setStep(2)
    try {
      const r = await interviewApi<AnalyzeResponse>('/profiles/analyze', {
        body: {
          resume_text: resumeText,
          jd_text: jdText,
          job_url: jobUrl,
          linkedin_url: linkedinUrl,
          portfolio_url: portfolioUrl,
          company_name: companyName,
          target_title: targetTitle,
        },
      })
      applyAnalysis(r)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
      setStep(1)
    }
  }

  const start = async () => {
    if (!profile || !config) return
    setError(null)
    setStarting(true)
    try {
      const r = await interviewApi<{ session: { id: string } }>('/sessions', {
        body: { profile_id: profile.id, config, parent_session_id: parentSessionId },
      })
      navigate(`/interview/${r.session.id}/room`)
    } catch (e) {
      setError(e instanceof InterviewApiError ? e.message : 'Could not create the interview')
      setStarting(false)
    }
  }

  const canAnalyze = resumeText.trim().length >= 100 || jdText.trim().length >= 100 || targetTitle.trim().length > 1

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-6 border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-light tracking-tight text-black dark:text-white">New mock interview</h1>
            <p className="mt-2 text-sm uppercase tracking-wider text-neutral-500">Prepare · Simulate · Improve</p>
          </div>
          <Link to="/interview" className="text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:text-black dark:hover:text-white">
            Cancel
          </Link>
        </div>
        <Stepper steps={STEPS} current={step} />
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {step === 0 ? (
        <StepShell
          title="Add your profile"
          subtitle="Your resume lets the panel ask about your real projects and cross-question your claims. Everything stays private to your account."
          footer={
            <>
              <span />
              <button type="button" className="minimal-btn-primary" onClick={() => setStep(1)}>
                Next: target job <ArrowRight className="ml-2 h-4 w-4" />
              </button>
            </>
          }
        >
          <DocumentInput
            label="Resume / CV"
            text={resumeText}
            onText={setResumeText}
            fileName={resumeFile}
            onFileName={setResumeFile}
            placeholder="Upload a PDF/DOCX or paste your resume text here…"
            onError={setError}
          />
          <div className="grid gap-6 md:grid-cols-2">
            <UrlField
              label="LinkedIn profile URL"
              value={linkedinUrl}
              onChange={setLinkedinUrl}
              placeholder="https://www.linkedin.com/in/…"
              hint="Kept as a reference only — LinkedIn pages can't be read automatically. Paste details into the resume box if they're missing there."
            />
            <UrlField label="Portfolio / GitHub URL" value={portfolioUrl} onChange={setPortfolioUrl} placeholder="https://github.com/…" hint="Optional reference for the report." />
          </div>
        </StepShell>
      ) : null}

      {step === 1 ? (
        <StepShell
          title="Add the target job"
          subtitle="The job description lets the panel focus on what this role actually requires. Add a URL, upload or paste — or just a title."
          footer={
            <>
              <button type="button" className="minimal-btn-outline" onClick={() => setStep(0)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </button>
              <button type="button" className="minimal-btn-primary disabled:opacity-40" disabled={!canAnalyze} onClick={() => void analyze()}>
                Analyse my profile <ArrowRight className="ml-2 h-4 w-4" />
              </button>
            </>
          }
        >
          <div className="grid gap-6 md:grid-cols-2">
            <TextField label="Target job title" value={targetTitle} onChange={setTargetTitle} placeholder="e.g. Senior Java Developer" />
            <TextField label="Company" value={companyName} onChange={setCompanyName} placeholder="e.g. Infosys" />
          </div>
          <div>
            <SectionLabel>Job posting URL</SectionLabel>
            <div className="mt-2 flex gap-3">
              <input
                type="url"
                inputMode="url"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://careers.example.com/jobs/123"
                className="minimal-input"
                aria-label="Job posting URL"
              />
              <button type="button" className="minimal-btn-outline shrink-0 px-4 disabled:opacity-40" disabled={!/^https?:\/\//i.test(jobUrl) || fetchingUrl} onClick={() => void fetchJobUrl()}>
                {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                <span className="ml-2">Import</span>
              </button>
            </div>
            {jobUrlNote ? <p className="mt-2 text-xs text-neutral-500">{jobUrlNote}</p> : null}
          </div>
          <DocumentInput
            label="Job description"
            text={jdText}
            onText={setJdText}
            fileName={jdFile}
            onFileName={setJdFile}
            placeholder="Upload or paste the job description…"
            onError={setError}
          />
          {!canAnalyze ? <p className="text-xs text-neutral-500">Add a resume, a job description, or at least a job title to continue.</p> : null}
        </StepShell>
      ) : null}

      {step === 2 ? <AnalysisProgress stage={stage} /> : null}

      {step === 3 && profile && config && recommended ? (
        <Recommendation
          analysis={profile.analysis_json}
          config={recommended}
          onBack={() => setStep(1)}
          onContinue={() => setStep(4)}
        />
      ) : null}

      {step === 4 && profile && config && recommended ? (
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr]">
          <Customize config={config} recommended={recommended} reasons={profile.analysis_json.recommendation_reasons ?? {}} onChange={setConfig} />
          <PrepBrief
            analysis={profile.analysis_json}
            config={config}
            panel={panel}
            plan={plan}
            starting={starting}
            onBack={() => setStep(3)}
            onStart={() => void start()}
          />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function StepShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-medium text-black dark:text-white">{title}</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{subtitle}</p>
      </div>
      {children}
      <div className="flex items-center justify-between gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">{footer}</div>
    </section>
  )
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <SectionLabel>{label}</SectionLabel>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="minimal-input mt-2" />
    </label>
  )
}

function UrlField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="block">
      <SectionLabel>{label}</SectionLabel>
      <input type="url" inputMode="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="minimal-input mt-2" />
      {hint ? <span className="mt-2 block text-xs text-neutral-500">{hint}</span> : null}
    </label>
  )
}

function DocumentInput({
  label,
  text,
  onText,
  fileName,
  onFileName,
  placeholder,
  onError,
}: {
  label: string
  text: string
  onText: (v: string) => void
  fileName: string | null
  onFileName: (v: string | null) => void
  placeholder: string
  onError: (msg: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const upload = async (file: File) => {
    onError(null)
    if (file.size > 4 * 1024 * 1024) {
      onError('That file is larger than 4 MB. Paste the text instead.')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await interviewApi<{ text: string; filename: string }>('/extract', { form })
      onText(r.text)
      onFileName(r.filename)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read that file')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        {fileName ? (
          <span className="inline-flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <FileText className="h-3.5 w-3.5" /> {fileName}
            <button
              type="button"
              aria-label={`Remove ${fileName}`}
              onClick={() => {
                onFileName(null)
                onText('')
              }}
              className="text-neutral-400 hover:text-black dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void upload(f)
        }}
        className={cn('mt-2 border border-dashed transition-colors', dragging ? 'border-black dark:border-white' : 'border-neutral-300 dark:border-neutral-700')}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-dashed border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-black hover:underline disabled:opacity-50 dark:text-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? 'Reading file…' : 'Upload PDF, DOCX or TXT'}
          </button>
          <span className="text-xs text-neutral-500">or drop a file here, or paste below</span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={placeholder}
          rows={9}
          aria-label={label}
          className="block w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed text-black outline-none placeholder:text-neutral-400 dark:text-white"
        />
      </div>
      {text ? <div className="mt-1 text-right text-[11px] text-neutral-400">{text.length.toLocaleString()} characters</div> : null}
    </div>
  )
}

function AnalysisProgress({ stage }: { stage: number }) {
  return (
    <section className="mx-auto max-w-xl py-10" aria-live="polite">
      <h2 className="text-xl font-medium text-black dark:text-white">Analysing your profile and target role…</h2>
      <p className="mt-2 text-sm text-neutral-500">This usually takes 10–25 seconds.</p>
      <ol className="mt-8 space-y-4">
        {ANALYSIS_STAGES.map((label, i) => (
          <li key={label} className={cn('flex items-center gap-3 text-sm transition-opacity', i > stage ? 'opacity-30' : 'opacity-100')}>
            {i < stage ? (
              <span className="flex h-5 w-5 items-center justify-center bg-black text-[10px] text-white dark:bg-white dark:text-black">✓</span>
            ) : i === stage ? (
              <Loader2 className="h-5 w-5 animate-spin text-black dark:text-white" />
            ) : (
              <span className="h-5 w-5 border border-neutral-300 dark:border-neutral-700" />
            )}
            <span className="text-black dark:text-white">{label}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Recommendation({ analysis, config, onBack, onContinue }: { analysis: ProfileAnalysis; config: InterviewConfig; onBack: () => void; onContinue: () => void }) {
  const reasons = analysis.recommendation_reasons ?? {}
  const c = analysis.candidate ?? {}
  const rows: Array<[string, string, string]> = [
    ['Target role', config.target_role, reasons.target_role ?? ''],
    ['Experience', `${labelOf(EXPERIENCE_OPTIONS, config.experience_level)}${config.years_experience != null ? ` · ${config.years_experience} yrs` : ''}`, reasons.experience_level ?? ''],
    ['Interview type', labelOf(TYPE_OPTIONS, config.interview_type), reasons.interview_type ?? ''],
    ['Interview level', labelOf(LEVEL_OPTIONS, config.interview_level), reasons.interview_level ?? ''],
    ['Difficulty', labelOf(DIFFICULTY_OPTIONS, config.difficulty), reasons.difficulty ?? ''],
    ['Duration', `${config.duration_min} minutes`, reasons.duration_min ?? ''],
    ['Style', labelOf(STYLE_OPTIONS, config.style), reasons.style ?? ''],
    ['Mode', labelOf(MODE_OPTIONS, config.mode), reasons.mode ?? ''],
  ]
  const matching = analysis.match?.matching_skills ?? []
  const missing = analysis.match?.missing_skills ?? []
  const claims = analysis.resume_claims ?? []

  return (
    <section className="space-y-10">
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="minimal-card space-y-6 !p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-black dark:text-white">Recommended interview</h2>
            <AiBadge />
          </div>
          <dl className="divide-y divide-neutral-100 dark:divide-neutral-900">
            {rows.map(([label, value, why]) => (
              <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 py-3">
                <dt className="text-xs uppercase tracking-wider text-neutral-500">{label}</dt>
                <dd>
                  <div className="text-sm font-medium text-black dark:text-white">{value}</div>
                  {why ? <div className="mt-0.5 text-xs text-neutral-500">{why}</div> : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-neutral-500">These are suggestions. You can change any of them in the next step.</p>
        </div>

        <div className="space-y-8">
          <div>
            <SectionLabel>What we detected</SectionLabel>
            <p className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{analysis.summary || 'Profile analysed.'}</p>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <Fact label="Current role" value={[c.current_role, c.current_company].filter(Boolean).join(' @ ') || '—'} />
              <Fact label="Experience" value={c.years_experience != null ? `${c.years_experience} years` : '—'} />
              {analysis.match?.match_score != null ? <Fact label="JD match" value={`${analysis.match.match_score}%`} /> : null}
              <Fact label="Claims to be probed" value={String(claims.length)} />
            </div>
          </div>
          {matching.length ? (
            <ChipGroup label="Matching skills">
              {matching.slice(0, 14).map((s) => (
                <Chip key={s} tone="good">{s}</Chip>
              ))}
            </ChipGroup>
          ) : null}
          {missing.length ? (
            <ChipGroup label="Missing for this job">
              {missing.slice(0, 12).map((s) => (
                <Chip key={s} tone="warn">{s}</Chip>
              ))}
            </ChipGroup>
          ) : null}
          {(analysis.weak_areas ?? []).length ? <BulletGroup label="Potential weak areas" items={analysis.weak_areas!} /> : null}
          {(analysis.career_gaps ?? []).length ? <BulletGroup label="Career gaps the panel may ask about" items={analysis.career_gaps!.map((g) => `${g.period}: ${g.note}`)} /> : null}
          {claims.length ? <BulletGroup label="Resume claims you may be cross-questioned on" items={claims.slice(0, 5).map((cl) => cl.claim)} /> : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <button type="button" className="minimal-btn-outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Edit inputs
        </button>
        <button type="button" className="minimal-btn-primary" onClick={onContinue}>
          Customize & prepare <ArrowRight className="ml-2 h-4 w-4" />
        </button>
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-black dark:text-white">{value}</div>
    </div>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function BulletGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ul className="mt-3 space-y-1.5 text-sm text-neutral-700 dark:text-neutral-300">
        {items.slice(0, 6).map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="text-neutral-400">—</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Customize({
  config,
  recommended,
  reasons,
  onChange,
}: {
  config: InterviewConfig
  recommended: InterviewConfig
  reasons: Record<string, string>
  onChange: (c: InterviewConfig) => void
}) {
  const set = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => onChange({ ...config, [key]: value })
  const [topic, setTopic] = useState('')

  const field = <K extends keyof InterviewConfig>(key: K, label: string, options: Option[], numeric = false) => (
    <SettingRow
      label={label}
      changed={String(config[key]) !== String(recommended[key])}
      onReset={() => set(key, recommended[key])}
      reason={reasons[key as string]}
    >
      <select
        value={String(config[key] ?? '')}
        onChange={(e) => set(key, (numeric ? Number(e.target.value) : e.target.value) as InterviewConfig[K])}
        className="minimal-input cursor-pointer"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </SettingRow>
  )

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-black dark:text-white">Customize</h2>
        <p className="mt-1 text-sm text-neutral-500">Everything is pre-filled from your profile. Change anything you like.</p>
      </div>

      <SettingRow label="Target role" changed={config.target_role !== recommended.target_role} onReset={() => set('target_role', recommended.target_role)} reason={reasons.target_role}>
        <input value={config.target_role} onChange={(e) => set('target_role', e.target.value)} className="minimal-input" aria-label="Target role" />
      </SettingRow>
      <div className="grid gap-6 sm:grid-cols-2">
        {field('experience_level', 'Experience level', EXPERIENCE_OPTIONS)}
        {field('interview_level', 'Interview level', LEVEL_OPTIONS)}
        {field('interview_type', 'Interview type', TYPE_OPTIONS)}
        {field('duration_min', 'Duration', DURATION_OPTIONS, true)}
        {field('difficulty', 'Difficulty', DIFFICULTY_OPTIONS)}
        {field('style', 'Interviewer style', STYLE_OPTIONS)}
      </div>

      <SettingRow label="Interview mode" changed={config.mode !== recommended.mode} onReset={() => set('mode', recommended.mode)} reason={reasons.mode}>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Interview mode">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={config.mode === m.value}
              onClick={() => set('mode', m.value)}
              className={cn(
                'border px-3 py-2.5 text-left transition-colors',
                config.mode === m.value ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black' : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800',
              )}
            >
              <div className="text-sm font-medium">{m.label}</div>
              <div className={cn('mt-0.5 text-xs', config.mode === m.value ? 'opacity-80' : 'text-neutral-500')}>{m.hint}</div>
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Challenge me more" changed={config.intensity !== recommended.intensity} onReset={() => set('intensity', recommended.intensity)}>
        <div className="mt-2 inline-flex border border-neutral-200 dark:border-neutral-800" role="radiogroup" aria-label="Interview intensity">
          {INTENSITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={config.intensity === o.value}
              onClick={() => set('intensity', o.value)}
              className={cn('px-3 py-2 text-xs font-semibold uppercase tracking-wider', config.intensity === o.value ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-neutral-500 hover:text-black dark:hover:text-white')}
            >
              {o.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <SectionLabel>Company</SectionLabel>
          <input value={config.company_name ?? ''} onChange={(e) => set('company_name', e.target.value || null)} className="minimal-input mt-2" placeholder="Optional" />
        </label>
        <label className="block">
          <SectionLabel>Years of experience</SectionLabel>
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={config.years_experience ?? ''}
            onChange={(e) => set('years_experience', e.target.value === '' ? null : Number(e.target.value))}
            className="minimal-input mt-2"
          />
        </label>
      </div>

      <div>
        <SectionLabel>Extra topics to focus on</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2">
          {config.focus_topics.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 bg-black px-2 py-1 text-xs text-white dark:bg-white dark:text-black">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => set('focus_topics', config.focus_topics.filter((x) => x !== t))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-2 flex gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const v = topic.trim()
            if (v && !config.focus_topics.includes(v) && config.focus_topics.length < 8) set('focus_topics', [...config.focus_topics, v])
            setTopic('')
          }}
        >
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Kafka, stakeholder conflicts" className="minimal-input" aria-label="Add a focus topic" />
          <button type="submit" className="minimal-btn-outline shrink-0 px-4 py-2">
            Add
          </button>
        </form>
      </div>
    </section>
  )
}

function SettingRow({ label, changed, onReset, reason, children }: { label: string; changed: boolean; onReset: () => void; reason?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        <AiBadge changed={changed} onReset={onReset} />
      </div>
      <div className="mt-1">{children}</div>
      {reason && !changed ? <p className="mt-1.5 text-xs text-neutral-500">{reason}</p> : null}
    </div>
  )
}

function PrepBrief({
  analysis,
  config,
  panel,
  plan,
  starting,
  onBack,
  onStart,
}: {
  analysis: ProfileAnalysis
  config: InterviewConfig
  panel: Panelist[]
  plan: Round[]
  starting: boolean
  onBack: () => void
  onStart: () => void
}) {
  const focus = useMemo(() => Array.from(new Set([...config.focus_topics, ...(analysis.focus_areas ?? [])])).slice(0, 8), [analysis.focus_areas, config.focus_topics])
  const detected = useMemo(() => Array.from(new Set([...(analysis.deep_dive_areas ?? []), ...(analysis.weak_areas ?? [])])).slice(0, 5), [analysis.deep_dive_areas, analysis.weak_areas])

  return (
    <aside className="self-start border border-neutral-200 p-6 dark:border-neutral-800 lg:sticky lg:top-24">
      <SectionLabel>Your interview preparation</SectionLabel>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Fact label="Target role" value={config.target_role} />
        <Fact label="Experience" value={`${labelOf(EXPERIENCE_OPTIONS, config.experience_level)}${config.years_experience != null ? ` · ${config.years_experience} yrs` : ''}`} />
        {config.company_name ? <Fact label="Company" value={config.company_name} /> : null}
        <Fact label="Interview" value={`${labelOf(TYPE_OPTIONS, config.interview_type)} · ${config.duration_min} min`} />
        <Fact label="Level" value={labelOf(LEVEL_OPTIONS, config.interview_level)} />
        <Fact label="Difficulty" value={labelOf(DIFFICULTY_OPTIONS, config.difficulty)} />
      </dl>

      {focus.length ? (
        <div className="mt-6">
          <SectionLabel>What we will focus on</SectionLabel>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
            {focus.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {detected.length ? (
        <div className="mt-6">
          <SectionLabel>Detected from your profile</SectionLabel>
          <ul className="mt-2 space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
            {detected.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6">
        <SectionLabel>Interview panel</SectionLabel>
        <div className="mt-3 space-y-3">
          {panel.map((p) => (
            <PanelistRow key={p.id} panelist={p} />
          ))}
        </div>
      </div>

      {plan.length ? (
        <div className="mt-6">
          <SectionLabel>Interview flow</SectionLabel>
          <ol className="mt-2 space-y-1 text-sm">
            {plan.map((r, i) => (
              <li key={r.id} className="flex justify-between gap-3 text-neutral-700 dark:text-neutral-300">
                <span>
                  {i + 1}. {r.label}
                </span>
                <span className="tabular-nums text-neutral-400">{Math.max(1, Math.round((r.end_sec - r.start_sec) / 60))} min</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="mt-6 text-xs leading-relaxed text-neutral-500">
        Use Chrome or Edge with a microphone for the voice interview — you can also type answers. You'll check your mic and camera first; joining the call uses one interview from your monthly allowance.
      </p>
      <div className="mt-4 flex gap-3">
        <button type="button" className="minimal-btn-outline px-4" onClick={onBack} aria-label="Back to recommendation">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" className="minimal-btn-primary flex-1 disabled:opacity-50" disabled={starting || !panel.length} onClick={onStart}>
          {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Enter interview room
        </button>
      </div>
    </aside>
  )
}
