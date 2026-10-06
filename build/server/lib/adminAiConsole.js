// Read models and safe write helpers behind the admin "AI providers", "AI models" and "Usage" pages.
// Everything here runs with the service-role client; callers must enforce admin access.
import { describeProviderError, hasEnvKeyForAuthType, probeProviderModel } from './aiModelLayer.js';
/** What each app model is for, so admins know what they are configuring. */
export const MODEL_PURPOSE = {
    translate_lite: { used_for: 'Live translation — the default model for every user.' },
    translate_pro: { used_for: 'Higher-quality translation that users can pick on the Models page (paid plans).' },
    interview_lite: { used_for: 'Interview simulator — the live interviewer (one call per answer, needs to be fast).' },
    interview_pro: { used_for: 'Interview simulator — resume analysis and post-interview feedback.' },
    interview_session: { used_for: 'Counts interviews started per month. Not an AI call, so it has no providers.', virtual: true },
};
const ERROR_EXPLANATIONS = {
    provider_http_429: 'Provider quota or rate limit reached (e.g. a free-tier daily limit).',
    provider_http_401: 'Provider rejected the API key.',
    provider_http_403: 'Provider denied access (API disabled or key lacks permission).',
    provider_http_404: 'Model name not found at the provider.',
    provider_http_500: 'Provider internal error.',
    provider_http_503: 'Provider overloaded or unavailable.',
    quota_exceeded: "A user hit their plan's monthly limit.",
};
export const monthKeyUtc = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const routeProviderKeys = (policy) => {
    const primary = typeof policy?.primary?.provider_key === 'string' ? policy.primary.provider_key.trim() : '';
    const fallbacks = Array.isArray(policy?.fallbacks) ? policy.fallbacks.map((f) => (typeof f?.provider_key === 'string' ? f.provider_key.trim() : '')) : [];
    return [primary, ...fallbacks].filter((k, i, arr) => k && arr.indexOf(k) === i);
};
// ---------------------------------------------------------------------------
// Overview for the Providers and Models pages
// ---------------------------------------------------------------------------
export const getAiOverview = async (supabase) => {
    const month = monthKeyUtc();
    const [providersRes, keysRes, modelsRes, mappingsRes, policiesRes, entRes, plansRes, usageRes] = await Promise.all([
        supabase.from('ai_providers').select('id,key,name,base_url,auth_type,status,updated_at').order('name'),
        supabase.from('ai_provider_keys').select('id,provider_id,label,status,priority,last_used_at,last_error_at,created_at').order('priority', { ascending: false }),
        supabase.from('ai_models').select('id,model_id,display_name,modality,status').order('model_id'),
        supabase.from('ai_model_mappings').select('id,model_pk,provider_id,provider_model_name,status'),
        supabase.from('ai_routing_policies').select('model_pk,status,policy'),
        supabase.from('ai_plan_entitlements').select('plan_code,model_pk,is_enabled,monthly_request_limit'),
        supabase.from('subscription_plans').select('code,name,is_active').order('code'),
        supabase.from('ai_usage_months').select('model_pk,requests_used').eq('month', month),
    ]);
    for (const r of [providersRes, keysRes, modelsRes, mappingsRes, policiesRes, entRes, plansRes, usageRes])
        if (r.error)
            throw new Error(r.error.message);
    const providers = (providersRes.data ?? []);
    const keys = (keysRes.data ?? []);
    const models = (modelsRes.data ?? []).filter((m) => m.status !== 'disabled');
    const mappings = (mappingsRes.data ?? []).filter((m) => m.status === 'active');
    const policies = new Map((policiesRes.data ?? []).map((p) => [p.model_pk, p]));
    const providerByKey = new Map(providers.map((p) => [p.key, p]));
    const providerReady = (p) => {
        const activeKeys = keys.filter((k) => k.provider_id === p.id && k.status === 'active').length;
        const env = hasEnvKeyForAuthType(p.auth_type);
        return { activeKeys, env, hasKey: activeKeys > 0 || env, usable: p.status === 'active' && (activeKeys > 0 || env) };
    };
    const usageByModel = new Map();
    for (const u of (usageRes.data ?? []))
        usageByModel.set(u.model_pk, (usageByModel.get(u.model_pk) ?? 0) + Number(u.requests_used ?? 0));
    const modelViews = models.map((m) => {
        const policy = policies.get(m.id)?.policy ?? null;
        const purpose = MODEL_PURPOSE[m.model_id];
        const route = routeProviderKeys(policy).map((providerKey, index) => {
            const provider = providerByKey.get(providerKey);
            const mapping = provider ? mappings.find((x) => x.model_pk === m.id && x.provider_id === provider.id) : null;
            const ready = provider ? providerReady(provider) : null;
            const problem = !provider
                ? `Provider "${providerKey}" does not exist.`
                : provider.status !== 'active'
                    ? 'Provider is disabled — this step is skipped.'
                    : !ready?.hasKey
                        ? 'Provider has no API key — this step is skipped.'
                        : !mapping
                            ? 'No model chosen for this provider — this step fails.'
                            : null;
            return {
                position: index,
                provider_id: provider?.id ?? null,
                provider_key: providerKey,
                provider_name: provider?.name ?? providerKey,
                provider_model_name: mapping?.provider_model_name ?? null,
                problem,
            };
        });
        const limits = (entRes.data ?? [])
            .filter((e) => e.model_pk === m.id)
            .map((e) => ({ plan_code: e.plan_code, enabled: !!e.is_enabled, monthly_request_limit: Number(e.monthly_request_limit ?? 0) }));
        return {
            id: m.id,
            model_id: m.model_id,
            display_name: m.display_name,
            status: m.status,
            used_for: purpose?.used_for ?? 'Custom app model. It is only used if the app code requests it.',
            virtual: !!purpose?.virtual,
            route,
            works: purpose?.virtual ? true : route.some((s) => !s.problem),
            limits,
            requests_this_month: usageByModel.get(m.id) ?? 0,
        };
    });
    const providerViews = providers.map((p) => {
        const ready = providerReady(p);
        const usedBy = modelViews.flatMap((m) => m.route.filter((s) => s.provider_id === p.id).map((s) => ({ model_id: m.model_id, display_name: m.display_name, position: s.position, provider_model_name: s.provider_model_name })));
        const providerKeys = keys.filter((k) => k.provider_id === p.id);
        return {
            ...p,
            keys: providerKeys,
            active_keys: ready.activeKeys,
            env_key: ready.env,
            usable: ready.usable,
            used_by: usedBy,
            last_used_at: providerKeys.map((k) => k.last_used_at).filter(Boolean).sort().pop() ?? null,
            last_error_at: providerKeys.map((k) => k.last_error_at).filter(Boolean).sort().pop() ?? null,
        };
    });
    return { month, providers: providerViews, models: modelViews, plans: plansRes.data ?? [] };
};
export const saveModelRoute = async (supabase, modelPk, rawSteps) => {
    const steps = (Array.isArray(rawSteps) ? rawSteps : [])
        .map((s) => ({ provider_id: String(s?.provider_id ?? ''), provider_model_name: String(s?.provider_model_name ?? '').trim() }))
        .filter((s) => s.provider_id);
    if (!steps.length)
        throw new Error('Add at least one provider to the route.');
    if (steps.length > 5)
        throw new Error('A route can have at most 5 providers.');
    if (steps.some((s) => !s.provider_model_name || s.provider_model_name.length > 120))
        throw new Error('Choose a model for every provider in the route.');
    if (new Set(steps.map((s) => s.provider_id)).size !== steps.length)
        throw new Error('Each provider can appear only once in a route.');
    const [{ data: model }, { data: providers }, { data: existing }, { data: policyRow }] = await Promise.all([
        supabase.from('ai_models').select('id,model_id').eq('id', modelPk).maybeSingle(),
        supabase.from('ai_providers').select('id,key').in('id', steps.map((s) => s.provider_id)),
        supabase.from('ai_model_mappings').select('id,provider_id,status').eq('model_pk', modelPk),
        supabase.from('ai_routing_policies').select('policy').eq('model_pk', modelPk).maybeSingle(),
    ]);
    if (!model)
        throw new Error('Model not found');
    if (MODEL_PURPOSE[model.model_id]?.virtual)
        throw new Error('This model is a counter and has no providers.');
    const providerKey = new Map((providers ?? []).map((p) => [p.id, p.key]));
    if (steps.some((s) => !providerKey.has(s.provider_id)))
        throw new Error('Unknown provider in route.');
    for (const step of steps) {
        const rows = (existing ?? []).filter((m) => m.provider_id === step.provider_id);
        if (rows.length) {
            const { error } = await supabase.from('ai_model_mappings').update({ provider_model_name: step.provider_model_name, status: 'active' }).eq('id', rows[0].id);
            if (error)
                throw new Error(error.message);
            for (const extra of rows.slice(1))
                await supabase.from('ai_model_mappings').update({ status: 'disabled' }).eq('id', extra.id);
        }
        else {
            const { error } = await supabase.from('ai_model_mappings').insert({ model_pk: modelPk, provider_id: step.provider_id, provider_model_name: step.provider_model_name, status: 'active' });
            if (error)
                throw new Error(error.message);
        }
    }
    const kept = new Set(steps.map((s) => s.provider_id));
    for (const m of (existing ?? [])) {
        if (!kept.has(m.provider_id) && m.status === 'active')
            await supabase.from('ai_model_mappings').update({ status: 'disabled' }).eq('id', m.id);
    }
    const previous = (policyRow?.policy ?? {});
    const policy = {
        ...previous,
        primary: { key_strategy: previous?.primary?.key_strategy ?? 'priority', provider_key: providerKey.get(steps[0].provider_id) },
        fallbacks: steps.slice(1).map((s) => ({ provider_key: providerKey.get(s.provider_id) })),
        max_attempts: steps.length,
        retry_on: Array.isArray(previous?.retry_on) ? previous.retry_on : ['timeout', '5xx', 'rate_limit'],
    };
    const { error } = await supabase.from('ai_routing_policies').upsert({ model_pk: modelPk, status: 'active', policy }, { onConflict: 'model_pk' });
    if (error)
        throw new Error(error.message);
    return policy;
};
/** Tries the route like a real request would (in order, stop at first success) and reports every attempt. */
export const testModelRoute = async (supabase, modelPk) => {
    const overview = await getAiOverview(supabase);
    const model = overview.models.find((m) => m.id === modelPk);
    if (!model)
        throw new Error('Model not found');
    const attempts = [];
    for (const step of model.route) {
        if (step.problem || !step.provider_id || !step.provider_model_name) {
            attempts.push({ provider_name: step.provider_name, provider_model_name: step.provider_model_name, ok: false, skipped: true, message: step.problem });
            continue;
        }
        const r = await probeProviderModel({ supabase, providerId: step.provider_id, modelName: step.provider_model_name });
        attempts.push({ provider_name: step.provider_name, provider_model_name: step.provider_model_name, ...r });
        if (r.ok)
            break;
    }
    return { model_id: model.model_id, ok: attempts.some((a) => a.ok), attempts };
};
// ---------------------------------------------------------------------------
// Usage overview: per model, per provider, per user (with quota remaining)
// ---------------------------------------------------------------------------
const fetchAll = async (query, pageSize = 1000, maxPages = 20) => {
    const rows = [];
    for (let page = 0; page < maxPages; page++) {
        const { data, error } = await query().range(page * pageSize, page * pageSize + pageSize - 1);
        if (error)
            throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize)
            break;
    }
    return rows;
};
export const getUsageOverview = async (supabase, month) => {
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const to = new Date(Date.UTC(y, m, 1)).toISOString();
    const [events, usageRows, planUsageRows, modelsRes, providersRes, entRes] = await Promise.all([
        fetchAll(() => supabase
            .from('ai_usage_events')
            .select('created_at,user_id,status,error_code,model_pk_used,provider_id_used,input_units,output_units')
            .gte('created_at', from)
            .lt('created_at', to)
            .order('created_at', { ascending: true })),
        fetchAll(() => supabase.from('ai_usage_months').select('user_id,model_pk,requests_used,input_units_used,output_units_used,updated_at').eq('month', month)),
        fetchAll(() => supabase.from('usage_months').select('user_id,requests_used,chars_used,updated_at').eq('month', month)),
        supabase.from('ai_models').select('id,model_id,display_name,status'),
        supabase.from('ai_providers').select('id,key,name'),
        supabase.from('ai_plan_entitlements').select('plan_code,model_pk,is_enabled,monthly_request_limit'),
    ]);
    const models = (modelsRes.data ?? []);
    const modelById = new Map(models.map((x) => [x.id, x]));
    const providerById = new Map((providersRes.data ?? []).map((x) => [x.id, x]));
    // Totals, per model and per provider (from individual request events).
    const totals = { success: 0, error: 0, rejected_limit: 0, input_units: 0, output_units: 0, users: 0 };
    const byModel = new Map();
    const byProvider = new Map();
    const errors = new Map();
    const lastActive = new Map();
    const activeUsers = new Set();
    for (const e of events) {
        const status = e.status === 'success' ? 'success' : e.status === 'rejected_limit' ? 'rejected_limit' : 'error';
        totals[status]++;
        totals.input_units += Number(e.input_units ?? 0);
        totals.output_units += Number(e.output_units ?? 0);
        if (e.user_id) {
            activeUsers.add(e.user_id);
            lastActive.set(e.user_id, e.created_at);
        }
        const mk = e.model_pk_used ?? 'unknown';
        const bm = byModel.get(mk) ?? { success: 0, error: 0, rejected_limit: 0, input_units: 0, output_units: 0, users: new Set() };
        bm[status]++;
        bm.input_units += Number(e.input_units ?? 0);
        bm.output_units += Number(e.output_units ?? 0);
        if (e.user_id)
            bm.users.add(e.user_id);
        byModel.set(mk, bm);
        if (e.provider_id_used) {
            const bp = byProvider.get(e.provider_id_used) ?? { success: 0, error: 0 };
            if (status === 'success')
                bp.success++;
            else if (status === 'error')
                bp.error++;
            byProvider.set(e.provider_id_used, bp);
        }
        if (status !== 'success' && e.error_code) {
            const er = errors.get(e.error_code) ?? { count: 0, last_at: e.created_at };
            er.count++;
            er.last_at = e.created_at;
            errors.set(e.error_code, er);
        }
    }
    totals.users = activeUsers.size;
    // Per user × model quota state (limits = user override, else the plan's entitlement).
    const userIds = Array.from(new Set([...usageRows.map((r) => r.user_id), ...planUsageRows.map((r) => r.user_id), ...activeUsers])).filter(Boolean).slice(0, 500);
    const [profilesRes, overridesRes] = await Promise.all([
        userIds.length ? supabase.from('profiles').select('id,email,display_name').in('id', userIds) : { data: [] },
        userIds.length
            ? supabase.from('ai_user_overrides').select('user_id,model_pk,override_enabled,override_monthly_request_limit').in('user_id', userIds)
            : { data: [] },
    ]);
    const profiles = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
    const overrides = (overridesRes.data ?? []);
    // get_user_plan applies the user's subscription overrides to the plan's monthly limits.
    const plans = new Map();
    for (let i = 0; i < userIds.length; i += 10) {
        await Promise.all(userIds.slice(i, i + 10).map(async (uid) => {
            const { data } = await supabase.rpc('get_user_plan', { uid });
            const row = Array.isArray(data) ? data[0] : data;
            plans.set(uid, {
                code: typeof row?.plan_code === 'string' ? row.plan_code : 'free',
                request_limit: Number(row?.request_limit ?? 0),
                char_limit: Number(row?.char_limit ?? 0),
            });
        }));
    }
    const entitlements = (entRes.data ?? []);
    const limitState = (used, limit) => (limit > 0 && used >= limit ? 'exhausted' : limit > 0 && used / limit >= 0.8 ? 'near' : 'ok');
    const users = userIds.map((uid) => {
        const planInfo = plans.get(uid) ?? { code: 'free', request_limit: 0, char_limit: 0 };
        const plan = planInfo.code;
        const planRow = planUsageRows.find((r) => r.user_id === uid);
        const requestsUsed = Number(planRow?.requests_used ?? 0);
        const charsUsed = Number(planRow?.chars_used ?? 0);
        const planStates = [limitState(requestsUsed, planInfo.request_limit), limitState(charsUsed, planInfo.char_limit)];
        const planUsage = {
            requests_used: requestsUsed,
            request_limit: planInfo.request_limit > 0 ? planInfo.request_limit : null,
            chars_used: charsUsed,
            char_limit: planInfo.char_limit > 0 ? planInfo.char_limit : null,
            state: planStates.includes('exhausted') ? 'exhausted' : planStates.includes('near') ? 'near' : 'ok',
        };
        const rows = usageRows.filter((r) => r.user_id === uid);
        const modelIds = new Set([...rows.map((r) => r.model_pk), ...overrides.filter((o) => o.user_id === uid).map((o) => o.model_pk)]);
        const quotas = Array.from(modelIds)
            .map((mpk) => {
            const model = modelById.get(mpk);
            const ent = entitlements.find((e) => e.plan_code === plan && e.model_pk === mpk);
            const ov = overrides.find((o) => o.user_id === uid && o.model_pk === mpk);
            const used = Number(rows.find((r) => r.model_pk === mpk)?.requests_used ?? 0);
            const enabled = ov?.override_enabled ?? ent?.is_enabled ?? false;
            const limit = Number(ov?.override_monthly_request_limit ?? ent?.monthly_request_limit ?? 0);
            const remaining = limit > 0 ? Math.max(0, limit - used) : null;
            const state = !enabled ? 'disabled' : limit > 0 && used >= limit ? 'exhausted' : limit > 0 && used / limit >= 0.8 ? 'near' : 'ok';
            return {
                model_pk: mpk,
                model_id: model?.model_id ?? mpk,
                display_name: model?.display_name ?? mpk,
                used,
                limit: limit > 0 ? limit : null,
                remaining,
                state,
                overridden: ov?.override_monthly_request_limit != null || ov?.override_enabled != null,
            };
        })
            .sort((a, b) => (b.limit ? b.used / b.limit : 0) - (a.limit ? a.used / a.limit : 0));
        const states = [...quotas.map((q) => q.state), planUsage.state];
        const worst = states.includes('exhausted') ? 'exhausted' : states.includes('near') ? 'near' : 'ok';
        const p = profiles.get(uid);
        return {
            user_id: uid,
            email: p?.email ?? null,
            display_name: p?.display_name ?? null,
            plan_code: plan,
            total_requests: rows.reduce((s, r) => s + Number(r.requests_used ?? 0), 0),
            plan_usage: planUsage,
            quotas,
            state: worst,
            last_active_at: lastActive.get(uid) ?? [...rows.map((r) => r.updated_at), planRow?.updated_at].filter(Boolean).sort().pop() ?? null,
        };
    });
    users.sort((a, b) => ({ exhausted: 0, near: 1, ok: 2 })[a.state] - ({ exhausted: 0, near: 1, ok: 2 })[b.state] || b.total_requests - a.total_requests);
    return {
        month,
        totals,
        by_model: Array.from(byModel.entries())
            .map(([mk, v]) => ({
            model_pk: mk,
            model_id: modelById.get(mk)?.model_id ?? 'unknown',
            display_name: modelById.get(mk)?.display_name ?? 'Unknown model',
            success: v.success,
            error: v.error,
            rejected_limit: v.rejected_limit,
            input_units: v.input_units,
            output_units: v.output_units,
            users: v.users.size,
        }))
            .sort((a, b) => b.success + b.error + b.rejected_limit - (a.success + a.error + a.rejected_limit)),
        by_provider: Array.from(byProvider.entries()).map(([pid, v]) => ({ provider_id: pid, name: providerById.get(pid)?.name ?? pid, ...v })),
        errors: Array.from(errors.entries())
            .map(([code, v]) => ({
            code,
            count: v.count,
            last_at: v.last_at,
            explanation: ERROR_EXPLANATIONS[code] ?? (code.startsWith('provider_http_') ? describeProviderError(Number(code.replace('provider_http_', '')), '') : 'Request failed.'),
        }))
            .sort((a, b) => b.count - a.count),
        users,
    };
};
/** Resets this month's count: one AI model (modelPk), all AI models, or the plan-level meter (scope 'plan'). */
export const resetUserUsage = async (supabase, userId, month, modelPk, scope = 'models') => {
    if (scope === 'plan') {
        const { error } = await supabase.from('usage_months').delete().eq('user_id', userId).eq('month', month);
        if (error)
            throw new Error(error.message);
        return;
    }
    let q = supabase.from('ai_usage_months').delete().eq('user_id', userId).eq('month', month);
    if (modelPk)
        q = q.eq('model_pk', modelPk);
    const { error } = await q;
    if (error)
        throw new Error(error.message);
};
//# sourceMappingURL=adminAiConsole.js.map