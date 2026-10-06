import { decryptSecret } from './cryptoVault.js';
const nowIso = () => new Date().toISOString();
const clampAttempts = (n) => {
    const num = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 1;
    return Math.min(10, Math.max(1, num));
};
const isRetryableStatus = (status) => status === 408 || status === 429 || status >= 500;
const geminiGenerateContentModelCache = new Map();
const listGeminiGenerateContentModels = async (baseUrl, apiKey) => {
    const normalizedBase = baseUrl.replace(/\/$/, '');
    const cacheKey = `${normalizedBase}|${apiKey}`;
    const cached = geminiGenerateContentModelCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAtMs > now)
        return cached.modelNames;
    const url = `${normalizedBase}/v1beta/models`;
    const { resp, text } = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
    }, 15000);
    if (!resp.ok)
        throw new Error(`Gemini ListModels error: ${resp.status} ${text.slice(0, 200)}`);
    const parsed = JSON.parse(text);
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    const names = models
        .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m?.name ?? ''))
        .filter(Boolean)
        .map((n) => (n.startsWith('models/') ? n.slice('models/'.length) : n));
    geminiGenerateContentModelCache.set(cacheKey, { expiresAtMs: now + 10 * 60 * 1000, modelNames: names });
    return names;
};
const pickFallbackGeminiModel = async ({ baseUrl, apiKey, requested }) => {
    const available = await listGeminiGenerateContentModels(baseUrl, apiKey);
    if (!available.length)
        return null;
    const wantPro = /\bpro\b/i.test(requested);
    const wantFlash = /\bflash\b/i.test(requested) || !wantPro;
    const preferredOrder = wantPro
        ? [/gemini-2\.5.*pro/i, /gemini-2\.0.*pro/i, /gemini-1\.5.*pro/i, /gemini.*pro/i]
        : [/gemini-2\.5.*flash/i, /gemini-2\.0.*flash/i, /gemini-1\.5.*flash/i, /gemini.*flash/i];
    for (const re of preferredOrder) {
        const found = available.find((n) => re.test(n));
        if (found)
            return found;
    }
    if (wantFlash) {
        const anyFlash = available.find((n) => /flash/i.test(n));
        if (anyFlash)
            return anyFlash;
    }
    const anyGemini = available.find((n) => /gemini/i.test(n));
    return anyGemini ?? available[0];
};
const fetchWithTimeout = async (url, init, timeoutMs) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { ...init, signal: controller.signal });
        const text = await resp.text().catch(() => '');
        return { resp, text };
    }
    finally {
        clearTimeout(t);
    }
};
const parseOpenAiLikeText = (rawBodyText) => {
    try {
        const parsed = JSON.parse(rawBodyText);
        const content = parsed?.choices?.[0]?.message?.content;
        return typeof content === 'string' ? content : '';
    }
    catch {
        return '';
    }
};
const parseGeminiText = (rawBodyText) => {
    try {
        const parsed = JSON.parse(rawBodyText);
        const content = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        return typeof content === 'string' ? content : '';
    }
    catch {
        return '';
    }
};
const extractJsonObject = (text) => {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (!match)
            return null;
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return null;
        }
    }
};
const buildAttemptsFromPolicy = (policy) => {
    const primaryKey = typeof policy.primary?.provider_key === 'string' ? policy.primary?.provider_key.trim() : '';
    const fallbacks = Array.isArray(policy.fallbacks) ? policy.fallbacks : [];
    const keys = [primaryKey, ...fallbacks.map((f) => (typeof f?.provider_key === 'string' ? f.provider_key.trim() : ''))]
        .filter(Boolean)
        .filter((v, idx, arr) => arr.indexOf(v) === idx);
    const maxAttempts = clampAttempts(policy.max_attempts);
    return keys.slice(0, maxAttempts).map((providerKey) => ({ providerKey }));
};
/** Interview models are metered internally and must not appear in the translation model picker. */
export const isUserSelectableModelId = (modelId) => !modelId.startsWith('interview_');
export const getAllowedModelsForUser = async (supabase, userId) => {
    const { data, error } = await supabase.rpc('ai_get_allowed_models', { uid: userId });
    if (error)
        throw new Error(error.message || 'Failed to load allowed models');
    return (data ?? []);
};
export const getUserSelectedModelId = async (supabase, userId) => {
    const { data, error } = await supabase
        .from('ai_user_model_selection')
        .select('model_pk')
        .eq('user_id', userId)
        .maybeSingle();
    if (error)
        throw new Error(error.message || 'Failed to load model selection');
    const modelPk = data?.model_pk;
    if (!modelPk)
        return null;
    const { data: m, error: mErr } = await supabase.from('ai_models').select('model_id').eq('id', modelPk).maybeSingle();
    if (mErr)
        throw new Error(mErr.message || 'Failed to resolve model selection');
    const modelId = m?.model_id;
    return typeof modelId === 'string' && modelId ? modelId : null;
};
export const setUserSelectedModelId = async (supabase, userId, modelId) => {
    const { data: model, error: mErr } = await supabase
        .from('ai_models')
        .select('id,model_id,status')
        .eq('model_id', modelId)
        .maybeSingle();
    if (mErr)
        throw new Error(mErr.message || 'Failed to resolve model');
    if (!model || model.status !== 'active')
        throw new Error('Model not available');
    const { error } = await supabase.from('ai_user_model_selection').upsert({ user_id: userId, model_pk: model.id, updated_at: nowIso() });
    if (error)
        throw new Error(error.message || 'Failed to save selection');
};
export const resolveRequestedModelId = async ({ supabase, userId, requestedModelId, }) => {
    const allowed = await getAllowedModelsForUser(supabase, userId);
    const allowedIds = new Set(allowed.map((m) => m.model_id));
    if (requestedModelId && allowedIds.has(requestedModelId))
        return { requested: requestedModelId, effective: requestedModelId, allowed };
    const selected = await getUserSelectedModelId(supabase, userId);
    if (selected && allowedIds.has(selected))
        return { requested: requestedModelId, effective: selected, allowed };
    const fallback = allowed[0]?.model_id ?? null;
    if (!fallback)
        throw new Error('No models available for this account');
    return { requested: requestedModelId, effective: fallback, allowed };
};
const resolveModelRow = async (supabase, modelId) => {
    const { data, error } = await supabase.from('ai_models').select('*').eq('model_id', modelId).maybeSingle();
    if (error)
        throw new Error(error.message || 'Failed to load model');
    if (!data)
        throw new Error('Model not found');
    if (data.status !== 'active')
        throw new Error('Model is not active');
    return data;
};
const resolveRoutingPolicy = async (supabase, modelPk) => {
    const { data, error } = await supabase.from('ai_routing_policies').select('*').eq('model_pk', modelPk).maybeSingle();
    if (error)
        throw new Error(error.message || 'Failed to load routing policy');
    if (!data || data.status !== 'active')
        throw new Error('Routing policy not configured');
    return data;
};
const resolveProviderByKey = async (supabase, providerKey) => {
    const { data, error } = await supabase.from('ai_providers').select('*').eq('key', providerKey).maybeSingle();
    if (error)
        throw new Error(error.message || 'Failed to load provider');
    if (!data || data.status !== 'active')
        throw new Error('Provider not available');
    return data;
};
const pickProviderKey = async (supabase, providerId, providerKey) => {
    const { data, error } = await supabase
        .from('ai_provider_keys')
        .select('id,provider_id,label,key_ciphertext,status,priority')
        .eq('provider_id', providerId)
        .eq('status', 'active')
        .order('priority', { ascending: false })
        .limit(1);
    if (error)
        throw new Error(error.message || 'Failed to load provider key');
    const key = (data ?? [])[0];
    if (!key)
        throw new Error(`No active API key configured for provider: ${providerKey || providerId}`);
    return key;
};
/** Failures where another key of the same provider may succeed, and how long to try that key last. */
const KEY_FAILOVER_COOLDOWN_MS = {
    401: 10 * 60000, // key rejected
    403: 10 * 60000, // key lacks permission / API disabled for its project
    429: 60000, // this key's quota or rate limit
};
const MAX_KEYS_PER_PROVIDER = 5;
// Per server instance: keys that just failed are tried after healthy ones for a short while.
const keyCooldownUntil = new Map();
/** Active keys in priority order (cooling-down keys last), then the server environment key if it is different. */
const providerKeyCandidates = async (supabase, provider) => {
    const { data, error } = await supabase
        .from('ai_provider_keys')
        .select('id,provider_id,label,key_ciphertext,status,priority')
        .eq('provider_id', provider.id)
        .eq('status', 'active')
        .order('priority', { ascending: false });
    if (error)
        throw new Error(error.message || 'Failed to load provider keys');
    const now = Date.now();
    const keys = (data ?? []);
    const ordered = [...keys.filter((k) => (keyCooldownUntil.get(k.id) ?? 0) <= now), ...keys.filter((k) => (keyCooldownUntil.get(k.id) ?? 0) > now)];
    const candidates = [];
    for (const k of ordered) {
        try {
            candidates.push({ pkey: k, apiKey: decryptSecret(k.key_ciphertext) });
        }
        catch {
            // unreadable key (e.g. encryption secret changed) — skip it
        }
    }
    const env = envKeyForProvider(provider);
    if (env && !candidates.some((c) => c.apiKey === env))
        candidates.push({ pkey: null, apiKey: env });
    return candidates.slice(0, MAX_KEYS_PER_PROVIDER);
};
const resolveProviderModelName = async (supabase, modelPk, providerId) => {
    const { data, error } = await supabase
        .from('ai_model_mappings')
        .select('*')
        .eq('model_pk', modelPk)
        .eq('provider_id', providerId)
        .eq('status', 'active')
        .maybeSingle();
    if (error)
        throw new Error(error.message || 'Failed to load model mapping');
    const name = data?.provider_model_name;
    if (typeof name !== 'string' || !name)
        return null;
    return name.startsWith('models/') ? name.slice('models/'.length) : name;
};
const callGeminiGenerateContent = async ({ baseUrl, apiKey, model, promptText, generation, }) => {
    const normalizedBase = baseUrl.replace(/\/$/, '');
    const temperature = generation.temperature ?? 0;
    const bodyFor = (apiVersion, useModel) => JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: apiVersion === 'v1beta'
            ? {
                temperature,
                responseMimeType: 'application/json',
                // Gemini 2.5 Flash "thinks" by default, which can add tens of seconds of latency.
                ...(typeof generation.thinkingBudget === 'number' && /2\.5-flash/.test(useModel)
                    ? { thinkingConfig: { thinkingBudget: Math.max(0, Math.round(generation.thinkingBudget)) } }
                    : {}),
            }
            : {
                temperature,
            },
    });
    const call = async (apiVersion, overrideModel) => {
        const useModel = overrideModel ?? model;
        const url = `${normalizedBase}/${apiVersion}/models/${encodeURIComponent(useModel)}:generateContent`;
        const { resp, text } = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: bodyFor(apiVersion, useModel),
        }, 35000);
        const content = parseGeminiText(text);
        return { status: resp.status, ok: resp.ok, raw: text, content };
    };
    const isModelNotFound = (raw) => {
        const s = raw.toLowerCase();
        return s.includes('not found') || s.includes('no longer available') || s.includes('is not supported');
    };
    const primary = await call('v1beta');
    if (primary.ok)
        return primary;
    if (primary.status === 404 || primary.status === 400) {
        const fallbackV1 = await call('v1');
        if (fallbackV1.ok)
            return fallbackV1;
        if ((primary.status === 404 && isModelNotFound(primary.raw)) || (fallbackV1.status === 404 && isModelNotFound(fallbackV1.raw))) {
            try {
                const alt = await pickFallbackGeminiModel({ baseUrl, apiKey, requested: model });
                if (alt && alt !== model) {
                    const altPrimary = await call('v1beta', alt);
                    if (altPrimary.ok)
                        return altPrimary;
                    if (altPrimary.status === 404 || altPrimary.status === 400)
                        return await call('v1', alt);
                    return altPrimary;
                }
            }
            catch {
                geminiGenerateContentModelCache.clear();
            }
        }
        return fallbackV1;
    }
    return primary;
};
const callOpenAiChatCompletions = async ({ baseUrl, apiKey, model, promptText, generation, }) => {
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const { resp, text } = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: promptText }],
            temperature: generation.temperature ?? 0,
            response_format: { type: 'json_object' },
        }),
    }, 35000);
    const content = parseOpenAiLikeText(text);
    return { status: resp.status, ok: resp.ok, raw: text, content };
};
const envKeyForProvider = (provider) => {
    if (provider.auth_type === 'google')
        return (process.env.GOOGLE_API_KEY ?? '').trim();
    if (provider.auth_type === 'bearer')
        return (process.env.OPENAI_API_KEY ?? '').trim();
    return '';
};
const resolveActiveProvidersByKey = async (supabase, providerKeys) => {
    const keys = Array.from(new Set(providerKeys.map((k) => k.trim()).filter(Boolean)));
    if (!keys.length)
        return [];
    const { data, error } = await supabase.from('ai_providers').select('*').in('key', keys).eq('status', 'active');
    if (error)
        throw new Error(error.message || 'Failed to load providers');
    return (data ?? []);
};
const resolveProviderKeysAvailability = async (supabase, providers) => {
    const byKey = new Map();
    for (const p of providers)
        byKey.set(p.key, p);
    const available = new Set();
    const dbCheckIds = [];
    for (const p of providers) {
        if (envKeyForProvider(p)) {
            available.add(p.key);
        }
        else {
            dbCheckIds.push(p.id);
        }
    }
    if (dbCheckIds.length) {
        const { data, error } = await supabase
            .from('ai_provider_keys')
            .select('provider_id')
            .in('provider_id', dbCheckIds)
            .eq('status', 'active');
        if (error)
            throw new Error(error.message || 'Failed to load provider keys');
        const idsWithKeys = new Set((data ?? []).map((r) => String(r.provider_id)));
        for (const p of providers) {
            if (idsWithKeys.has(p.id))
                available.add(p.key);
        }
    }
    return { byKey, available };
};
export const runModelRequest = async ({ supabase, userId, requestedModelId, promptText, unitCounts, generation = {}, }) => {
    const requestedModel = await resolveModelRow(supabase, requestedModelId);
    const policyRow = await resolveRoutingPolicy(supabase, requestedModel.id);
    const policy = (policyRow.policy ?? {});
    const allowed = await getAllowedModelsForUser(supabase, userId);
    const remaining = allowed.find((m) => m.model_id === requestedModelId)?.remaining_requests;
    let effectiveModelId = requestedModelId;
    let downgraded = false;
    if (typeof remaining === 'number' && remaining <= 0) {
        const fb = typeof policy.quota_exhausted_fallback_model_id === 'string' ? policy.quota_exhausted_fallback_model_id.trim() : '';
        if (fb && allowed.some((m) => m.model_id === fb)) {
            effectiveModelId = fb;
            downgraded = true;
        }
    }
    const effectiveModel = effectiveModelId === requestedModelId ? requestedModel : await resolveModelRow(supabase, effectiveModelId);
    const effectivePolicyRow = effectiveModelId === requestedModelId ? policyRow : await resolveRoutingPolicy(supabase, effectiveModel.id);
    const effectivePolicy = (effectivePolicyRow.policy ?? {});
    const attempts = buildAttemptsFromPolicy(effectivePolicy);
    if (!attempts.length)
        throw new Error('Routing policy has no providers');
    const attemptProviderKeys = attempts.map((a) => a.providerKey);
    const attemptProviders = await resolveActiveProvidersByKey(supabase, attemptProviderKeys);
    const availability = await resolveProviderKeysAvailability(supabase, attemptProviders);
    const prioritizedAttempts = attempts
        .filter((a) => availability.byKey.has(a.providerKey))
        .sort((a, b) => (availability.available.has(a.providerKey) === availability.available.has(b.providerKey) ? 0 : availability.available.has(a.providerKey) ? -1 : 1));
    let usedFallback = false;
    let lastError = null;
    const missingKeyProviders = [];
    for (let i = 0; i < prioritizedAttempts.length; i++) {
        const attempt = prioritizedAttempts[i];
        usedFallback = i > 0;
        try {
            if (!availability.available.has(attempt.providerKey)) {
                missingKeyProviders.push(attempt.providerKey);
                continue;
            }
            const provider = await resolveProviderByKey(supabase, attempt.providerKey);
            const mapping = await resolveProviderModelName(supabase, effectiveModel.id, provider.id);
            if (!mapping)
                throw new Error('Model not mapped to provider');
            const candidates = await providerKeyCandidates(supabase, provider);
            if (!candidates.length)
                throw new Error(`No active API key configured for provider: ${provider.key}`);
            const baseUrl = provider.base_url || (provider.key === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1');
            // Try this provider's keys in priority order. Another key only helps when the failure is about
            // the key itself (rejected, or its own quota/rate limit); otherwise move on to the next provider.
            let pkey = null;
            let callResult = null;
            for (let k = 0; k < candidates.length; k++) {
                const candidate = candidates[k];
                const result = provider.auth_type === 'google'
                    ? await callGeminiGenerateContent({ baseUrl, apiKey: candidate.apiKey, model: mapping, promptText, generation })
                    : await callOpenAiChatCompletions({ baseUrl, apiKey: candidate.apiKey, model: mapping, promptText, generation });
                if (result.ok) {
                    pkey = candidate.pkey;
                    callResult = result;
                    if (k > 0)
                        usedFallback = true;
                    break;
                }
                lastError = { status: result.status, code: `provider_http_${result.status}`, details: result.raw.slice(0, 1200) };
                if (candidate.pkey)
                    await supabase.from('ai_provider_keys').update({ last_error_at: nowIso() }).eq('id', candidate.pkey.id);
                const cooldown = KEY_FAILOVER_COOLDOWN_MS[result.status];
                if (!cooldown)
                    break;
                if (candidate.pkey)
                    keyCooldownUntil.set(candidate.pkey.id, Date.now() + cooldown);
            }
            if (!callResult) {
                if (lastError?.status && isRetryableStatus(lastError.status))
                    continue;
                break;
            }
            if (pkey)
                await supabase.from('ai_provider_keys').update({ last_used_at: nowIso() }).eq('id', pkey.id);
            const parsedJson = extractJsonObject(callResult.content);
            const outputUnits = callResult.content.length;
            const { error: meterErr } = await supabase.rpc('ai_meter_model_request', {
                uid: userId,
                model_pk: effectiveModel.id,
                input_units: unitCounts.inputUnits,
                output_units: outputUnits,
                request_inc: 1,
            });
            if (meterErr) {
                if ((meterErr.message ?? '').includes('quota_exceeded'))
                    throw new Error('quota_exceeded');
                if ((meterErr.message ?? '').includes('model_not_allowed'))
                    throw new Error('model_not_allowed');
                throw new Error(meterErr.message || 'meter_failed');
            }
            await supabase.from('ai_usage_events').insert({
                user_id: userId,
                model_pk_requested: requestedModel.id,
                model_pk_used: effectiveModel.id,
                provider_id_used: provider.id,
                provider_key_id_used: pkey ? pkey.id : null,
                used_fallback: usedFallback,
                downgraded,
                status: 'success',
                error_code: null,
                input_units: unitCounts.inputUnits,
                output_units: outputUnits,
            });
            return {
                requested_model_id: requestedModelId,
                used_model_id: effectiveModelId,
                provider_key: provider.key,
                used_fallback: usedFallback,
                downgraded,
                output_text: callResult.content,
                output_json: parsedJson,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'model_request_failed';
            if (msg === 'quota_exceeded') {
                await supabase.from('ai_usage_events').insert({
                    user_id: userId,
                    model_pk_requested: requestedModel.id,
                    model_pk_used: effectiveModel.id,
                    provider_id_used: null,
                    provider_key_id_used: null,
                    used_fallback: usedFallback,
                    downgraded,
                    status: 'rejected_limit',
                    error_code: 'quota_exceeded',
                    input_units: unitCounts.inputUnits,
                    output_units: unitCounts.outputUnits,
                });
                throw new Error('quota_exceeded');
            }
            lastError = { code: msg, details: lastError?.details };
            if (i < prioritizedAttempts.length - 1)
                continue;
        }
    }
    if (!prioritizedAttempts.length) {
        const missing = attempts.map((a) => a.providerKey).join(', ');
        throw new Error(`No available providers configured (missing keys): ${missing}`);
    }
    if (!lastError && missingKeyProviders.length) {
        const uniq = Array.from(new Set(missingKeyProviders));
        throw new Error(`No active API key configured for provider(s): ${uniq.join(', ')}`);
    }
    await supabase.from('ai_usage_events').insert({
        user_id: userId,
        model_pk_requested: requestedModel.id,
        model_pk_used: (await resolveModelRow(supabase, effectiveModelId)).id,
        provider_id_used: null,
        provider_key_id_used: null,
        used_fallback: usedFallback,
        downgraded,
        status: 'error',
        error_code: lastError?.code ?? 'unknown_error',
        input_units: unitCounts.inputUnits,
        output_units: unitCounts.outputUnits,
    });
    const status = typeof lastError?.status === 'number' ? lastError.status : 502;
    const details = lastError?.details ?? '';
    const error = lastError?.code ?? 'model_request_failed';
    const e = new Error(error);
    e.httpStatus = status;
    e.details = details;
    throw e;
};
// ---------------------------------------------------------------------------
// Admin diagnostics (never metered against users).
// Tests call the exact provider + model + key chosen by the admin, without the gateway's
// silent model substitution, so a misconfigured model name is reported instead of masked.
// ---------------------------------------------------------------------------
/** fetchWithTimeout that reports network failures/timeouts as status 0 instead of throwing. */
const safeFetch = async (url, init, timeoutMs) => {
    try {
        return await fetchWithTimeout(url, init, timeoutMs);
    }
    catch {
        return { resp: { ok: false, status: 0 }, text: '' };
    }
};
export const hasEnvKeyForAuthType = (authType) => !!envKeyForProvider({ auth_type: authType });
const defaultBaseUrl = (provider) => (provider.base_url || (provider.auth_type === 'google' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1')).replace(/\/$/, '');
/** Plain-language explanation of a provider error, for admins. */
export const describeProviderError = (status, raw) => {
    const text = raw.toLowerCase();
    const retry = raw.match(/retry in ([0-9hms.]+)/i)?.[1];
    if (status === 0)
        return 'Could not reach the provider (network error or timeout).';
    if (status === 401 || text.includes('api key not valid') || text.includes('invalid api key') || text.includes('incorrect api key'))
        return 'The API key was rejected. Check that it is correct and still active.';
    if (status === 403)
        return text.includes('has not been used') || text.includes('disabled')
            ? 'This API is not enabled for the key’s project. Enable it in the provider console.'
            : 'Permission denied for this key. Check the key’s project and permissions.';
    if (status === 404)
        return 'Model not found for this provider. Pick a model from the provider’s list.';
    if (status === 429)
        return `Quota or rate limit reached${text.includes('free_tier') || text.includes('free tier') ? ' (free tier)' : ''}.${retry ? ` Resets in about ${retry.replace(/\.\d+s/, 's')}.` : ''}`;
    if (status >= 500)
        return `The provider is overloaded or temporarily down (HTTP ${status}). This is on the provider's side — your key is fine. Try again in a minute.`;
    if (status === 400)
        return 'The provider rejected the request (bad request). The model may not support text generation.';
    return `Provider returned HTTP ${status}.`;
};
const resolveProviderApiKey = async (supabase, provider, keyId) => {
    if (keyId) {
        const { data } = await supabase.from('ai_provider_keys').select('id,label,key_ciphertext,provider_id').eq('id', keyId).maybeSingle();
        if (!data || data.provider_id !== provider.id)
            return null;
        return { apiKey: decryptSecret(data.key_ciphertext), keyId: data.id, source: 'saved key', label: data.label };
    }
    try {
        const pkey = await pickProviderKey(supabase, provider.id, provider.key);
        return { apiKey: decryptSecret(pkey.key_ciphertext), keyId: pkey.id, source: 'saved key', label: pkey.label };
    }
    catch {
        const env = envKeyForProvider(provider);
        return env ? { apiKey: env, keyId: null, source: 'server environment', label: 'environment' } : null;
    }
};
const loadProvider = async (supabase, providerId) => {
    const { data, error } = await supabase.from('ai_providers').select('id,key,name,base_url,auth_type,status').eq('id', providerId).maybeSingle();
    if (error || !data)
        throw new Error('Provider not found');
    return data;
};
/** Lists the provider's text-generation models using its key (no quota is consumed by listing). */
export const listProviderModels = async ({ supabase, providerId }) => {
    const provider = await loadProvider(supabase, providerId);
    const key = await resolveProviderApiKey(supabase, provider);
    if (!key)
        return { ok: false, models: [], message: 'No API key configured for this provider.' };
    const base = defaultBaseUrl(provider);
    if (provider.auth_type === 'google') {
        const { resp, text } = await safeFetch(`${base}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': key.apiKey } }, 15000);
        if (!resp.ok)
            return { ok: false, models: [], message: describeProviderError(resp.status, text) };
        const parsed = JSON.parse(text);
        const models = (parsed.models ?? [])
            .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
            .map((m) => String(m.name ?? '').replace(/^models\//, ''))
            .filter((n) => n && !/tts|embedding|image|imagen|veo|aqa|native-audio|live/i.test(n));
        return { ok: true, models: Array.from(new Set(models)).sort(), message: null };
    }
    const { resp, text } = await safeFetch(`${base}/models`, { headers: { Authorization: `Bearer ${key.apiKey}` } }, 15000);
    if (!resp.ok)
        return { ok: false, models: [], message: describeProviderError(resp.status, text) };
    const parsed = JSON.parse(text);
    const models = (parsed.data ?? []).map((m) => String(m.id ?? '')).filter((n) => n && !/embed|whisper|tts|dall-e|moderation|audio|image|transcribe|guard/i.test(n));
    return { ok: true, models: Array.from(new Set(models)).sort(), message: null };
};
/** Sends one tiny JSON request to exactly this provider + model (+ key) and reports the outcome. */
export const probeProviderModel = async ({ supabase, providerId, modelName, keyId, }) => {
    const provider = await loadProvider(supabase, providerId);
    const key = await resolveProviderApiKey(supabase, provider, keyId);
    if (!key)
        return { ok: false, status: 0, latency_ms: 0, key_source: null, message: 'No API key configured for this provider — requests to it are skipped.', preview: null };
    const base = defaultBaseUrl(provider);
    const prompt = 'Reply with exactly this JSON and nothing else: {"ok": true}';
    const started = Date.now();
    const send = async () => provider.auth_type === 'google'
        ? await safeFetch(`${base}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.apiKey },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(/2\.5-flash/.test(modelName) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
            }),
        }, 35000)
        : await safeFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.apiKey}` },
            body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }),
        }, 35000);
    let { resp, text } = await send();
    // Provider-side blips (overloaded, timeouts) are common on free tiers: retry once before reporting.
    if (resp.status === 0 || resp.status === 408 || resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500));
        ({ resp, text } = await send());
    }
    const latency = Date.now() - started;
    if (key.keyId)
        await supabase.from('ai_provider_keys').update(resp.ok ? { last_used_at: nowIso() } : { last_error_at: nowIso() }).eq('id', key.keyId);
    if (!resp.ok)
        return { ok: false, status: resp.status, latency_ms: latency, key_source: key.source, message: describeProviderError(resp.status, text), preview: text.slice(0, 300) };
    const content = provider.auth_type === 'google' ? parseGeminiText(text) : parseOpenAiLikeText(text);
    return { ok: true, status: resp.status, latency_ms: latency, key_source: key.source, message: 'Working', preview: content.slice(0, 120) };
};
//# sourceMappingURL=aiModelLayer.js.map