import { useState, useMemo } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Checkbox, FormControlLabel, List, ListItem,
  ListItemText, Typography, Chip, Box, Divider, Alert,
} from '@mui/material'

export default function CamposVaciosModal({ registros, totalFilas, onConfirm, onCancel }) {
  const [checked, setChecked] = useState(() => new Set(registros.map((r) => r.fila)))

  const allChecked = checked.size === registros.length
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(registros.map((r) => r.fila)))
  const toggle = (fila) => {
    const next = new Set(checked)
    next.has(fila) ? next.delete(fila) : next.add(fila)
    setChecked(next)
  }

  const resumenCols = useMemo(() => {
    const counts = {}
    registros.forEach((r) => r.campos_vacios.forEach((col) => { counts[col] = (counts[col] || 0) + 1 }))
    return counts
  }, [registros])

  return (
    <Dialog open onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>⚠️ Registros con campos vacíos</DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          El archivo tiene <strong>{totalFilas}</strong> fila(s).{' '}
          <strong>{registros.length}</strong> registro(s) tienen al menos un campo vacío.
        </Alert>

        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          Campos afectados:
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
          {Object.entries(resumenCols).map(([col, cnt]) => (
            <Chip key={col} label={`${col}: ${cnt}`} size="small" color="warning" variant="outlined" />
          ))}
        </Box>

        <Divider sx={{ mb: 1 }} />
        <FormControlLabel
          control={<Checkbox checked={allChecked} indeterminate={checked.size > 0 && !allChecked} onChange={toggleAll} />}
          label={<Typography variant="body2" fontWeight={600}>Marcar / desmarcar todos ({registros.length})</Typography>}
          sx={{ mb: 1 }}
        />

        <List dense disablePadding sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {registros.map((r) => (
            <ListItem key={r.fila} disablePadding sx={{ bgcolor: checked.has(r.fila) ? 'action.selected' : 'transparent', borderRadius: 1, mb: 0.25 }}>
              <FormControlLabel
                sx={{ width: '100%', mx: 0, px: 1 }}
                control={<Checkbox size="small" checked={checked.has(r.fila)} onChange={() => toggle(r.fila)} />}
                label={
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={600}>Fila {r.fila}</Typography>
                        {r.codigo_referencia && (
                          <Typography variant="caption" color="text.secondary">— {r.codigo_referencia}</Typography>
                        )}
                      </Box>
                    }
                    secondary={r.campos_vacios.join(', ')}
                    secondaryTypographyProps={{ fontSize: '0.75rem' }}
                  />
                }
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="contained" onClick={() => onConfirm(Array.from(checked))} disabled={checked.size === 0}>
          Continuar con {checked.size} registro(s)
        </Button>
      </DialogActions>
    </Dialog>
  )
}
