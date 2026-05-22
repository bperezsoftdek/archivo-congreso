import { useState } from 'react'

const API = '/api'

export default function DeletePanel({ tablas, token }) {
  const [tabla, setTabla] = useState('')
  const [id, setId] = useState('')
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const deleteRecord = async (e) => {
    e.preventDefault()
    if (!tabla || !id) return
    setLoading(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch(`${API}/registros/${tabla}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
      setMessage(`Registro ${body.id} eliminado de ${body.tabla}`)
      setId('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Eliminar informacion</h2>

      <form className="filters" onSubmit={deleteRecord}>
        <label>
          Tipo documental
          <select value={tabla} onChange={e => setTabla(e.target.value)}>
            <option value="">-- Seleccionar --</option>
            {tablas.map(t => <option key={t.tabla} value={t.tabla}>{t.label}</option>)}
          </select>
        </label>
        <label>
          ID del registro
          <input type="number" value={id} onChange={e => setId(e.target.value)} placeholder="id_acta" />
        </label>
        <button className="btn" disabled={!tabla || !id || loading}>
          {loading ? 'Eliminando...' : 'Eliminar'}
        </button>
      </form>

      {message && <div className="result-box">{message}</div>}
      {error && <div className="result-box error">{error}</div>}
    </div>
  )
}
