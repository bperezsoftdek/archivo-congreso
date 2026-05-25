import { useCallback, useEffect, useState } from 'react'
import { API_AUTH, formatApiError } from '../utils/api'

const EMPTY_FORM = { username: '', nombre: '', password: '', rol: 'operador', activo: true }

const ROLES = [
  { value: 'admin', label: 'Administrador' },
  { value: 'operador', label: 'Registro y consulta' },
  { value: 'consulta', label: 'Solo consulta' },
]

export default function UsuariosPanel({ token }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const authHeaders = { Authorization: `Bearer ${token}` }
  const isEditing = editingId !== null

  const loadUsers = useCallback(async () => {
    const res = await fetch(`${API_AUTH}/usuarios`, { headers: authHeaders })
    const body = await res.json()
    if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
    setUsers(body)
  }, [token])

  useEffect(() => { loadUsers().catch(e => setError(e.message)) }, [])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const saveUser = async (e) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      const url = isEditing ? `${API_AUTH}/usuarios/${editingId}` : `${API_AUTH}/usuarios`
      const method = isEditing ? 'PUT' : 'POST'
      const payload = isEditing && !form.password ? { ...form, password: null } : form
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setMessage(isEditing ? 'Usuario actualizado' : 'Usuario creado')
      resetForm()
      await loadUsers()
    } catch (e) {
      setError(e.message)
    }
  }

  const editUser = (user) => {
    setEditingId(user.id_usuario)
    setForm({
      username: user.username,
      nombre: user.nombre,
      password: '',
      rol: user.rol,
      activo: user.activo,
    })
    setError(null)
    setMessage(null)
  }

  const toggleUser = async (user) => {
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`${API_AUTH}/usuarios/${user.id_usuario}/estado?activo=${!user.activo}`, {
        method: 'PATCH',
        headers: authHeaders,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setMessage(user.activo ? 'Usuario desactivado' : 'Usuario activado')
      await loadUsers()
    } catch (e) {
      setError(e.message)
    }
  }

  const deleteUser = async (user) => {
    if (!window.confirm(`Eliminar el usuario ${user.username}?`)) return
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`${API_AUTH}/usuarios/${user.id_usuario}`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(formatApiError(body, `HTTP ${res.status}`))
      setMessage('Usuario eliminado')
      if (editingId === user.id_usuario) resetForm()
      await loadUsers()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="card">
      <h2>Gestion de usuarios</h2>

      <form className="filters" onSubmit={saveUser}>
        <label>
          Usuario
          <input value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))} />
        </label>
        <label>
          Nombre
          <input value={form.nombre} onChange={e => setForm(prev => ({ ...prev, nombre: e.target.value }))} />
        </label>
        <label>
          Contrasena
          <input
            type="password"
            value={form.password}
            onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
            placeholder={isEditing ? 'Dejar igual' : ''}
          />
        </label>
        <label>
          Rol
          <select value={form.rol} onChange={e => setForm(prev => ({ ...prev, rol: e.target.value }))}>
            {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </label>
        <label>
          Estado
          <select value={form.activo ? 'true' : 'false'} onChange={e => setForm(prev => ({ ...prev, activo: e.target.value === 'true' }))}>
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </label>
        <button className="btn" disabled={!form.username || !form.nombre || (!isEditing && !form.password)}>
          {isEditing ? 'Guardar cambios' : 'Crear usuario'}
        </button>
        {isEditing && (
          <button type="button" className="btn secondary" onClick={resetForm}>Cancelar</button>
        )}
      </form>

      {message && <div className="result-box">{message}</div>}
      {error && <div className="result-box error">{error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id_usuario}>
                <td>{user.id_usuario}</td>
                <td>{user.username}</td>
                <td>{user.nombre}</td>
                <td>{ROLES.find(role => role.value === user.rol)?.label || user.rol}</td>
                <td>{user.activo ? 'Activo' : 'Inactivo'}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn secondary" onClick={() => editUser(user)}>Editar</button>
                    <button className="btn secondary" onClick={() => toggleUser(user)}>
                      {user.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button className="btn danger" onClick={() => deleteUser(user)}>Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
