import { useState, useEffect } from 'react'

/**
 * Tabla de consulta con búsqueda, ordenación y paginación (salto directo a página).
 */
export default function DataTable({
  columns = [],
  rows = [],
  columnLabels = {},
  pk = 'id',
  page = 1,
  totalPages = 0,
  total = 0,
  limit = 50,
  sort = '',
  order = 'asc',
  onSort,
  onPageChange,
  searchFields = [],
  searchValues = {},
  onSearchFieldChange,
  onSearch,
  loading = false,
  isAdmin = false,
  selected = new Set(),
  onToggleSelect,
  onSelectAll,
  extraFilters = null,
  renderCell = null,
  showSearchButton = true,
}) {
  const [pageInput, setPageInput] = useState(String(page))

  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  const colLabel = (key) => columnLabels[key] || key.replace(/_/g, ' ')

  const goToPage = () => {
    const n = parseInt(pageInput, 10)
    if (!Number.isFinite(n) || n < 1) return
    const target = Math.min(Math.max(1, n), totalPages || 1)
    onPageChange(target)
  }

  const pageOptions = totalPages > 0 && totalPages <= 200
    ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : []

  const allSelected = rows.length > 0 && selected.size === rows.length

  return (
    <div className="data-table">
      {(searchFields.length > 0 || extraFilters || showSearchButton) && (
      <div className="data-table-toolbar">
        {searchFields.map((f) => (
          <label key={f.key} className="data-table-search">
            <span>{f.label}</span>
            <input
              type={f.type || 'text'}
              value={searchValues[f.key] ?? ''}
              onChange={(e) => onSearchFieldChange(f.key, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch?.()}
              placeholder={f.placeholder || f.label}
            />
          </label>
        ))}
        {extraFilters}
        {showSearchButton && onSearch && (
          <button type="button" className="btn" onClick={onSearch} disabled={loading}>
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        )}
      </div>
      )}

      <p className="data-table-summary">
        {total.toLocaleString()} registro(s)
        {totalPages > 0 && ` · página ${page} de ${totalPages}`}
        {selected.size > 0 && ` · ${selected.size} seleccionado(s)`}
      </p>

      <div className="data-table-scroll">
        <table>
          <thead>
            <tr>
              {isAdmin && (
                <th className="data-table-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onSelectAll}
                    title="Seleccionar página"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c}
                  className={onSort ? 'data-table-sortable' : ''}
                  onClick={() => onSort?.(c)}
                >
                  {colLabel(c)}
                  {sort === c && (
                    <span className="data-table-sort-icon">{order === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (isAdmin ? 1 : 0)} className="data-table-empty">
                  Cargando...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (isAdmin ? 1 : 0)} className="data-table-empty">
                  Sin resultados
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={row[pk] ?? i} className={selected.has(i) ? 'data-table-row-selected' : ''}>
                  {isAdmin && (
                    <td className="data-table-check">
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => onToggleSelect(i)}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c} title={row[c] != null ? String(row[c]) : ''}>
                      {renderCell ? renderCell(row, c, i) : (row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 0 && (
        <div className="data-table-pagination">
          <button
            type="button"
            className="btn secondary"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(1)}
          >
            Primera
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            Anterior
          </button>

          <label className="data-table-page-jump">
            <span>Página</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && goToPage()}
            />
            <span>de {totalPages}</span>
            <button type="button" className="btn secondary" onClick={goToPage} disabled={loading}>
              Ir
            </button>
          </label>

          {pageOptions.length > 0 && (
            <select
              className="data-table-page-select"
              value={page}
              onChange={(e) => onPageChange(Number(e.target.value))}
              disabled={loading}
              aria-label="Seleccionar página"
            >
              {pageOptions.map((n) => (
                <option key={n} value={n}>
                  Pág. {n}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="btn secondary"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Siguiente
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(totalPages)}
          >
            Última
          </button>
        </div>
      )}
    </div>
  )
}
