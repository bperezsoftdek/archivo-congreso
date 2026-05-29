import { useState } from 'react'

export default function EditModal({ row, columns, columnLabels, pk, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(() => {
    const initial = {}
    columns.forEach((col) => { initial[col] = row[col] ?? '' })
    return initial
  })

  const handleChange = (col, val) => setForm((prev) => ({ ...prev, [col]: val }))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  const label = (col) => columnLabels[col] || col.replace(/_/g, ' ')

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-card-wide">
        <h3 className="modal-title">✏️ Editar registro — {pk}: {row[pk]}</h3>
        {error && <div className="result-box error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
        <form onSubmit={handleSubmit} className="edit-modal-form">
          {columns.map((col) => (
            <label key={col} className="edit-modal-field">
              <span>{label(col)}</span>
              <input
                type="text"
                value={form[col] ?? ''}
                onChange={(e) => handleChange(col, e.target.value)}
              />
            </label>
          ))}
          <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
            <button type="button" className="btn secondary" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
