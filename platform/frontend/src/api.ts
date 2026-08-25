export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (!response.ok) {
    // A 401 means the BFF session is gone (e.g. Keycloak back-channel logout
    // revoked it). Redirect to login instead of surfacing a broken API error.
    if (response.status === 401 && !window.location.pathname.startsWith('/auth/')) {
      const returnTo = window.location.pathname + window.location.search
      window.location.assign(`/auth/login?return_to=${encodeURIComponent(returnTo)}`)
    }
    let code = `HTTP_${response.status}`
    let message = response.statusText
    try {
      const payload = await response.json()
      code = payload.error?.code ?? code
      message = payload.error?.message ?? message
    } catch {
      // Non-JSON errors retain the stable HTTP fallback.
    }
    throw new ApiClientError(response.status, code, message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
