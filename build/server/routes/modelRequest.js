import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { isUserSelectableModelId, resolveRequestedModelId, runModelRequest } from '../lib/aiModelLayer.js';
const router = Router();
const getSupabaseUrl = () => process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const getSupabaseAnonKey = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const getSupabaseServiceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const parseBearer = (req) => {
    const auth = req.header('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
};
const requireAnonEnv = () => {
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_ANON_KEY = getSupabaseAnonKey();
    if (!SUPABASE_URL)
        throw new Error('Missing SUPABASE_URL');
    if (!SUPABASE_ANON_KEY)
        throw new Error('Missing SUPABASE_ANON_KEY');
};
const requireServiceEnv = () => {
    requireAnonEnv();
    if (!getSupabaseServiceRoleKey())
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
};
const adminClient = () => {
    requireServiceEnv();
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey();
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
};
const verifyUser = async (req) => {
    requireAnonEnv();
    const token = parseBearer(req);
    if (!token)
        return { ok: false, status: 401, error: 'Unauthorized' };
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_ANON_KEY = getSupabaseAnonKey();
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user)
        return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true, userId: data.user.id, token };
};
router.post('/', async (req, res) => {
    try {
        const v = await verifyUser(req);
        if (!v.ok) {
            res.status(v.status).json({ success: false, error: v.error });
            return;
        }
        const modelId = typeof req.body?.model_id === 'string' ? req.body.model_id.trim() : '';
        const promptText = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
        if (!modelId || !promptText) {
            res.status(400).json({ success: false, error: 'model_id and prompt are required' });
            return;
        }
        if (!isUserSelectableModelId(modelId)) {
            res.status(400).json({ success: false, error: 'model_id is not available for direct requests' });
            return;
        }
        const supabase = adminClient();
        const resolved = await resolveRequestedModelId({ supabase: supabase, userId: v.userId, requestedModelId: modelId });
        const inputUnits = promptText.length;
        const result = await runModelRequest({
            supabase: supabase,
            userId: v.userId,
            requestedModelId: resolved.effective,
            promptText,
            unitCounts: { inputUnits, outputUnits: 0 },
        });
        res.status(200).json({
            success: true,
            output: result.output_json ?? result.output_text,
            provider: result.provider_key,
            used_fallback: result.used_fallback,
            downgraded: result.downgraded,
            requested_model_id: result.requested_model_id,
            used_model_id: result.used_model_id,
        });
    }
    catch (err) {
        const status = err && typeof err.httpStatus === 'number' ? err.httpStatus : 500;
        const message = err instanceof Error ? err.message : 'Server error';
        if (message === 'quota_exceeded') {
            res.status(429).json({ success: false, error: 'Model quota exceeded', code: 'quota_exceeded' });
            return;
        }
        res.status(status).json({ success: false, error: message, details: err?.details ? String(err.details).slice(0, 1200) : undefined });
    }
});
export default router;
//# sourceMappingURL=modelRequest.js.map