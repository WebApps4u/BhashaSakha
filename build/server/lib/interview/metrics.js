// Deterministic, measurable parts of interview evaluation.
// The LLM judges content; everything that can be measured is computed here so scores stay evidence-based.
// "like" is excluded: too often a real verb ("I like Java").
const FILLER_PATTERN = /\b(um+|uh+|erm+|hmm+|you know|i mean|basically|actually|literally|sort of|kind of)\b/gi;
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const toNullableMs = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n < 60 * 60 * 1000 ? Math.round(n) : null;
};
export const computeAnswerMetrics = (text, client) => {
    const tokens = words(text);
    const wordCount = tokens.length;
    const durationMs = toNullableMs(client.duration_ms);
    const fillers = {};
    for (const m of text.matchAll(FILLER_PATTERN)) {
        const key = m[0].toLowerCase();
        fillers[key] = (fillers[key] ?? 0) + 1;
    }
    const fillerCount = Object.values(fillers).reduce((a, b) => a + b, 0);
    // Share of repeated word trigrams: high values indicate going round in circles.
    const trigrams = new Map();
    for (let i = 0; i + 2 < tokens.length; i++) {
        const key = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
        trigrams.set(key, (trigrams.get(key) ?? 0) + 1);
    }
    const totalTrigrams = Math.max(0, tokens.length - 2);
    const repeated = Array.from(trigrams.values()).reduce((sum, c) => sum + (c > 1 ? c - 1 : 0), 0);
    return {
        word_count: wordCount,
        duration_ms: durationMs,
        wpm: durationMs && durationMs > 5000 ? Math.round(wordCount / (durationMs / 60000)) : null,
        filler_count: fillerCount,
        fillers,
        filler_per_100: wordCount ? Math.round((fillerCount / wordCount) * 1000) / 10 : 0,
        repetition_ratio: totalTrigrams ? Math.round((repeated / totalTrigrams) * 100) / 100 : 0,
        latency_ms: toNullableMs(client.latency_ms),
        longest_pause_ms: toNullableMs(client.longest_pause_ms),
        interrupted: client.interrupted === true,
    };
};
// ---------------------------------------------------------------------------
// Evidence verification: a finding survives only if its quote really occurs in the cited candidate turn.
// ---------------------------------------------------------------------------
const normalize = (s) => s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const quoteOccursIn = (quote, source) => {
    const q = normalize(quote);
    const src = normalize(source);
    if (!q || q.length < 3)
        return false;
    if (src.includes(q))
        return true;
    // Tolerate small transcription/punctuation differences: ≥ 80% of quote tokens in order inside a window.
    const qt = q.split(' ');
    const st = src.split(' ');
    if (qt.length < 3)
        return false;
    const window = qt.length + 2;
    for (let start = 0; start + Math.min(window, st.length) <= st.length; start++) {
        const slice = st.slice(start, start + window);
        let matched = 0;
        let j = 0;
        for (const token of qt) {
            const found = slice.indexOf(token, j);
            if (found !== -1) {
                matched++;
                j = found + 1;
            }
        }
        if (matched / qt.length >= 0.8)
            return true;
    }
    return false;
};
/** Keeps only evidence whose quote is found in the referenced candidate turn. */
export const verifyEvidence = (evidence, candidateTurnsByRef) => {
    if (!Array.isArray(evidence))
        return [];
    return evidence
        .map((e) => ({ turn: String(e?.turn ?? '').trim().toUpperCase(), quote: String(e?.quote ?? '').trim().slice(0, 240) }))
        .filter((e) => {
        const source = candidateTurnsByRef.get(e.turn);
        return !!source && quoteOccursIn(e.quote, source);
    });
};
export const measuredMistakes = (answers) => {
    const out = [];
    for (const { ref, metrics: m } of answers) {
        if (!m)
            continue;
        if (m.filler_count >= 4 && m.filler_per_100 >= 4) {
            const top = Object.entries(m.fillers)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([w, c]) => `"${w}" ×${c}`)
                .join(', ');
            out.push({
                type: 'filler_words',
                what_happened: `${m.filler_count} filler words in ${m.word_count} words (${top}) in ${ref}.`,
                evidence: [],
                why_it_matters: 'Frequent fillers make answers sound less confident and harder to follow.',
                how_to_improve: 'Pause silently instead of filling the gap; a short pause sounds more deliberate than "basically".',
                measured: true,
            });
        }
        if (m.latency_ms != null && m.latency_ms > 10000) {
            out.push({
                type: 'long_pause',
                what_happened: `About ${Math.round(m.latency_ms / 1000)}s passed before you started answering ${ref}.`,
                evidence: [],
                why_it_matters: 'Long silences before answering can read as uncertainty.',
                how_to_improve: 'Buy thinking time out loud: "Good question, let me think about the trade-offs for a second."',
                measured: true,
            });
        }
        else if (m.longest_pause_ms != null && m.longest_pause_ms > 8000) {
            out.push({
                type: 'long_pause',
                what_happened: `A ${Math.round(m.longest_pause_ms / 1000)}s pause in the middle of ${ref}.`,
                evidence: [],
                why_it_matters: 'Long mid-answer pauses break the flow and can suggest you lost track.',
                how_to_improve: 'Structure the answer up front ("three points…") so you always know what comes next.',
                measured: true,
            });
        }
        if (m.repetition_ratio >= 0.12 && m.word_count >= 80) {
            out.push({
                type: 'repetition',
                what_happened: `About ${Math.round(m.repetition_ratio * 100)}% of phrases in ${ref} were repeated.`,
                evidence: [],
                why_it_matters: 'Repeating the same point uses time without adding information.',
                how_to_improve: 'Make each point once, then move on or ask whether they want more detail.',
                measured: true,
            });
        }
    }
    return out;
};
// ---------------------------------------------------------------------------
// Scoring and readiness
// ---------------------------------------------------------------------------
export const DIMENSIONS = [
    'communication',
    'relevance',
    'structure',
    'technical',
    'problem_solving',
    'confidence',
    'clarity',
    'specificity',
    'leadership',
    'domain',
    'role_alignment',
    'star_usage',
];
export const normalizeScores = (raw) => {
    const out = {};
    for (const d of DIMENSIONS) {
        const n = Number(raw?.[d]);
        if (raw?.[d] != null && Number.isFinite(n))
            out[d] = Math.min(5, Math.max(1, Math.round(n)));
    }
    return out;
};
const to100 = (score1to5) => Math.round(((score1to5 - 1) / 4) * 100);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
/** 0–100 from measurable delivery signals (voice answers only for pace and latency). */
export const deliveryScore = (metrics) => {
    if (!metrics.length)
        return null;
    const perAnswer = metrics.map((m) => {
        const parts = [];
        if (m.wpm != null)
            parts.push(m.wpm >= 110 && m.wpm <= 170 ? 100 : m.wpm < 110 ? Math.max(50, 100 - (110 - m.wpm) * 1.7) : Math.max(50, 100 - (m.wpm - 170) * 1.25));
        parts.push(m.word_count < 25 ? 40 : m.word_count > 350 ? 60 : 100);
        parts.push(m.filler_per_100 <= 2 ? 100 : m.filler_per_100 <= 6 ? 80 : 55);
        if (m.latency_ms != null)
            parts.push(m.latency_ms <= 5000 ? 100 : m.latency_ms <= 10000 ? 80 : 60);
        return mean(parts) ?? 0;
    });
    return Math.round(mean(perAnswer) ?? 0);
};
export const CATEGORY_LABELS = {
    technical: 'Technical',
    communication: 'Communication',
    behavioral: 'Behavioral',
    role_alignment: 'Role alignment',
    delivery: 'Confidence & delivery',
};
const CATEGORY_DIMENSIONS = {
    technical: ['technical', 'problem_solving', 'domain'],
    communication: ['communication', 'clarity', 'structure'],
    behavioral: ['star_usage', 'leadership', 'specificity'],
    role_alignment: ['role_alignment', 'relevance'],
};
const WEIGHTS = {
    technical: { technical: 0.4, communication: 0.2, behavioral: 0.1, role_alignment: 0.15, delivery: 0.15 },
    people: { technical: 0.05, communication: 0.3, behavioral: 0.3, role_alignment: 0.2, delivery: 0.15 },
    managerial: { technical: 0.1, communication: 0.25, behavioral: 0.3, role_alignment: 0.2, delivery: 0.15 },
    case: { technical: 0.25, communication: 0.25, behavioral: 0.1, role_alignment: 0.2, delivery: 0.2 },
    mixed: { technical: 0.25, communication: 0.2, behavioral: 0.2, role_alignment: 0.2, delivery: 0.15 },
};
const weightProfile = (type) => {
    if (type === 'technical' || type === 'coding' || type === 'system_design' || type === 'domain')
        return WEIGHTS.technical;
    if (type === 'hr' || type === 'behavioral')
        return WEIGHTS.people;
    if (type === 'managerial')
        return WEIGHTS.managerial;
    if (type === 'case_study')
        return WEIGHTS.case;
    return WEIGHTS.mixed;
};
/**
 * Readiness = weighted mean of category scores (weights depend on interview type),
 * renormalised over the categories that could actually be assessed.
 */
