/** Base de la API: relativa (/api) en local o URL absoluta al exponer el backend por túnel. */
export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export const API_AUTH = `${API_BASE}/auth`

/** Extrae mensaje legible de respuestas de error FastAPI. */
export function formatApiError(body, fallback = 'Error desconocido') {
  if (!body?.detail) return fallback
  const d = body.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map(item => item.msg || JSON.stringify(item)).join('; ')
  }
  return String(d)
}
