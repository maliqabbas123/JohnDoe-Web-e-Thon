export const isLive = process.env.NEXT_PUBLIC_DEMO_MODE !== 'true'

type ErrorDetail = { path: string; message: string }
type ApiResponse<T> = { data: T; meta?: Record<string, unknown> }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
    readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const sessionExpiredEvent = 'proctorate:session-expired'

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers)
  if (typeof options.body === 'string' && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')
  const response = await fetch('/api/v1' + path, {
    ...options,
    headers,
    credentials: 'include',
    cache: 'no-store',
  })
  if (response.status === 204) return { data: undefined as T }
  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    if (
      response.status === 401 &&
      !['/auth/login', '/auth/signup'].includes(path) &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new Event(sessionExpiredEvent))
    }
    const retryAfter = response.headers.get('Retry-After')
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
      payload?.error?.details,
      retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined,
    )
  }
  if (!payload || !('data' in payload))
    throw new ApiError(502, 'INVALID_RESPONSE', 'The API returned an invalid response.')
  return payload
}
