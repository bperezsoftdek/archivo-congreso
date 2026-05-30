import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE, formatApiError } from '../utils/api'
import DataTable from './DataTable'
import { useXlsxDownload } from '../utils/useXlsxDownload'
import DownloadProgressCard from './DownloadProgressCard'

const ESTADO_BADGE = {
  activo: 'badge-success',
  parcial: 'badge-warning',
  sin_datos: 'badge-warning',
  vacio: 'badge-muted',
  pendiente: 'badge-info',
  revertido: 'badge-danger',
  done: 'badge-success',
  pending: 'badge-info',
  error: 'badge-danger',
  subido: 'badge-success',
  'Eliminado (revertido)': 'badge-danger',
  Subido: 'badge-success',
  Subiendo: 'badge-info',
  Error: 'badge-danger',
}

function Badge({ value }) {
  const cls = ESTADO_BADGE[value] || 'badge-muted'
  return <span className={`badge ${cls}`}>{value ?? '—'}</span>
}

const TABLE_COLUMNS = [
  'id_archivo',
  'tipo_label',
  'nombre_archivo',
  'estado_historial',
  'version_por_nombre',
  'fecha_carga',
  'usuario_carga',
  'fecha_reversion',
  'usuario_reversion',
  'registros_eliminados',
  'cantidad_registros',
  'registros_en_bd',
  'archivo_en_disco',
  'ultimo_evento',
  'acciones',
]

const COLUMN_LABELS = {
  id_archivo: 'ID',
  tipo_label: 'Tipo documental',
  nombre_archivo: 'Archivo',
  estado_historial: 'Estado',
  version_por_nombre: 'Versión',
  fecha_carga: 'Fecha subida',
  usuario_carga: 'Subido por',
  fecha_reversion: 'Fecha eliminación',
  usuario_reversion: 'Eliminado por',
  registros_eliminados: 'Reg. eliminados',
  cantidad_registros: 'Insertados',
  registros_en_bd: 'Activos en BD',
  archivo_en_disco: 'En disco',
  ultimo_evento: 'Último evento',
  acciones: 'Acciones',
}

