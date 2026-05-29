import { useMemo } from 'react'
import {
  MaterialReactTable,
  useMaterialReactTable,
} from 'material-react-table'
import { MRT_Localization_ES } from 'material-react-table/locales/es'
import { Box, Tooltip, IconButton } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'

/**
 * DataTable universal basado en Material React Table.
 *
 * Props:
 *  - columns: string[]           nombres de columnas
 *  - rows: object[]              datos
 *  - columnLabels: object        { col: 'Etiqueta' }
 *  - pk: string                  nombre de la PK
 *  - total: number               total de registros (server-side)
 *  - page: number                página actual (1-based)
 *  - pageSize: number            registros por página
 *  - onPageChange: (page) => void
 *  - onPageSizeChange: (size) => void
 *  - loading: bool
 *  - isAdmin: bool               muestra checkbox + acciones
 *  - onEdit: (row) => void       callback editar fila
 *  - onDelete: (rows) => void    callback eliminar seleccionados
 *  - extraToolbar: ReactNode     botones adicionales en toolbar
 *  - renderCell: (row, col) => ReactNode  render personalizado por celda
 *  - enableVirtualization: bool  activar virtualización (default true)
 */
export default function DataTable({
  columns = [],
  rows = [],
  columnLabels = {},
  pk = 'id',
  total = 0,
  page = 1,
  pageSize = 50,
  onPageChange,
  onPageSizeChange,
  loading = false,
  isAdmin = false,
  onEdit,
  onDelete,
  extraToolbar,
  renderCell,
  enableVirtualization = true,
}) {
  const mrtColumns = useMemo(() => {
    const dataCols = columns
      .filter((c) => c !== '_acciones')
      .map((col) => ({
        accessorKey: col,
        header: columnLabels[col] || col.replace(/_/g, ' '),
        size: 160,
        Cell: renderCell
          ? ({ row }) => renderCell(row.original, col)
          : undefined,
      }))

    return dataCols
  }, [columns, columnLabels, renderCell])

  const table = useMaterialReactTable({
    columns: mrtColumns,
    data: rows,
    localization: MRT_Localization_ES,

    // ── Server-side pagination ──────────────────────────────
    manualPagination: true,
    rowCount: total,
    onPaginationChange: (updater) => {
      const prev = { pageIndex: page - 1, pageSize }
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next.pageIndex !== prev.pageIndex) onPageChange?.(next.pageIndex + 1)
      if (next.pageSize !== prev.pageSize) onPageSizeChange?.(next.pageSize)
    },
    state: {
      pagination: { pageIndex: page - 1, pageSize },
      isLoading: loading,
    },

    // ── Funcionalidades avanzadas ───────────────────────────
    enableColumnFilterModes: true,
    enableColumnOrdering: true,
    enableColumnPinning: true,
    enableFacetedValues: true,
    enableGrouping: true,
    enableColumnResizing: true,
    enableStickyHeader: true,
    enableDensityToggle: true,
    enableHiding: true,
    enableFullScreenToggle: true,
    enableGlobalFilter: true,
    enableRowSelection: isAdmin,
    enableRowVirtualization: enableVirtualization,
    columnVirtualizerOptions: { overscan: 4 },
    rowVirtualizerOptions: { overscan: 10 },

    // ── Acciones por fila ───────────────────────────────────
    enableRowActions: isAdmin && (!!onEdit || !!onDelete),
    positionActionsColumn: 'last',
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {onEdit && (
          <Tooltip title="Editar">
            <IconButton size="small" color="primary" onClick={() => onEdit(row.original)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip title="Eliminar">
            <IconButton size="small" color="error" onClick={() => onDelete([row.original])}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    ),

    // ── Toolbar personalizado ───────────────────────────────
    renderTopToolbarCustomActions: ({ table }) => (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {isAdmin && onDelete && table.getSelectedRowModel().rows.length > 0 && (
          <Tooltip title="Eliminar seleccionados">
            <span>
              <IconButton
                color="error"
                onClick={() => onDelete(table.getSelectedRowModel().rows.map((r) => r.original))}
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {extraToolbar}
      </Box>
    ),

    // ── Estilos ─────────────────────────────────────────────
    muiTableContainerProps: { sx: { maxHeight: '65vh' } },
    muiTablePaperProps: { elevation: 2, sx: { borderRadius: 2 } },
    initialState: {
      density: 'compact',
      showColumnFilters: false,
      showGlobalFilter: true,
    },
  })

  return <MaterialReactTable table={table} />
}
