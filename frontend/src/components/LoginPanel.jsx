import { useState } from 'react'

const API = '/api/auth'

export default function LoginPanel({ onLogin }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
      onLogin(body)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 420, margin: '4rem auto' }}>
        <h2>Iniciar sesion</h2>
        <form onSubmit={submit} className="filters" style={{ display: 'grid' }}>
          <label>
            Usuario
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Contrasena
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="btn" disabled={loading || !username || !password}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        {error && <div className="result-box error">{error}</div>}
      </div>
    </main>
  )
}
