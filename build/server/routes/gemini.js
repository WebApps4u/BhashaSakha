import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
const router = Router();
const getGoogleApiKey = () => process.env.GOOGLE_API_KEY ?? '';
const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const parseBearer = (req) => {
    const auth = req.header('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
};
const verifyUser = async (req) => {
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_ANON_KEY = getSupabaseAnonKey();
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
        return { ok: false, status: 500, error: 'Supabase is not configured on the server' };
    const token = parseBearer(req);
    if (!token)
        return { ok: false, status: 401, error: 'Unauthorized' };
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user)
        return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true, userId: data.user.id, token };
};
const adminClient = () => {
    const SUPABASE_URL = getSupabaseUrl();
    const key = getSupabaseServiceRoleKey();
    if (!SUPABASE_URL || !key)
        return null;
    return createClient(SUPABASE_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
};
const isAdmin = async (userId) => {
    const supabase = adminClient();
    if (!supabase)
        return false;
    const { data: links, error } = await supabase.from('admin_user_roles').select('role_id').eq('user_id', userId);
    if (error)
        return false;
    const roleIds = (links ?? []).map((r) => r.role_id).filter(Boolean);
    if (!roleIds.length)
        return false;
    const { data: roles } = await supabase.from('admin_roles').select('key').in('id', roleIds);
    const keys = (roles ?? []).map((r) => r.key).filter(Boolean);
    return keys.includes('admin') || keys.includes('super_admin');
};
const generateOnce = async ({ apiKey, model, text }) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: { temperature: 0 },
        }),
    });
    const bodyText = await response.text().catch(() => '');
    return { response, bodyText };
};
router.get('/models', async (req, res) => {
    const v = await verifyUser(req);
    if (!v.ok) {
        res.status(v.status).json({ success: false, error: v.error });
        return;
    }
    if (!(await isAdmin(v.userId))) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
    }
    const GOOGLE_API_KEY = getGoogleApiKey();
    if (!GOOGLE_API_KEY) {
        res.status(500).json({ success: false, error: 'Missing GOOGLE_API_KEY on the server.' });
        return;
    }
    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            method: 'GET',
            headers: { 'x-goog-api-key': GOOGLE_API_KEY },
        });
        const text = await response.text().catch(() => '');
        if (!response.ok) {
            res.status(502).json({
                success: false,
                error: `Gemini models.list error (${response.status})`,
                details: text.slice(0, 1500),
            });
            return;
        }
        const data = JSON.parse(text);
        const models = (data.models ?? [])
            .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
            .map((m) => ({
            id: m.baseModelId || (m.name?.startsWith('models/') ? m.name.slice('models/'.length) : m.name) || '',
            displayName: m.displayName ?? '',
        }))
            .filter((m) => !!m.id);
        res.status(200).json({
            success: true,
            count: models.length,
            models,
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: err instanceof Error ? err.message : 'Server error',
        });
    }
});
router.post('/test', async (req, res) => {
    const v = await verifyUser(req);
    if (!v.ok) {
        res.status(v.status).json({ success: false, error: v.error });
        return;
    }
    if (!(await isAdmin(v.userId))) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
    }
    const GOOGLE_API_KEY = getGoogleApiKey();
    if (!GOOGLE_API_KEY) {
        res.status(500).json({ success: false, error: 'Missing GOOGLE_API_KEY on the server.' });
        return;
    }
    const inputText = typeof req.body?.text === 'string' ? String(req.body.text) : 'Say OK.';
    const preferredModel = typeof process.env.GEMINI_MODEL_TRANSLATE === 'string' && process.env.GEMINI_MODEL_TRANSLATE.trim()
        ? process.env.GEMINI_MODEL_TRANSLATE.trim()
        : 'gemini-2.5-flash';
    try {
        const tried = [];
        const candidates = [preferredModel, 'gemini-2.5-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-flash-latest', 'gemini-pro-latest'];
        for (const model of candidates) {
            if (!model || tried.includes(model))
                continue;
            tried.push(model);
            const { response, bodyText } = await generateOnce({ apiKey: GOOGLE_API_KEY, model, text: inputText });
            if (response.ok) {
                res.status(200).json({ success: true, model, tried_models: tried });
                return;
            }
            if (response.status !== 404) {
                res.status(502).json({
                    success: false,
                    error: `Gemini test error (${response.status})`,
                    model,
                    tried_models: tried,
                    details: bodyText.slice(0, 1500),
                });
                return;
            }
        }
        res.status(502).json({
            success: false,
            error: 'Gemini test error (404)',
            model: preferredModel,
            tried_models: tried,
            details: 'Preferred model was not found. Use /api/gemini/models to pick an available model.',
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error', model: preferredModel });
    }
});
export default router;
//# sourceMappingURL=gemini.js.map