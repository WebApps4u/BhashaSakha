import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { runModelRequest } from '../lib/aiModelLayer.js';
const router = Router();
const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const getSupabaseServiceRoleKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const parseBearer = (req) => {
    const auth = req.header('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
};
const verifyUser = async (req) => {
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_ANON_KEY = getSupabaseAnonKey();
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
        return { ok: false, status: 500, error: 'Supabase not configured' };
    const token = parseBearer(req);
    if (!token)
        return { ok: false, status: 401, error: 'Unauthorized' };
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user)
        return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true, userId: data.user.id };
};
const serviceClient = () => {
    const url = getSupabaseUrl();
    const key = getSupabaseServiceRoleKey();
    if (!url || !key)
        return null;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
const asLines = (rows) => rows
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((r) => `${r.seq}. ${r.speaker_label}: ${r.text}`)
    .join('\n');
router.post('/', async (req, res) => {
    try {
        const v = await verifyUser(req);
        if (!v.ok) {
            res.status(v.status).json({ success: false, error: v.error });
            return;
        }
        const sessionId = typeof req.body?.session_id === 'string' ? String(req.body.session_id).trim() : '';
        if (!sessionId) {
            res.status(400).json({ success: false, error: 'session_id is required' });
            return;
        }
        const supabaseAdmin = serviceClient();
        if (!supabaseAdmin) {
            res.status(500).json({ success: false, error: 'Supabase service client is not configured on the server' });
            return;
        }
        const { data: sessionRow, error: sessionErr } = await supabaseAdmin
            .from('sessions')
            .select('id,owner_id,session_mode,source_lang,target_langs,visibility')
            .eq('id', sessionId)
            .single();
        if (sessionErr || !sessionRow) {
            res.status(404).json({ success: false, error: 'Session not found' });
            return;
        }
        if (String(sessionRow.owner_id) !== v.userId) {
            res.status(403).json({ success: false, error: 'Forbidden' });
            return;
        }
        const { data: segments, error: segErr } = await supabaseAdmin
            .from('transcript_segments')
            .select('id,seq,speaker_label,text')
            .eq('session_id', sessionId)
            .order('seq', { ascending: true });
        if (segErr) {
            res.status(500).json({ success: false, error: segErr.message });
            return;
        }
        const segList = (segments ?? []);
        if (!segList.length) {
            res.status(400).json({ success: false, error: 'No transcript segments yet' });
            return;
        }
        const segIds = segList.map((s) => s.id);
        const { data: risks } = await supabaseAdmin
            .from('segment_risks')
            .select('segment_id,risk_type,value_redacted,confirmed')
            .in('segment_id', segIds);
        const prompt = 'You are an assistant that converts banking call transcripts into a structured case form. ' +
            'Return ONLY valid JSON (no markdown). ' +
            'Do not include raw sensitive values; use redacted values provided.';
        const promptText = prompt +
            '\n\n' +
            'OUTPUT JSON SCHEMA:' +
            '\n' +
            JSON.stringify({
                case_type: 'string',
                customer_intent: 'string',
                product: 'string',
                summary: 'string',
                critical_fields: [
                    {
                        type: 'amount|date|account|pan|aadhaar|upi|ifsc|phone|email|other',
                        value_redacted: 'string',
                        confirmed: 'boolean',
                        notes: 'string',
                    },
                ],
                actions: [
                    {
                        action: 'string',
                        owner: 'agent|customer|bank',
                        due: 'string',
                    },
                ],
                risk_flags: ['string'],
            }, null, 2) +
            '\n\n' +
            'SESSION METADATA: ' +
            JSON.stringify({
                session_mode: sessionRow.session_mode,
                source_lang: sessionRow.source_lang,
                target_langs: sessionRow.target_langs,
            }, null, 2) +
            '\n\n' +
            'RISK ITEMS (REDACTED): ' +
            JSON.stringify(risks ?? [], null, 2) +
            '\n\n' +
            'TRANSCRIPT:' +
            '\n' +
            asLines(segList);
        const inputUnits = promptText.length;
        const modelResult = await runModelRequest({
            supabase: supabaseAdmin,
            userId: v.userId,
            requestedModelId: 'translate_lite',
            promptText,
            unitCounts: { inputUnits, outputUnits: 0 },
        });
        const formJson = modelResult.output_json;
        if (!formJson || typeof formJson !== 'object') {
            res.status(502).json({ success: false, error: 'Invalid JSON from model provider' });
            return;
        }
        const { data: inserted, error: insErr } = await supabaseAdmin
            .from('banking_case_forms')
            .insert({ session_id: sessionId, created_by: v.userId, form_json: formJson })
            .select('id,session_id,created_by,form_json,created_at')
            .single();
        if (insErr || !inserted) {
            res.status(500).json({ success: false, error: insErr?.message ?? 'Failed to save case form' });
            return;
        }
        res.status(200).json({ success: true, form: inserted });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
    }
});
export default router;
//# sourceMappingURL=caseForm.js.map