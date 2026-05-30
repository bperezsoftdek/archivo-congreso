import { useCallback, useEffect, useState } from 'react'
import { API_BASE, formatApiError } from '../utils/api'
import DataTable from './DataTable'
import { useXlsxDownload } from '../utils/useXlsxDownload'
import DownloadProgressCard from './DownloadProgressCard'

const OPERACIONES = ['', 'INSERT', 'UPDATE', 'DELETE', 'DELETE_MULTIPLE']

const COLUMNS = [
  'id_registro',
  'nombre_tabla',
  'operacion',
  'id_fila_afectada',
  'usuario',
  'fecha_hora',
]

const COLUMN_LABELS = {
  id_registro: 'ID',
  nombre_tabla: 'Tabla',
  operacion: 'Operación',
  id_fila_afectada: 'Fila afectada',
  usuario: 'Usuario',
  fecha_hora: 'Fecha y hora',
}

export default function RegistrosPanel({ token }) {
  const [filters, setFilters] = useState({})
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { download, downloadProgress } = useXlsxDownload()

  const authHeaders = { Authorization: `Bearer ${token}` }

  const buildQuery = useCallback(
    (p = page) => {
      const params = new URLSearchParams({ page: String(p), limit: '50' })
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== '' && v != null) params.set(k, String(v))
      })
      return params.toString()
    },
    [filters, page],
  )

  const fetchData = useCallback(
    async (p = 1) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/registros?${buildQuery(p)}`, {
          headers: authHeaders,
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
    },
    [buildQuery, token],
  )

  useEffect(() => {
    fetchData(1)
  }, [])

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const rows = (data?.data ?? []).map((row) => ({
    ...row,
    fecha_hora: row.fecha_hora ? new Date(row.fecha_hora).toLocaleString() : '',
  }))

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1

  const extraFilters = (
    <>
      <label className="data-table-search">
        <span>Tabla</span>
        <input
          type="text"
          value={filters.nombre_tabla || ''}
          onChange={(e) => handleFilterChange('nombre_tabla', e.target.value)}
          placeholder="actas_sesiones"
        />
      </label>
      <label className="data-table-search">
        <span>Operación</span>
        <select
          value={filters.operacion || ''}
          onChange={(e) => handleFilterChange('operacion', e.target.value)}
        >
          {OPERACIONES.map((op) => (
            <option key={op || 'all'} value={op}>
              {op || 'Todas'}
            </option>
          ))}
        </select>
      </label>
      <label className="data-table-search">
        <span>Usuario</span>
        <input
          type="text"
          value={filters.usuario || ''}
          onChange={(e) => handleFilterChange('usuario', e.target.value)}
          placeholder="usuario"
        />
      </label>
      <label className="data-table-search">
        <span>ID fila afectada</span>
        <input
          type="number"
          value={filters.id_fila_afectada || ''}
          onChange={(e) => handleFilterChange('id_fila_afectada', e.target.value)}
          placeholder="Ej. 100"
        />
      </label>
    </>
  )

  const handleExport = async () => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v != null) params.set(k, String(v))
    })
    try {
      await download({
        url: `${API_BASE}/registros/exportar?${params}`,
        filename: `auditoria_${new Date().toISOString().slice(0, 10)}.xlsx`,
        headers: authHeaders,
      })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="card">
      <h2>Auditoría de operaciones</h2>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        Registro de INSERT, UPDATE y DELETE en tablas documentales, con usuario de la aplicación.
      </p>

      {error && <div className="result-box error">{error}</div>}
      <DownloadProgressCard progress={downloadProgress} />

      <div style={{ marginBottom: '0.75rem' }}>
        <button type="button" className="btn secondary" onClick={handleExport}>
          Exportar Excel (.xlsx)
        </button>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={rows}
        columnLabels={COLUMN_LABELS}
        pk="id_registro"
        page={page}
        total={data?.total ?? 0}
        pageSize={50}
        onPageChange={(p) => fetchData(p)}
        loading={loading}
        extraToolbar={
          <>
            {extraFilters}
            <button type="button" className="btn" onClick={() => fetchData(1)} disabled={loading}>
              Buscar
            </button>
          </>
        }
      />
    </div>
  )
}
