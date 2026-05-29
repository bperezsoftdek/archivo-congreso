import { useState, useMemo } from 'react'

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

  // Resumen de cuántos campos vacíos hay por columna (para el encabezado informativo)
  const resumenCols = useMemo(() => {
    const counts = {}
    registros.forEach((r) =>
      r.campos_vacios.forEach((col) => {
        counts[col] = (counts[col] || 0) + 1
      })
    )
    return counts
  }, [registros])

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h3 className="modal-title">⚠️ Registros con campos vacíos</h3>
        <p className="modal-desc">
          El archivo tiene <strong>{totalFilas}</strong> fila(s) de datos.{' '}
          <strong>{registros.length}</strong> registro(s) tienen al menos un campo vacío.
          Marque los que desea incluir en la carga de todas formas, o cancele para corregir
          el archivo.
        </p>

        {/* Resumen por columna */}
        <div className="modal-resumen-cols">
          {Object.entries(resumenCols).map(([col, cnt]) => (
            <span key={col} className="modal-resumen-badge">
              {col}: {cnt}
            </span>
          ))}
        </div>

        <div className="modal-check-all">
          <label>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            <span>Marcar / desmarcar todos ({registros.length} registros)</span>
          </label>
        </div>

        <ul className="modal-campos-list">
          {registros.map((r) => (
            <li key={r.fila} className={checked.has(r.fila) ? 'checked' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={checked.has(r.fila)}
                  onChange={() => toggle(r.fila)}
                />
                <span className="modal-campo-name">
                  Fila {r.fila}
                  {r.codigo_referencia && (
                    <em style={{ fontWeight: 400, marginLeft: '0.4rem', color: '#555' }}>
                      — {r.codigo_referencia}
                    </em>
                  )}
                </span>
                <span className="modal-campo-count">
                  {r.campos_vacios.join(', ')}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => onConfirm(Array.from(checked))}
            disabled={checked.size === 0}
          >
            Continuar con {checked.size} registro(s)
          </button>
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
