import { useCallback, useEffect, useState } from 'react'
import { formatApiError } from '../utils/api'

import { API_BASE } from '../utils/api'

const OPERACIONES = ['', 'INSERT', 'UPDATE', 'DELETE', 'DELETE_MULTIPLE']

export default function RegistrosPanel({ token }) {
  const [filters, setFilters] = useState({})
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const buildQuery = useCallback((p = page) => {
    const params = new URLSearchParams({ page: p, limit: 50 })
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    return params.toString()
  }, [filters, page])

  const fetchData = useCallback(async (p = 1) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/registros?${buildQuery(p)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setData(body)
      setPage(p)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [buildQuery, token])

  useEffect(() => { fetchData(1) }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1

  return (
    <div className="card">
      <h2>Auditoria de operaciones</h2>

      <div className="filters">
        <label>
          Tabla
          <input
            type="text"
            value={filters.nombre_tabla || ''}
            onChange={e => setFilters(prev => ({ ...prev, nombre_tabla: e.target.value }))}
            placeholder="actas_sesiones"
          />
        </label>
        <label>
          Operacion
          <select
            value={filters.operacion || ''}
            onChange={e => setFilters(prev => ({ ...prev, operacion: e.target.value }))}
          >
            {OPERACIONES.map(op => <option key={op || 'all'} value={op}>{op || 'Todas'}</option>)}
          </select>
        </label>
        <label>
          Usuario
          <input
            type="text"
            value={filters.usuario || ''}
            onChange={e => setFilters(prev => ({ ...prev, usuario: e.target.value }))}
            placeholder="usuario"
          />
        </label>
        <button className="btn" onClick={() => fetchData(1)} disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {error && <div className="result-box error">{error}</div>}

      {data && (
        <>
          <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: '#555' }}>
            {data.total} registros encontrados
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tabla</th>
                  <th>Operacion</th>
                  <th>Fila afectada</th>
                  <th>Usuario</th>
                  <th>Fecha y hora</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(row => (
                  <tr key={row.id_registro}>
                    <td>{row.id_registro}</td>
                    <td title={row.nombre_tabla}>{row.nombre_tabla}</td>
                    <td>{row.operacion}</td>
                    <td>{row.id_fila_afectada ?? ''}</td>
                    <td title={row.usuario}>{row.usuario}</td>
                    <td>{row.fecha_hora ? new Date(row.fecha_hora).toLocaleString() : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="btn" onClick={() => fetchData(page - 1)} disabled={page <= 1 || loading}>Anterior</button>
            <span style={{ fontSize: '0.85rem' }}>Pagina {page} de {totalPages}</span>
            <button className="btn" onClick={() => fetchData(page + 1)} disabled={page >= totalPages || loading}>Siguiente</button>
          </div>
        </>
      )}
    </div>
  )
}
