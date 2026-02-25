import { Router } from 'express';
const router = Router();
const listGenerateContentModels = async (apiKey) => {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
    });
    const bodyText = await response.text().catch(() => '');
    if (!response.ok)
        return { ok: false, bodyText };
    try {
        const data = JSON.parse(bodyText);
        const models = (data.models ?? [])
            .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
            .map((m) => m.baseModelId || (m.name?.startsWith('models/') ? m.name.slice('models/'.length) : m.name) || '')
            .filter(Boolean);
        return { ok: true, models };
    }
    catch {
        return { ok: false, bodyText };
    }
};
router.get('/', async (req, res) => {
    void req;
    const configuredModel = process.env.GEMINI_MODEL_TRANSLATE ?? 'gemini-2.5-flash';
    const googleKey = process.env.GOOGLE_API_KEY;
    const enableDiagnostics = (process.env.ENABLE_GEMINI_DIAGNOSTICS ?? '').toLowerCase() === 'true' || process.env.NODE_ENV !== 'production';
    const payload = {
        success: true,
        gemini: {
            model: configuredModel,
            has_google_api_key: !!googleKey,
        },
        supabase: {
            has_url: !!process.env.SUPABASE_URL,
            has_anon_key: !!process.env.SUPABASE_ANON_KEY,
        },
    };
    if (googleKey && enableDiagnostics) {
        const listed = await listGenerateContentModels(googleKey);
        if (!listed.ok) {
            payload.gemini_diagnostics = { ok: false, details: listed.bodyText.slice(0, 500) };
        }
        else {
            payload.gemini_diagnostics = {
                ok: true,
                model_ok: listed.models.some((m) => m === configuredModel || m.startsWith(`${configuredModel}-`)),
                sample_models: listed.models.slice(0, 8),
            };
        }
    }
    res.status(200).json(payload);
});
export default router;
//# sourceMappingURL=config.js.map