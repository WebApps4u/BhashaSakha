import { supabase } from '@/lib/supabaseClient'

export class InterviewApiError extends Error {
  status: number
  code: string | null
  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.status = status
    this.code = code
  }
}

const authHeader = async () => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  if (!token) throw new InterviewApiError('Please sign in to continue.', 401, 'unauthorized')
  return { Authorization: `Bearer ${token}` }
}

/** Authenticated call to /api/interview/*; throws InterviewApiError with the server's message. */
export async function interviewApi<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = await authHeader()
  if (!init.form && init.body !== undefined) headers['Content-Type'] = 'application/json'

  let resp: Response
  try {
    resp = await fetch(`/api/interview${path}`, {
      method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    })
  } catch (err) {
    if ((err as any)?.name === 'AbortError') throw err
    throw new InterviewApiError('Connection lost. Check your network and try again.', 0, 'network')
  }

  const json = (await resp.json().catch(() => ({}))) as any
  if (!resp.ok || json?.success === false) {
    throw new InterviewApiError(json?.error ?? `Request failed (${resp.status})`, resp.status, json?.code ?? null)
  }
  return json as T
}
