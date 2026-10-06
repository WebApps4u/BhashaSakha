# Interview Simulator — Analysis & Proposal

Status: **approved 2026-10-06** — Phase 1 in progress.

---

## 1. What exists today

### 1.1 The current "Interview" section is a transcription mode, not a mock interview

`/live/interview` is defined in `src/lib/liveSections.ts` as *"Interview Transcription — capture interviews and meetings with translated captions and speaker labels."* It renders the same `Live.tsx` workspace as General. The only difference is that `session_mode = 'interview'` is written to `public.sessions`. There is no interview-specific UI, prompt, table or API anywhere in the codebase (7 references in total, all labels/types).

Production usage (read-only count, 2026-10-06):

| session_mode | sessions |
|---|---|
| general | 179 |
| banking | 16 |
| interview | **1** |

**Implication:** the requested simulator is a new product area, not a redesign of an existing feature. Replacing the current Interview section is low-risk; the single legacy session stays viewable at `/session/:id` because `Session.tsx` handles any mode generically.

### 1.2 Reusable platform pieces

| Piece | Where | Reuse for the simulator | Gap |
|---|---|---|---|
| Speech-to-text | `src/hooks/useSpeechCaptions.ts` (browser Web Speech API, auto-restart, mic level meter) | Candidate voice answers, "speaking" indicator on the candidate tile | Flushes after **1.2 s** of silence, which suits captions but not "candidate finished answering". **Keeps no audio**, so replay (#10) is impossible as-is. Chrome/Edge only; Firefox unsupported. Chrome's recognizer usually **drops filler words**, which matters for mistake detection (#13). |
| Text-to-speech | `server/routes/tts.ts` + `src/utils/tts.ts` (Gemini TTS → Google Cloud TTS → browser fallback; storage cache; style prompts behind a feature flag) | Interviewer voices; style prompt per persona ("calm, warm HR manager") | Gemini voice is **one fixed voice** from `GEMINI_TTS_VOICE_NAME`, so panel members would all sound the same. **TTS is not metered**: it calls Gemini with the env key, bypassing quotas. |
| LLM gateway | `server/lib/aiModelLayer.ts` → `runModelRequest()` (model routing, provider fallback, encrypted provider keys, per-plan quotas, usage events, downgrade on quota exhaustion) | Every simulator AI call: analysis, interviewer turns, evaluation | Single text prompt only (no files, no multi-turn, no system instruction). **`temperature: 0` hardcoded**, so an interviewer would phrase things identically every time. JSON output forced on `v1beta`, which is fine for us. 35 s timeout. |
| Structured extraction pattern | `server/routes/caseForm.ts` (banking) | Template: prompt → `runModelRequest` → `output_json` → insert row | — |
| Plans & entitlements | `ai_models`, `ai_plan_entitlements`, admin UI at `/admin/ai/*` | New `interview_*` model ids with per-plan monthly limits, tunable by admin without code | — |
| Auth, RLS, storage | Supabase; owner-only RLS policies; private buckets `tts-cache`, `session-exports` | Same conventions for new tables and an `interview-audio` bucket | — |
| Export | `src/utils/exporters.ts` | — | TXT/VTT only. **No PDF capability.** |
| i18n | `react-i18next`, Hindi voices in TTS | Hindi/Hinglish interviews (Phase 3) | — |

### 1.3 Hosting constraints (Vercel serverless via `api/index.ts`)

- Request body limit ~4.5 MB, which is fine for resumes and JDs; uploads are capped at 4 MB.
- Each AI call must finish within the gateway's 35 s timeout, so evaluation is split into parallel per-question calls rather than one giant call.
- No persistent WebSockets. That rules out a real-time duplex voice model (for example Gemini Live) in this architecture for now. See §9.

---

## 2. Product shape

The simulator becomes its own top-level area, **`/interview`**. The section switcher's "Interview" entry and the old `/live/interview` URL both redirect there. General and Banking are untouched.

```
/interview                  Home: start new · history & trend · quick practice modes
/interview/new              Guided setup wizard (steps 1–5)
/interview/:id/room         Pre-join device check → live interview room
/interview/:id/review       Replay + question-by-question feedback
/interview/:id/report       Scorecard · readiness · mistakes · plan · Save as PDF
```

### 2.1 Guided flow (spec #23)

| Step | Screen | Notes |
|---|---|---|
| 1 | **Your profile** | Resume upload (PDF/DOCX/TXT) or paste; LinkedIn URL; portfolio/GitHub URL |
| 2 | **Target job** | JD upload or paste; job posting URL; company; target title |
| 3 | **Analysis** | Progress states ("Reading your resume… Matching against the JD…"). One AI call. |
| 4 | **Recommended interview** | Every field shows an **"AI recommended"** badge plus a one-line reason ("8 yrs, leads a team of 5 → Senior / Advanced"). |
| 5 | **Customize + preparation brief** | Every field editable, with "Reset to recommended". The brief shows focus areas, detected strengths and gaps, and the panel with names, roles and avatars. |
| 6–7 | **Interview room** | Device check, then the live adaptive voice interview |
| 8 | **Review** | Replay, transcript, per-question feedback, stronger answer |
| 9 | **Report** | Scorecard, readiness, mistakes with evidence, PDF |
| 10–11 | **Improve / practice again** | Plan with one-click targeted sessions; comparison against previous sessions |

Settings never appear on one giant screen. Step 4 shows the recommendation as a summary card, and step 5 expands only the field the candidate taps.

### 2.2 Interview room (spec #1)

```
┌──────────────────────────────────────────────────────────────────┐
│ ● Connected   Senior Java Developer · Technical + Managerial      │
│ Round 4 of 8 · Deep dive          Q 6       ⏱ 14:32 / 30:00       │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  Priya S.  │  │  Arjun M.  │  │  David K.  │  │    You     │  │
│  │  HR Mgr    │  │ Eng Mgr    │  │ Principal  │  │ (camera or │  │
│  │            │  │ ◉ ASKING   │  │            │  │  initials) │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│ Arjun: "You mentioned migrating to microservices — why not keep   │
│ the monolith and modularise it?"                                  │
│ You (live): "So the main driver was deployment independence…"     │
├──────────────────────────────────────────────────────────────────┤
│   🎤 Mic   📷 Camera   🔊 Speaker   [ Done answering ]   ⌨ Type    │
│                                                   [ End interview ]│
└──────────────────────────────────────────────────────────────────┘
```

- **Panelist tiles** show an illustrated avatar, name and role. A speaking ring animates with TTS playback, an "Asking" badge marks the current interviewer, and a subtle "thinking" state shows while the next question is generated.
- **Candidate tile:** the camera is a **local preview only, never uploaded or recorded**, for realism and posture self-check. A mic-level ring shows when the candidate is speaking.
- **Controls:** mic, camera, speaker, **Done answering** (also bound to the Space key), text fallback, End interview. No chat, reactions, screen share or participant list.
- **Top bar:** connection status, interview title, round and question progress, timer against the duration.
- **Handoffs between panelists are spoken** ("I'll hand over to David for some architecture questions."), so the panel feels like people rather than a carousel.

---

## 3. Architecture

### 3.1 Overview

```
Browser                                       Server (/api/interview/*)            Supabase
───────                                       ────────────────────────────         ────────
Setup wizard ── upload/paste/URL ───────────► extract text (pdf/docx) · fetch URL
             ── analyze ────────────────────► runModelRequest(interview_pro) ────► interview_profiles
Room
 useInterviewSession (state machine)
 useTurnTaking (STT + end-of-turn)
 useAnswerRecorder (MediaRecorder)  ── audio ─────────────────────────────────────► storage: interview-audio
 usePanelVoice (TTS per persona) ◄─ /api/tts (voice param) 
             ── candidate answer ───────────► director: runModelRequest(interview_lite) ► interview_turns
             ◄─ next move (persona, utterance, round, rationale)
End          ── complete ───────────────────► evaluate per question (parallel) ──────► interview_feedback
                                              compute delivery metrics (deterministic)  interview_sessions.report_json
Review/Report ◄────────────────────────────── GET session + turns + feedback
```

### 3.2 State machine (client)

`lobby → intro → interviewer_speaking → candidate_turn → thinking → interviewer_speaking … → wrap_up → ended → evaluating → review`

Each transition persists, so a refresh or dropped connection resumes the session instead of losing it.

### 3.3 The adaptive "interview director" (spec #6, #18, #19)

There is **no fixed question list.** Each candidate answer produces one director call that returns the next move:

```json
{
  "action": "follow_up | probe_resume_claim | next_topic | handoff | challenge | wrap_up",
  "persona_id": "eng_manager",
  "utterance": "Why did you choose synchronous calls between those two services?",
  "round": "deep_dive",
  "difficulty": 3,
  "thread_id": "t4",
  "rationale": "Candidate said services call each other directly; probing failure handling.",
  "resume_claim_ref": "claim_7",
  "practice_tip": null
}
```

Inputs to each director call:

- profile summary, config, panel personas
- the round plan with the time budget left
- the last ~6 turns verbatim plus a rolling summary of earlier turns
- the ledger of resume claims (probed and unprobed)
- the latest answer

Prompt size stays constant regardless of interview length.

Rules, enforced partly in the prompt and partly in code:

- **Round progression:** intro → resume → basic → role-specific → scenario → deep dive → behavioral/leadership → final challenge. The duration is split across rounds, and code forces `wrap_up` when time is up.
- **Depth control:** a thread is capped at 3 follow-ups, so the interviewer digs in but never loops.
- **Adaptive difficulty:** a strong answer steps difficulty up; a weak one steps down or probes fundamentals.
- **Resume cross-questioning:** claims are extracted once at analysis time (for example *"Implemented microservices architecture"*). The director is steered to probe high-value unprobed claims.
- **Mode behaviour:**

  | Mode | Behaviour |
  |---|---|
  | Practice | `practice_tip` shown briefly after each answer |
  | Simulation | No feedback until the end |
  | Stress | `challenge` actions; interrupts answers longer than ~2.5 min |
  | Technical deep dive | Mostly technical threads with deep follow-ups |
  | Final round | Mixed panel: HR, technical and managerial |

- **Style** (friendly → executive) and intensity ("Challenge me more") are parameters on persona tone.

### 3.4 Personas & panel selection (spec #7)

Personas are a **catalog in code**: HR/Recruiter, Technical Interviewer, Hiring Manager, Senior/Principal Engineer, Domain Expert, Product Leader, Data Lead. Each defines:

- focus areas
- question style
- TTS voice plus style prompt
- avatar
- name pool

**Panel selection is deterministic** (a table keyed on interview type × role family × seniority), so it's predictable and explainable in the brief. The AI only suggests a domain-expert specialisation, for example "Payments domain expert".

### 3.5 Turn-taking & latency (spec #9)

Each turn costs about 1.5–2.5 s for end-of-speech detection, 2–5 s for the director, and 1–3 s for TTS. That is **5–10 s of dead air**, which would break the realism. Mitigations:

1. **End-of-turn detection:** silence of at least 2.5 s after at least 8 words, plus the explicit **Done answering** button. Short pauses mid-answer don't cut the candidate off.
2. **Instant acknowledgements:** pre-synthesised, cached clips per persona ("Okay.", "Right, thanks.", "Interesting.") play the moment the answer ends, while the director call runs.
3. A **"thinking" animation** on the asking panelist's tile.
4. The director uses the fast `interview_lite` model; analysis and evaluation use `interview_pro`.
5. **Text fallback** is always available, and becomes automatic when Web Speech isn't supported.

### 3.6 Evaluation that cannot invent evidence (spec #11–#16)

- **Content judgement comes from the LLM.** Every finding must cite `evidence: [{turn_id, quote}]`. The **server verifies that each quote actually occurs in that turn's transcript** and drops ungrounded findings. This is what keeps scores "evidence-based, not arbitrary".
- **Delivery metrics are computed in code, not by the LLM:** words per minute, answer duration, longest pause, filler-word count, repetition, and answer length against the round norm.
- **Mistakes** (#13) are emitted as `{type, evidence, why_it_matters, how_to_improve}` from a fixed taxonomy: rambling, off-question, generic, no example, no metric, overclaiming, resume contradiction, and so on.
- **"A stronger answer"** (#12) is generated from the candidate's own answer plus resume and JD. It is **forbidden to invent achievements or numbers not present in the resume**. Missing data appears as placeholders such as `[your latency improvement %]`, so the candidate is never coached to fabricate.
- **Readiness** (#15) is a documented weighted formula over dimension scores. It is shown with the **single biggest risk** and the action plan.
- Evaluation runs as **one call per question thread, in parallel**, plus one summary call. That keeps each call under the 35 s timeout.

### 3.7 Inputs, URLs and company info (spec #2, #17)

- **Resume/JD files:** text is extracted server-side. `unpdf` handles PDF (serverless-safe) and `mammoth` handles DOCX. These are the only new dependencies.
- **Job posting URL:** fetched server-side on a best-effort basis, with SSRF protection: http(s) only, private IP ranges blocked, size and time caps. If the fetch fails, the candidate is asked to paste the JD.
- **LinkedIn URL:** **not scraped**. LinkedIn pages sit behind a login wall and scraping violates their terms. The URL is stored for the report, and the candidate is offered "Upload your LinkedIn PDF export" instead.
- **Company-specific prep** (#17) needs a real source. The current gateway has no web search or grounding, so Phase 3 adds Gemini Google-Search grounding. Output is split into **"Verified (with source links)"** and **"AI preparation assumptions"**. Until then, company prep is shown only as clearly labelled assumptions.

---

## 4. Data model (new; all owner-only RLS)

```sql
interview_profiles   -- reusable across sessions (enables re-interview loop)
  id, owner_id, resume_text, resume_file_path, jd_text, job_url, linkedin_url,
  portfolio_url, company_name, target_title,
  analysis_json   -- experience, roles, skills, matches, gaps, seniority, claims[],
                  -- focus areas, predicted questions, story-bank seeds
  created_at, updated_at

interview_sessions
  id, owner_id, profile_id, parent_session_id,  -- parent = "practice my weak areas" lineage
  recommended_config_json,  -- what AI suggested + reasons
  config_json,              -- what the candidate chose
  panel_json, round_plan_json,
  status  -- setup | live | evaluating | completed | abandoned
  started_at, ended_at, duration_ms,
  scores_json, readiness, report_json, created_at

interview_turns
  id, session_id, seq, speaker  -- interviewer | candidate
  persona_id, action, round, difficulty, thread_id, resume_claim_ref,
  text, rationale, audio_path, started_ms, ended_ms,
  metrics_json  -- wpm, duration, pauses, fillers (candidate turns)
  created_at

interview_feedback
  id, session_id, thread_id, question_turn_id, answer_turn_ids[],
  feedback_json  -- did_well[], missing[], mistakes[], better_approach,
                 -- stronger_answer, why_stronger[], star_coverage, dimension_scores
  created_at
```

- **Storage:** a private bucket `interview-audio` at `{owner_id}/{session_id}/{turn_id}.webm`. Deleting a session deletes its audio.
- **Model ids:** `interview_lite` (director, fast) and `interview_pro` (analysis and evaluation) are added to `ai_models`, with `ai_plan_entitlements` per plan. Admins can tune both in the existing `/admin/ai/*` screens.
- The `sessions.session_mode` check constraint keeps `'interview'` so the legacy row stays valid.

## 5. API (new `server/routes/interview.ts`, mounted at `/api/interview`)

| Method | Path | Purpose | AI calls |
|---|---|---|---|
| POST | `/extract` | Upload file → text | 0 |
| POST | `/fetch-url` | Job URL → readable text | 0 |
| POST | `/profiles/analyze` | Profile + JD → analysis, recommended config with reasons, panel, focus areas | 1 × pro |
| POST | `/sessions` | Create session from profile + final config | 0 |
| POST | `/sessions/:id/turns` | Candidate answer → persist → director → next move | 1 × lite |
| POST | `/sessions/:id/audio` | Signed upload URL for a turn's audio | 0 |
| POST | `/sessions/:id/complete` | Metrics + per-thread evaluation + summary + readiness + plan | ~6–12 × pro (parallel) |
| GET | `/sessions`, `/sessions/:id` | History, review and report data | 0 |
| POST | `/sessions/:id/practice-next` | New targeted session from weak areas | 0 |

Backward-compatible changes to existing code:

- `runModelRequest` gains optional `temperature`. The default stays 0, so translate and banking behaviour is unchanged.
- `/api/tts` gains an optional whitelisted `voice` parameter. When it's absent, the env voice is used as today.

**Cost per interview:** a 30-minute interview takes roughly **25–35 model calls** and about **15–20 unique TTS syntheses**. Question audio is unique, so the TTS cache rarely helps.

---

## 6. Phasing

The spec covers months of work if built at once. Each phase below ships a complete, usable loop.

### Phase 1: core simulator

This phase answers the product question: *"Will I know exactly what to improve?"*

- DB tables, RLS, `interview_*` model ids and entitlements. Gateway `temperature`; TTS `voice`.
- Wizard steps 1–5: upload/paste, job URL fetch, analysis, AI-recommended settings with reasons, customise, preparation brief with panel.
- Interview room: panel and candidate tiles, controls, timer, progress, connection status, device check.
- Adaptive director: rounds, follow-ups, resume cross-questioning, adaptive difficulty, all five modes and styles, intensity.
- Voice-first turn-taking with text fallback; full transcript persisted; resume after refresh.
- Post-interview: per-question feedback, evidence-backed mistakes, stronger answer, scorecard, readiness with biggest risk, improvement plan.
- `/interview` home with history list. `/live/interview` redirects to it.

### Phase 2: replay & progress

- Per-turn audio recording (with consent) and a replay player: jump to question, hear the question and the candidate's own answer.
- Server re-transcription of recorded answers for accurate filler-word and pause analysis.
- History comparison and readiness trend; "Practice my weak areas" targeted sessions with parent linkage.
- Interview report as PDF, using a print-optimised report view and the browser's Save as PDF. No heavy PDF dependency.
- Metering for TTS.

### Phase 3: coaching extras

- Predicted questions with practice, story bank, STAR story builder, 60-second intro coach, HR/salary round.
- Company-specific prep with search grounding, labelled verified vs. assumed.
- Hindi/Hinglish interviews.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Dead air between turns kills realism | Instant acknowledgement clips, thinking state, fast model, end-of-turn tuning (§3.5) |
| Voice only works in Chrome/Edge | Automatic text fallback; Phase 2 server transcription |
| Cost: ~30 AI calls plus unmetered TTS per interview | Separate `interview_*` entitlements; admin-tunable plan limits; TTS metering in Phase 2 |
| Hallucinated feedback | Server-verified evidence quotes; metrics computed in code |
| Coaching candidates to fabricate | Stronger answers limited to resume facts, with placeholders |
| PII (resumes) and voice recordings | Owner-only RLS, private bucket, explicit consent before recording, delete cascades to audio, LinkedIn not scraped |
| 35 s per-call timeout | Parallel per-thread evaluation; compact rolling context |

## 8. What is preserved

- General and Banking sections are unchanged.
- The legacy interview transcription session stays readable.
- Shared modules (speech hook, TTS, model gateway, metering, admin AI routing) are reused and extended only in backward-compatible ways.

## 9. Not proposed (and why)

- **Real-time duplex voice** (Gemini Live / OpenAI Realtime): it would remove most latency, but needs persistent WebSockets or direct client connections with ephemeral tokens. That's a larger architecture change than Vercel serverless supports today. It's worth revisiting after Phase 1 proves the product.
- **Photorealistic video avatars** for interviewers: costly third-party services and uncanny results. Illustrated avatars with speaking animation give most of the realism.
- **Recording candidate video:** it adds privacy burden without a matching coaching benefit. The camera stays a local preview only.

## 10. Decisions (2026-10-06)

1. **Placement:** replace the Interview section with `/interview`; `/live/interview` redirects there.
2. **Phase 1 scope:** as proposed in §6.
3. **Quota:** Free 2 interviews/month, Pro 30. Admin-tunable in `/admin/ai/entitlements`.
4. **Answer audio:** opt-in recording with consent per interview (Phase 2).