export const computeScorecard = ({ threadScores, answerMetrics, interviewType, answeredThreads, }) => {
    const dimensions = {};
    for (const d of DIMENSIONS) {
        const avg = mean(threadScores.map((s) => s[d]).filter((v) => typeof v === 'number'));
        if (avg != null)
            dimensions[d] = to100(avg);
    }
    const delivery = deliveryScore(answerMetrics);
    const categories = {};
    for (const [cat, dims] of Object.entries(CATEGORY_DIMENSIONS)) {
        const avg = mean(dims.map((d) => dimensions[d]).filter((v) => typeof v === 'number'));
        if (avg != null)
            categories[cat] = Math.round(avg);
    }
    const confidence = dimensions.confidence;
    const deliveryParts = [confidence, delivery].filter((v) => typeof v === 'number');
    if (deliveryParts.length)
        categories.delivery = Math.round(mean(deliveryParts));
    const weights = weightProfile(interviewType);
    let weighted = 0;
    let weightSum = 0;
    for (const [cat, value] of Object.entries(categories)) {
        weighted += value * weights[cat];
        weightSum += weights[cat];
    }
    return {
        dimensions,
        categories,
        delivery_score: delivery,
        readiness: weightSum ? Math.round(weighted / weightSum) : null,
        low_confidence: answeredThreads < 3,
        weights,
    };
};
// ---------------------------------------------------------------------------
// Borrowed-metric guard for "stronger answers"
// ---------------------------------------------------------------------------
const CAUSE_MARKER = /\b(with|by|using|through|via|leveraging|after)\b/i;
const GENERIC_WORDS = new Set(['the', 'and', 'for', 'from', 'into', 'across', 'which', 'that', 'this', 'their', 'other', 'more', 'than', 'over', 'team', 'teams']);
const metricTokens = (text) => (text.match(/\d[\d,.]*\s*(%|ms|s|x|k|m|cr|crore|lakh|million|billion)?\b/gi) ?? [])
    .map((m) => m.replace(/[\s,]/g, '').toLowerCase())
    .filter((m) => /\d{2,}|%/.test(m));
