import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, TextField,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import SearchIcon from '@mui/icons-material/Search'
import { API_BASE, formatApiError } from '../utils/api'
import DataTable from './DataTable'
import { useXlsxDownload } from '../utils/useXlsxDownload'
import DownloadProgressCard from './DownloadProgressCard'
import EditModal from './EditModal'

const PAGE_SIZE = 50

export default function ConsultaPanel({ tablas, token, isAdmin }) {
  const [tabla, setTabla] = useState('')
  const [filters, setFilters] = useState({})
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('')
  const [order, setOrder] = useState('asc')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState(null)
  const [editingRow, setEditingRow] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState(null)
  const { download, downloadProgress } = useXlsxDownload()

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const tablaMeta = tablas.find((t) => t.tabla === tabla)
  const consultaMeta = tablaMeta?.consulta || {}
  const pkCol = data?.pk || tablaMeta?.pk || 'id_acta'
  const searchFields = consultaMeta.search_fields || []
  const extraFilters = consultaMeta.extra_filters || []
  const hiddenColumns = consultaMeta.hidden_columns || ['id_fondo', 'id_subfondo']
  const baseColumnLabels = consultaMeta.column_labels || {}

  const buildQuery = useCallback(
    (p = page) => {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) })
      if (sort) {
        params.set('sort', sort)
        params.set('order', order)
      }
      Object.entries(filters).forEach(([key, value]) => {
        if (value === '' || value == null) return
        const field = searchFields.find((f) => f.key === key)
        params.set(field?.maps_to === 'id_registro' ? 'id_registro' : key, String(value))
      })
      return params.toString()
    },
    [filters, order, page, searchFields, sort],
  )

  const fetchData = useCallback(
    async (p = 1) => {
      if (!tabla) return
      setLoading(true)
      setError(null)
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
    [authHeaders, buildQuery, tabla],
  )

  useEffect(() => {
    if (tabla) fetchData(1)
  }, [tabla, sort, order])

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleExport = async () => {
    if (!tabla) return
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value === '' || value == null) return
      const field = searchFields.find((f) => f.key === key)
      params.set(field?.maps_to === 'id_registro' ? 'id_registro' : key, String(value))
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

  const handleDeleteRows = async (rowsToDelete) => {
    if (!rowsToDelete?.length) return
    if (!window.confirm(`Eliminar ${rowsToDelete.length} registro(s)? Esta accion no se puede deshacer.`)) return

    setDeleting(true)
    setError(null)
    setMessage(null)
    try {
      const idsToDelete = rowsToDelete.map((row) => row[pkCol]).filter((id) => id != null)
      const res = await fetch(`${API_BASE}/registros/delete-multiple/${tabla}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setMessage(body.message || `${body.deleted_count} registro(s) eliminado(s) exitosamente`)
      if (body.failed_ids?.length > 0) {
        setError(`No se pudieron eliminar ${body.failed_ids.length} ID(s): ${body.failed_ids.join(', ')}`)
      }
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
      const id = editingRow[pkCol]
      const res = await fetch(`${API_BASE}/registros/${tabla}/${id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setEditingRow(null)
      setMessage('Registro actualizado exitosamente')
      await fetchData(page)
    } catch (e) {
      setEditError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const columns = (data?.data?.[0] ? Object.keys(data.data[0]) : [])
    .filter((col) => !hiddenColumns.includes(col))
  const columnLabels = { ...baseColumnLabels, ...(data?.column_labels || {}) }

  const filtersToolbar = useMemo(() => (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      {[...searchFields, ...extraFilters].map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          type={field.type || 'text'}
          value={filters[field.key] || ''}
          onChange={(e) => handleFilterChange(field.key, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
          size="small"
          sx={{ width: field.type === 'number' ? 130 : 190 }}
        />
      ))}
      <Button variant="contained" startIcon={<SearchIcon />} onClick={() => fetchData(1)} disabled={!tabla || loading}>
        Buscar
      </Button>
      <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} disabled={!data}>
        Exportar
      </Button>
    </Box>
  ), [data, extraFilters, fetchData, filters, loading, searchFields])

  return (
    <Box className="card">
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>Consulta de documentos</Typography>

      {editingRow && (
        <EditModal
          row={editingRow}
          columns={columns.filter((col) => col !== pkCol)}
          columnLabels={columnLabels}
          pk={pkCol}
          onSave={handleSaveEdit}
          onCancel={() => { setEditingRow(null); setEditError(null) }}
          saving={saving}
          error={editError}
        />
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel>Tipo documental</InputLabel>
          <Select
            label="Tipo documental"
            value={tabla}
            onChange={(e) => {
              setTabla(e.target.value)
              setData(null)
              setFilters({})
              setPage(1)
              setSort('')
            }}
          >
            <MenuItem value="">Seleccionar</MenuItem>
            {tablas.map((t) => <MenuItem key={t.tabla} value={t.tabla}>{t.label}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 1 }}>{message}</Alert>}
      {deleting && <Alert severity="info" sx={{ mb: 1 }}>Eliminando registros...</Alert>}
      <DownloadProgressCard progress={downloadProgress} />

      {tabla && (
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          columnLabels={columnLabels}
          pk={pkCol}
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          sort={sort}
          order={order}
          onSort={(col, direction) => {
            setSort(col)
            setOrder(direction)
          }}
          onPageChange={(p) => fetchData(p)}
          loading={loading}
          isAdmin={isAdmin}
          onEdit={(row) => { setEditingRow(row); setEditError(null) }}
          onDelete={isAdmin ? handleDeleteRows : undefined}
          extraToolbar={filtersToolbar}
          renderCell={(row, col) => row[col] ?? ''}
        />
      )}
    </Box>
  )
}
