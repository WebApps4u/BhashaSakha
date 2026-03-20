import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
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
const adminClient = () => {
    const url = getSupabaseUrl();
    const key = getSupabaseServiceRoleKey();
    if (!url || !key)
        return null;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
router.post('/segment', async (req, res) => {
    try {
        const v = await verifyUser(req);
        if (!v.ok) {
            res.status(v.status).json({ success: false, error: v.error });
            return;
        }
        const supabase = adminClient();
        if (!supabase) {
            res.status(500).json({ success: false, error: 'Supabase service client is not configured on the server' });
            return;
        }
        const body = req.body;
        const privacy = String(body?.privacy ?? 'private');
        const visibility = privacy === 'shareable' ? 'public' : 'private';
        const source_lang = String(body?.source_lang ?? 'en');
        const session_mode = String(body?.session_mode ?? 'general');
        const target_langs = Array.isArray(body?.target_langs) ? body.target_langs.map((x) => String(x)) : [];
        const speaker_label = String(body?.speaker_label ?? 'Speaker 1');
        const seq = Number(body?.seq ?? 0);
        const start_ms = Number(body?.start_ms ?? 0);
        const end_ms = Number(body?.end_ms ?? 0);
        const text = String(body?.text ?? '').trim();
        if (!text) {
            res.status(400).json({ success: false, error: 'text is required' });
            return;
        }
        let session_id = typeof body?.session_id === 'string' ? String(body.session_id).trim() : '';
        if (session_id) {
            const { data: s, error: sErr } = await supabase
                .from('sessions')
                .select('id,owner_id')
                .eq('id', session_id)
                .maybeSingle();
            if (sErr || !s) {
                res.status(404).json({ success: false, error: 'Session not found' });
                return;
            }
            if (String(s.owner_id) !== v.userId) {
                res.status(403).json({ success: false, error: 'Forbidden' });
                return;
            }
        }
        else {
            const { data: created, error: cErr } = await supabase
                .from('sessions')
                .insert({
                owner_id: v.userId,
                title: 'Live session',
                source_lang,
                target_langs,
                visibility,
                session_mode,
                started_at: new Date().toISOString(),
            })
                .select('id')
                .single();
            if (cErr || !created) {
                res.status(500).json({ success: false, error: cErr?.message ?? 'Failed to create session' });
                return;
            }
            session_id = String(created.id);
        }
        const { data: seg, error: segErr } = await supabase
            .from('transcript_segments')
            .insert({
            session_id,
            seq,
            speaker_label,
            start_ms,
            end_ms,
            text,
            is_final: true,
            is_edited: false,
        })
            .select('id')
            .single();
        if (segErr || !seg) {
            res.status(500).json({ success: false, error: segErr?.message ?? 'Failed to insert segment' });
            return;
        }
        res.status(200).json({ success: true, session_id, segment_id: seg.id });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
    }
});
export default router;
//# sourceMappingURL=liveSegments.js.map