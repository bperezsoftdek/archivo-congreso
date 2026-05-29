import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Grid, Alert, CircularProgress, Typography,
} from '@mui/material'
import { useState } from 'react'

export default function EditModal({ row, columns, columnLabels, pk, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(() => {
    const initial = {}
    columns.forEach((col) => { initial[col] = row[col] ?? '' })
    return initial
  })

  const label = (col) => columnLabels[col] || col.replace(/_/g, ' ')

  return (
    <Dialog open onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>
        ✏️ Editar registro
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {pk}: {row[pk]}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0 }}>
          {columns.map((col) => (
            <Grid item xs={12} sm={6} key={col}>
              <TextField
                label={label(col)}
                value={form[col] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [col]: e.target.value }))}
                fullWidth
                size="small"
                multiline={String(form[col] ?? '').length > 80}
                maxRows={4}
              />
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button variant="contained" onClick={() => onSave(form)} disabled={saving}>
          {saving ? <CircularProgress size={20} color="inherit" /> : 'Guardar cambios'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
