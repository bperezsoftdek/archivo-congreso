import { useMemo } from 'react'
import { MaterialReactTable, useMaterialReactTable } from 'material-react-table'
import { MRT_Localization_ES } from 'material-react-table/locales/es'
import { Box, IconButton, Tooltip } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'

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
  sort,
  order = 'asc',
  onSort,
  loading = false,
  isAdmin = false,
  onEdit,
  onDelete,
  extraToolbar,
  renderCell,
  enableVirtualization = true,
  enableRowSelection,
}) {
  const dataColumns = useMemo(
    () => columns
      .filter((col) => col !== '_acciones')
      .map((col) => ({
        accessorKey: col,
        header: columnLabels[col] || col.replace(/_/g, ' '),
        size: col === pk ? 90 : col === 'acciones' ? 220 : 180,
        minSize: col === pk ? 70 : col === 'acciones' ? 180 : 120,
        enableColumnFilter: col !== 'acciones',
        enableSorting: col !== 'acciones',
        enableGrouping: col !== 'acciones',
        Cell: renderCell ? ({ row }) => renderCell(row.original, col) : undefined,
      })),
    [columns, columnLabels, pk, renderCell],
  )

  const table = useMaterialReactTable({
    columns: dataColumns,
    data: rows,
    localization: MRT_Localization_ES,
    getRowId: (row, index) => String(row?.[pk] ?? index),

    manualPagination: true,
    rowCount: total,
    onPaginationChange: (updater) => {
      const prev = { pageIndex: page - 1, pageSize }
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next.pageIndex !== prev.pageIndex) onPageChange?.(next.pageIndex + 1)
      if (next.pageSize !== prev.pageSize) onPageSizeChange?.(next.pageSize)
    },

    manualSorting: Boolean(onSort),
    onSortingChange: (updater) => {
      if (!onSort) return
      const prev = sort ? [{ id: sort, desc: order === 'desc' }] : []
      const next = typeof updater === 'function' ? updater(prev) : updater
      const first = next?.[0]
      onSort(first?.id || '', first?.desc ? 'desc' : 'asc')
    },

    state: {
      isLoading: loading,
      pagination: { pageIndex: page - 1, pageSize },
      sorting: sort ? [{ id: sort, desc: order === 'desc' }] : [],
    },

    enableColumnFilterModes: true,
    enableColumnOrdering: true,
    enableColumnPinning: true,
    enableColumnResizing: true,
    enableDensityToggle: true,
    enableFacetedValues: true,
    enableFullScreenToggle: true,
    enableGlobalFilter: true,
    enableGrouping: true,
    enableHiding: true,
    enableStickyHeader: true,
    enableRowVirtualization: enableVirtualization,
    enableRowSelection: enableRowSelection ?? (isAdmin && Boolean(onDelete)),
    enableRowActions: Boolean(onEdit || onDelete),
    positionActionsColumn: 'last',
    columnVirtualizerOptions: { overscan: 4 },
    rowVirtualizerOptions: { overscan: 10 },

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

    renderTopToolbarCustomActions: ({ table }) => {
      const selectedRows = table.getSelectedRowModel().rows
      return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {onDelete && selectedRows.length > 0 && (
            <Tooltip title="Eliminar seleccionados">
              <IconButton
                color="error"
                onClick={() => onDelete(selectedRows.map((row) => row.original))}
              >
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          )}
          {extraToolbar}
        </Box>
      )
    },

    muiTableContainerProps: { sx: { maxHeight: '68vh' } },
    muiTablePaperProps: {
      elevation: 1,
      sx: { borderRadius: 1, overflow: 'hidden' },
    },
    muiPaginationProps: {
      rowsPerPageOptions: [pageSize],
    },
    muiTableBodyCellProps: {
      sx: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
    },
    initialState: {
      density: 'compact',
      showGlobalFilter: true,
    },
  })

  return <MaterialReactTable table={table} />
}
