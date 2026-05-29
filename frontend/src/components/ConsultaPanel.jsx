import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatApiError, API_BASE } from '../utils/api'
import DataTable from './DataTable'
import { useXlsxDownload } from '../utils/useXlsxDownload'
import DownloadProgressCard from './DownloadProgressCard'
import EditModal from './EditModal'

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
  const [editingRow, setEditingRow] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)
  const { download, downloadProgress } = useXlsxDownload()

  const authHeaders = { Authorization: `Bearer ${token}` }

  const tablaMeta = tablas.find((t) => t.tabla === tabla)
  const consultaMeta = tablaMeta?.consulta || {}
  const pkCol = data?.pk || tablaMeta?.pk || 'id_acta'
  const searchFields = consultaMeta.search_fields || []
  const extraFilters = consultaMeta.extra_filters || []
  const hiddenColumns = consultaMeta.hidden_columns || ['id_fondo', 'id_subfondo']
  const baseColumnLabels = consultaMeta.column_labels || {}

  const buildQuery = useCallback(
    (p = page) => {
      const params = new URLSearchParams({ page: String(p), limit: '50' })
      if (sort) {
        params.set('sort', sort)
        params.set('order', order)
      }
      Object.entries(filters).forEach(([k, v]) => {
        if (v === '' || v == null) return
        const field = searchFields.find((f) => f.key === k)
        if (field?.maps_to === 'id_registro') {
          params.set('id_registro', String(v))
        } else {
          params.set(k, String(v))
        }
      })
      return params.toString()
    },
    [filters, page, sort, order, searchFields],
  )

  const fetchData = useCallback(
    async (p = 1) => {
      if (!tabla) return
      setLoading(true)
      setError(null)
      setSelected(new Set())
      try {
        const res = await fetch(`${API_BASE}/consultar/${tabla}?${buildQuery(p)}`, {
          headers: authHeaders,
        })
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
    [tabla, buildQuery, token],
  )

  useEffect(() => {
    if (tabla) fetchData(1)
  }, [tabla, sort, order])

  const handleSearchFieldChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleSort = (col) => {
    if (sort === col) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(col)
      setOrder('asc')
    }
  }

  const handleExport = async () => {
    if (!tabla) return
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v === '' || v == null) return
      const field = searchFields.find((f) => f.key === k)
      if (field?.maps_to === 'id_registro') params.set('id_registro', String(v))
      else params.set(k, String(v))
    })
    try {
      await download({
        url: `${API_BASE}/exportar/${tabla}?${params}`,
        filename: `${tabla}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        headers: authHeaders,
      })
    } catch (e) {
      setError(e.message)
    }
  }

  const toggleSelect = (rowIdx) => {
    const newSelected = new Set(selected)
    if (newSelected.has(rowIdx)) newSelected.delete(rowIdx)
    else newSelected.add(rowIdx)
    setSelected(newSelected)
  }

  const selectAll = () => {
    if (!data?.data?.length) return
    if (selected.size === data.data.length) setSelected(new Set())
    else setSelected(new Set(data.data.map((_, i) => i)))
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`¿Eliminar ${selected.size} registro(s)? Esta acción no se puede deshacer.`))
      return

    setDeleting(true)
    setError(null)
    setDeleteMessage(null)

    try {
      const pk = data.pk || pkCol
      const idsToDelete = Array.from(selected).map((idx) => data.data[idx][pk])

      const res = await fetch(`${API_BASE}/registros/delete-multiple/${tabla}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))

      setDeleteMessage(body.message || `${body.deleted_count} registro(s) eliminado(s) exitosamente`)
      if (body.failed_ids?.length > 0) {
        setError(`No se pudieron eliminar ${body.failed_ids.length} ID(s): ${body.failed_ids.join(', ')}`)
      }
      setSelected(new Set())
      await fetchData(page)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleSaveEdit = async (formData) => {
    if (!editingRow) return
    setSaving(true)
    setEditError(null)
    try {
      const pk = data.pk || pkCol
      const id = editingRow[pk]
      const res = await fetch(`${API_BASE}/registros/${tabla}/${id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setEditingRow(null)
      setDeleteMessage('Registro actualizado exitosamente')
      await fetchData(page)
    } catch (e) {
      setEditError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const allColumns = data?.data?.[0] ? Object.keys(data.data[0]) : []
  const columns = allColumns.filter((c) => !hiddenColumns.includes(c))
  const columnsWithActions = isAdmin ? [...columns, '_acciones'] : columns
  const columnLabels = { ...baseColumnLabels, ...(data?.column_labels || {}), _acciones: 'Acciones' }
  const totalPages = data ? Math.ceil(data.total / 50) : 0

  const extraFiltersUi = useMemo(
    () => (
      <>
        {extraFilters.map((f) => (
          <label key={f.key} className="data-table-search">
            <span>{f.label}</span>
            <input
              type={f.type || 'text'}
              value={filters[f.key] || ''}
              onChange={(e) => handleSearchFieldChange(f.key, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
              placeholder={f.label}
              style={{ width: f.type === 'number' ? 90 : 140 }}
            />
          </label>
        ))}
      </>
    ),
    [extraFilters, filters, fetchData],
  )

  return (
    <div className="card">
      <h2>Consulta de documentos</h2>

      {editingRow && (
        <EditModal
          row={editingRow}
          columns={columns.filter((c) => c !== pkCol)}
          columnLabels={columnLabels}
          pk={pkCol}
          onSave={handleSaveEdit}
          onCancel={() => { setEditingRow(null); setEditError(null) }}
          saving={saving}
          error={editError}
        />
      )}

      <div className="filters" style={{ marginBottom: '1rem' }}>
        <label>
          Tipo documental
          <select
            value={tabla}
            onChange={(e) => {
              setTabla(e.target.value)
              setData(null)
              setFilters({})
              setPage(1)
              setSort('')
            }}
          >
            <option value="">-- Seleccionar --</option>
            {tablas.map((t) => (
              <option key={t.tabla} value={t.tabla}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <button type="button" className="btn secondary" onClick={handleExport}>
            Exportar Excel (.xlsx)
          </button>
        )}
      </div>

      {error && <div className="result-box error">{error}</div>}
      {deleteMessage && <div className="result-box success">{deleteMessage}</div>}
      <DownloadProgressCard progress={downloadProgress} />

      {tabla && (
        <>
          {isAdmin && selected.size > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                className="btn danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Eliminando...' : `Eliminar ${selected.size} registro(s)`}
              </button>
            </div>
          )}

          <DataTable
            columns={columnsWithActions}
            rows={data?.data ?? []}
            columnLabels={columnLabels}
            pk={pkCol}
            page={page}
            totalPages={totalPages}
            total={data?.total ?? 0}
            limit={50}
            sort={sort}
            order={order}
            onSort={handleSort}
            onPageChange={(p) => fetchData(p)}
            searchFields={searchFields}
            searchValues={filters}
            onSearchFieldChange={handleSearchFieldChange}
            onSearch={() => fetchData(1)}
            loading={loading}
            isAdmin={isAdmin}
            selected={selected}
            onToggleSelect={toggleSelect}
            onSelectAll={selectAll}
            extraFilters={extraFiltersUi}
            renderCell={(row, col) => {
              if (col === '_acciones') {
                return (
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => { setEditingRow(row); setEditError(null) }}
                  >
                    Editar
                  </button>
                )
              }
              return row[col] ?? ''
            }}
          />
        </>
      )}
    </div>
  )
}