export default function ControlArchivosPanel({ tablas, token, isAdmin }) {
  const [filtroTabla, setFiltroTabla] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroNombre, setFiltroNombre] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [historial, setHistorial] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const { download, downloadProgress } = useXlsxDownload()

  const authHeaders = { Authorization: `Bearer ${token}` }

  const handleExport = async () => {
    const params = new URLSearchParams()
    if (filtroTabla) params.set('tabla', filtroTabla)
    if (filtroEstado) params.set('estado', filtroEstado)
    if (filtroNombre.trim()) params.set('nombre', filtroNombre.trim())
    try {
      await download({
        url: `${API_BASE}/archivos-control/exportar?${params}`,
        filename: `control_archivos_${new Date().toISOString().slice(0, 10)}.xlsx`,
        headers: authHeaders,
      })
    } catch (e) {
      setError(e.message)
    }
  }

  const fetchData = useCallback(
    async (p = 1) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ page: String(p), limit: '25' })
        if (filtroTabla) params.set('tabla', filtroTabla)
        if (filtroEstado) params.set('estado', filtroEstado)
        if (filtroNombre.trim()) params.set('nombre', filtroNombre.trim())

        const res = await fetch(`${API_BASE}/archivos-control?${params}`, { headers: authHeaders })
        const body = await res.json()
        if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
        setData(body)
        setPage(p)
      } catch (e) {
        setError(e.message)
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [filtroTabla, filtroEstado, filtroNombre, token],
  )

  useEffect(() => {
    fetchData(1)
  }, [fetchData])

  const rowsDisplay = useMemo(() => {
    if (!data?.data) return []
    return data.data.map((row) => ({
      ...row,
      fecha_carga: row.fecha_carga ? new Date(row.fecha_carga).toLocaleString() : '',
      fecha_reversion: row.fecha_reversion
        ? new Date(row.fecha_reversion).toLocaleString()
        : '—',
      usuario_reversion: row.usuario_reversion || '—',
      registros_eliminados: row.registros_eliminados ?? (row.estado === 'revertido' ? '—' : 0),
      archivo_en_disco: row.archivo_en_disco ? 'Sí' : 'No',
      _raw: row,
    }))
  }, [data])

  const totalPages = data ? Math.ceil(data.total / (data.limit || 25)) : 0

  const loadHistorial = async (idArchivo) => {
    setHistorial(null)
    try {
      const res = await fetch(`${API_BASE}/archivos-control/${idArchivo}/historial`, {
        headers: authHeaders,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setHistorial(body)
    } catch (e) {
      setError(e.message)
    }
  }

  const loadPreview = async (row) => {
    const tabla = row._raw?.tabla_destino || row.tabla_destino
    const idArchivo = row._raw?.id_archivo || row.id_archivo
    setError(null)
    setMessage(null)
    setConfirmText('')
    setHistorial(null)
    try {
      const res = await fetch(
        `${API_BASE}/archivos/${tabla}/${idArchivo}/preview-eliminacion`,
        { headers: authHeaders },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setPreview({ ...body, tabla })
      await loadHistorial(idArchivo)
    } catch (e) {
      setError(e.message)
      setPreview(null)
    }
  }

  const handleDelete = async () => {
    if (!preview?.archivo || !preview.tabla) return
    if (confirmText !== preview.requiere_confirmacion) {
      setError('Escriba el nombre exacto del archivo para confirmar')
      return
    }
    if (
      !window.confirm(
        `¿Eliminar ${preview.registros_existentes_en_tabla} registro(s) del archivo «${preview.archivo.nombre_archivo}»? El historial de la carga se conservará.`,
      )
    )
      return

    setDeleting(true)
    try {
      const res = await fetch(
        `${API_BASE}/archivos/${preview.tabla}/${preview.archivo.id_archivo}/eliminar-por-archivo`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmar: true, texto_confirmacion: confirmText }),
        },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setMessage(
        (body.mensaje || '') +
          ' El registro permanece en el listado como «Eliminado (revertido)».',
      )
      setPreview(null)
      setHistorial(null)
      setConfirmText('')
      await fetchData(page)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const renderCell = (row, col) => {
    if (col === 'acciones') {
      return (
        <div className="row-actions">
          <button
            type="button"
            className="btn secondary"
            style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
            onClick={() => loadHistorial(row._raw?.id_archivo || row.id_archivo)}
          >
            Historial
          </button>
          {isAdmin && row._raw?.puede_revertir && (
            <button
              type="button"
              className="btn danger"
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
              onClick={() => loadPreview(row)}
            >
              Revertir
            </button>
          )}
        </div>
      )
    }
    if (col === 'estado_historial' || col === 'ultimo_evento') {
      return <Badge value={row[col]} />
    }
    if (col === 'nombre_archivo') {
      return <span title={row._raw?.ruta_archivo || ''}>{row[col]}</span>
    }
    return row[col] ?? ''
  }

  return (
    <div className="card">
      <h2>Control de archivos</h2>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        Historial de todos los Excel subidos: cuáles siguen activos, cuáles fueron revertidos
        (eliminados) y trazabilidad por eventos. Las cargas revertidas permanecen en la lista.
      </p>

      <div className="filters">
        <label>
          Tipo documental
          <select value={filtroTabla} onChange={(e) => setFiltroTabla(e.target.value)}>
            <option value="">Todos</option>
            {tablas.map((t) => (
              <option key={t.tabla} value={t.tabla}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="pending">Subiendo (pending)</option>
            <option value="done">Subido (done)</option>
            <option value="revertido">Eliminado (revertido)</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          Nombre archivo
          <input
            type="text"
            value={filtroNombre}
            onChange={(e) => setFiltroNombre(e.target.value)}
            placeholder="Buscar por nombre..."
            onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
          />
        </label>
        <button type="button" className="btn" onClick={() => fetchData(1)} disabled={loading}>
          {loading ? 'Cargando...' : 'Buscar'}
        </button>
        <button type="button" className="btn secondary" onClick={handleExport}>
          Exportar Excel (.xlsx)
        </button>
      </div>

      {error && <div className="result-box error">{error}</div>}
      {message && <div className="result-box success">{message}</div>}
      <DownloadProgressCard progress={downloadProgress} />

      <DataTable
        columns={TABLE_COLUMNS}
        rows={rowsDisplay}
        columnLabels={COLUMN_LABELS}
        pk="id_archivo"
        page={page}
        total={data?.total ?? 0}
        pageSize={data?.limit ?? 25}
        onPageChange={(p) => fetchData(p)}
        loading={loading}
        renderCell={renderCell}
      />

      {historial && !preview && (
        <div className="result-box" style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
            Historial — {historial.archivo?.nombre_archivo} (ID {historial.archivo?.id_archivo})
          </h3>
          <p style={{ fontSize: '0.85rem' }}>
            Estado actual: <strong>{historial.archivo?.estado}</strong>
            {historial.archivo?.fecha_reversion && (
              <> · Revertido el {new Date(historial.archivo.fecha_reversion).toLocaleString()}</>
            )}
          </p>
          <ul className="historial-eventos">
            {historial.eventos?.map((ev) => (
              <li key={ev.id_evento}>
                <strong>{ev.evento}</strong> — {ev.usuario} —{' '}
                {new Date(ev.fecha_evento).toLocaleString()}
                {ev.detalle && Object.keys(ev.detalle).length > 0 && (
                  <span className="historial-detalle">
                    {' '}
                    ({JSON.stringify(ev.detalle)})
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn secondary" onClick={() => setHistorial(null)}>
            Cerrar
          </button>
        </div>
      )}

      {preview && (
        <div className="result-box preview" style={{ marginTop: '1rem' }}>
          <p>
            <strong>{preview.mensaje}</strong>
          </p>
          {historial?.eventos?.length > 0 && (
            <details className="details-panel">
              <summary className="details-summary-sm">Ver historial de eventos</summary>
              <ul className="historial-eventos" style={{ marginTop: '0.5rem' }}>
                {historial.eventos.map((ev) => (
                  <li key={ev.id_evento}>
                    {ev.evento} — {ev.usuario} — {new Date(ev.fecha_evento).toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem' }}>
            Confirme escribiendo: <em>{preview.requiere_confirmacion}</em>
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            style={{ width: '100%', maxWidth: 400, marginBottom: '0.75rem' }}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn danger"
              onClick={handleDelete}
              disabled={deleting || confirmText !== preview.requiere_confirmacion}
            >
              {deleting ? 'Eliminando...' : 'Eliminar registros del archivo'}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setPreview(null)
                setHistorial(null)
                setConfirmText('')
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
