import { useState, useEffect } from 'react'
import { API_BASE } from './utils/api'
import UploadPanel from './components/UploadPanel'
import ControlArchivosPanel from './components/ControlArchivosPanel'
import ConsultaPanel from './components/ConsultaPanel'
import RegistrosPanel from './components/RegistrosPanel'
import LoginPanel from './components/LoginPanel'
import UsuariosPanel from './components/UsuariosPanel'

export default function App() {
  const savedSession = JSON.parse(localStorage.getItem('archivo_session') || 'null')
  const [session, setSession] = useState(savedSession)
  const [tab, setTab] = useState('consulta')
  const [tablas, setTablas] = useState([])
  const [apiError, setApiError] = useState(null)

  const token = session?.token
  const user = session?.user
  const isAdmin = user?.rol === 'admin'
  const canUpload = user?.rol === 'admin' || user?.rol === 'operador' || user?.rol === 'registro'
  const canDelete = user?.rol === 'admin' || user?.rol === 'registro'
  const canRevert = isAdmin

  const onLogin = (nextSession) => {
    localStorage.setItem('archivo_session', JSON.stringify(nextSession))
    setSession(nextSession)
    setTab(nextSession.user.rol === 'consulta' ? 'consulta' : 'upload')
  }

  const logout = () => {
    localStorage.removeItem('archivo_session')
    setSession(null)
    setTab('consulta')
    setTablas([])
  }

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/tablas`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setTablas)
      .catch(e => setApiError(`No se pudo conectar al backend: ${e.message}`))
  }, [token])

  if (!session) return <LoginPanel onLogin={onLogin} />

  const modules = [
    canUpload && { id: 'upload', label: 'Registro' },
    { id: 'consulta', label: 'Consulta' },
    canUpload && { id: 'archivos', label: 'Control archivos' },
    isAdmin && { id: 'registros', label: 'Auditoria' },
    isAdmin && { id: 'usuarios', label: 'Usuarios' },
  ].filter(Boolean)

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Archivo Congreso</h1>
        <div className="user-summary">
          <div>
            <strong>{user.nombre}</strong>
            <span>{user.username} · {user.rol}</span>
          </div>
          <button onClick={logout}>Salir</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <h2>Modulos</h2>
          {modules.map(module => (
            <button key={module.id} className={tab === module.id ? 'active' : ''} onClick={() => setTab(module.id)}>
              {module.label}
            </button>
          ))}
        </aside>

        <main>
          {apiError && (
            <div style={{ background: '#fff0f0', border: '1px solid #f99', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
              {apiError}. Verifica que el backend este corriendo en <code>http://localhost:8000</code>
            </div>
          )}
          {tab === 'upload' && canUpload && <UploadPanel tablas={tablas} token={token} />}
          {tab === 'consulta' && <ConsultaPanel tablas={tablas} token={token} isAdmin={canDelete} />}
          {tab === 'archivos' && canUpload && (
            <ControlArchivosPanel tablas={tablas} token={token} isAdmin={canRevert} />
          )}
          {tab === 'registros' && isAdmin && <RegistrosPanel token={token} />}
          {tab === 'usuarios' && isAdmin && <UsuariosPanel token={token} />}
        </main>
      </div>
    </div>
  )
}
