import { useState, useEffect, useCallback } from 'react'

const API = '/api'

const FILTERS = [
  { key: 'codigo_referencia', label: 'Codigo de referencia' },
  { key: 'titulo_formal', label: 'Titulo formal' },
  { key: 'palabras_clave', label: 'Palabras clave' },
  { key: 'fecha_inicial_ano', label: 'Ano inicial', type: 'number' },
  { key: 'fecha_final_ano', label: 'Ano final', type: 'number' },
]

export default function ConsultaPanel({ tablas, token, isAdmin }) {
  const [tabla, setTabla] = useState('')
  const [filters, setFilters] = useState({})
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('')
  const [order, setOrder] = useState('asc')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState(null)

  const authHeaders = { Authorization: `Bearer ${token}` }

  const buildQuery = useCallback((p = page) => {
    const params = new URLSearchParams({ page: p, limit: 50 })
    if (sort) { params.set('sort', sort); params.set('order', order) }
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    return params.toString()
  }, [filters, page, sort, order])

  const fetchData = useCallback(async (p = 1) => {
    if (!tabla) return
    setLoading(true)
    setError(null)
    setSelected(new Set())
    try {
      const res = await fetch(`${API}/consultar/${tabla}?${buildQuery(p)}`, { headers: authHeaders })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
      setData(body)
      setPage(p)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [tabla, buildQuery, token])

  useEffect(() => { if (tabla) fetchData(1) }, [tabla])

  const handleExport = async () => {
    if (!tabla) return
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    const res = await fetch(`${API}/exportar/${tabla}?${params}`, { headers: authHeaders })
    if (!res.ok) {
      const body = await res.json()
      setError(body.detail || `HTTP ${res.status}`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${tabla}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleSelect = (rowIdx) => {
    const newSelected = new Set(selected)
    if (newSelected.has(rowIdx)) {
      newSelected.delete(rowIdx)
    } else {
      newSelected.add(rowIdx)
    }
    setSelected(newSelected)
  }

  const selectAll = () => {
    if (selected.size === data.data.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(data.data.map((_, i) => i)))
    }
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`¿Eliminar ${selected.size} registro(s)? Esta acción no se puede deshacer.`)) return

    setDeleting(true)
    setError(null)
    setDeleteMessage(null)

    try {
      const pkCol = Object.keys(data.data[0])[0]
      const idsToDelete = Array.from(selected).map(idx => data.data[idx][pkCol])
      
      const res = await fetch(`${API}/registros/delete-multiple/${tabla}`, {
        method: 'POST',
        headers: { 
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: idsToDelete }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
      
      setDeleteMessage(`${body.deleted_count} registro(s) eliminado(s) exitosamente`)
      setSelected(new Set())
      await fetchData(page)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const columns = data?.data?.[0] ? Object.keys(data.data[0]) : []
  const totalPages = data ? Math.ceil(data.total / 50) : 0

  return (
    <div className="card">
      <h2>Consulta de documentos</h2>

      <div className="filters">
        <label>
          Tipo documental
          <select value={tabla} onChange={e => { setTabla(e.target.value); setData(null) }}>
            <option value="">-- Seleccionar --</option>
            {tablas.map(t => <option key={t.tabla} value={t.tabla}>{t.label}</option>)}
          </select>
        </label>

        {FILTERS.map(f => (
          <label key={f.key}>
            {f.label}
            <input
              type={f.type || 'text'}
              value={filters[f.key] || ''}
              onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.label}
              style={{ width: f.type === 'number' ? 90 : 160 }}
            />
          </label>
        ))}

        <button className="btn" onClick={() => fetchData(1)} disabled={!tabla || loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
        {data && (
          <button className="btn secondary" onClick={handleExport}>Exportar CSV</button>
        )}
      </div>

      {error && <div className="result-box error">{error}</div>}
      {deleteMessage && <div className="result-box">{deleteMessage}</div>}

      {data && (
        <>
          <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: '#555' }}>
            {data.total} registros encontrados {selected.size > 0 && `(${selected.size} seleccionado${selected.size > 1 ? 's' : ''})`}
          </p>
          {isAdmin && selected.size > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <button className="btn" onClick={handleDelete} disabled={deleting} style={{ background: '#dc3545' }}>
                {deleting ? 'Eliminando...' : `Eliminar ${selected.size} registro(s)`}
              </button>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {isAdmin && (
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === data.data.length}
                        onChange={selectAll}
                        title="Seleccionar todo"
                      />
                    </th>
                  )}
                  {columns.map(c => (
                    <th key={c} style={{ cursor: 'pointer' }} onClick={() => {
                      if (sort === c) setOrder(o => o === 'asc' ? 'desc' : 'asc')
                      else { setSort(c); setOrder('asc') }
                    }}>
                      {c} {sort === c ? (order === 'asc' ? 'ASC' : 'DESC') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => (
                  <tr key={i} style={{ background: selected.has(i) ? '#f0f0f0' : 'transparent' }}>
                    {isAdmin && (
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleSelect(i)}
                        />
                      </td>
                    )}
                    {columns.map(c => <td key={c} title={row[c]}>{row[c] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="btn" onClick={() => fetchData(page - 1)} disabled={page <= 1}>Anterior</button>
            <span style={{ fontSize: '0.85rem' }}>Pagina {page} de {totalPages}</span>
            <button className="btn" onClick={() => fetchData(page + 1)} disabled={page >= totalPages}>Siguiente</button>
          </div>
        </>
      )}
    </div>
  )
}