/**
 * Models like to "show impact" by attaching a resume metric to an unrelated decision
 * (e.g. crediting a Redis-caching latency win to a Kafka design). If a sentence reuses a
 * resume number but none of that achievement's stated cause, it is replaced with a placeholder.
 */
export const guardBorrowedMetrics = (answer, resumeText) => {
    if (!answer || !resumeText)
        return { text: answer, replaced: 0 };
    const facts = resumeText
        .split(/\n|;|•|(?<=\.)\s+/)
        .map((line) => {
        const metrics = metricTokens(line);
        const marker = line.search(CAUSE_MARKER);
        const cause = marker >= 0
            ? (line.slice(marker).toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !GENERIC_WORDS.has(w) && !CAUSE_MARKER.test(w))
            : [];
        return { metrics, cause };
    })
        .filter((f) => f.metrics.length && f.cause.length);
    if (!facts.length)
        return { text: answer, replaced: 0 };
    let replaced = 0;
    const sentences = answer.split(/(?<=[.!?])\s+/);
    const out = sentences.map((sentence) => {
        const found = new Set(metricTokens(sentence));
        const lower = sentence.toLowerCase();
        const borrowed = facts.some((f) => f.metrics.some((m) => found.has(m)) && !f.cause.some((w) => lower.includes(w)));
        if (!borrowed)
            return sentence;
        replaced++;
        return '[A measured result of this specific decision.]';
    });
    return { text: out.join(' '), replaced };
};
//# sourceMappingURL=metrics.js.map