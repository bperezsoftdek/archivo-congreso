import { useState, useEffect } from 'react'
import {
  AppBar, Box, Drawer, IconButton, List, ListItemButton,
  ListItemText, Toolbar, Typography, Tooltip, Divider, Avatar, Chip,
} from '@mui/material'
import Brightness4Icon from '@mui/icons-material/Brightness4'
import Brightness7Icon from '@mui/icons-material/Brightness7'
import LogoutIcon from '@mui/icons-material/Logout'
import { API_BASE } from './utils/api'
import { useColorMode } from './main'
import UploadPanel from './components/UploadPanel'
import ControlArchivosPanel from './components/ControlArchivosPanel'
import ConsultaPanel from './components/ConsultaPanel'
import RegistrosPanel from './components/RegistrosPanel'
import LoginPanel from './components/LoginPanel'
import UsuariosPanel from './components/UsuariosPanel'

const DRAWER_WIDTH = 240

export default function App() {
  const savedSession = JSON.parse(localStorage.getItem('archivo_session') || 'null')
  const [session, setSession] = useState(savedSession)
  const [tab, setTab] = useState('consulta')
  const [tablas, setTablas] = useState([])
  const [apiError, setApiError] = useState(null)
  const { mode, toggle } = useColorMode()

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
    canUpload  && { id: 'upload',    label: 'Registro',         icon: '📥' },
    true       && { id: 'consulta',  label: 'Consulta',         icon: '🔍' },
    canUpload  && { id: 'archivos',  label: 'Control archivos', icon: '📁' },
    isAdmin    && { id: 'registros', label: 'Auditoría',        icon: '📋' },
    isAdmin    && { id: 'usuarios',  label: 'Usuarios',         icon: '👥' },
  ].filter(Boolean)

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* AppBar */}
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'primary.main' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: 0.5 }}>
            Archivo Congreso
          </Typography>
          {apiError && (
            <Chip label={apiError} color="error" size="small" sx={{ maxWidth: 300 }} />
          )}
          <Tooltip title={mode === 'light' ? 'Modo oscuro' : 'Modo claro'}>
            <IconButton color="inherit" onClick={toggle}>
              {mode === 'light' ? <Brightness4Icon /> : <Brightness7Icon />}
            </IconButton>
          </Tooltip>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main', fontSize: '0.85rem' }}>
              {user.nombre?.[0]?.toUpperCase()}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexDirection: 'column', alignItems: 'flex-end' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>{user.nombre}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{user.username} · {user.rol}</Typography>
            </Box>
            <Tooltip title="Cerrar sesión">
              <IconButton color="inherit" onClick={logout}>
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <Divider />
        <List dense>
          {modules.map((m) => (
            <ListItemButton
              key={m.id}
              selected={tab === m.id}
              onClick={() => setTab(m.id)}
              sx={{ borderRadius: 1, mx: 0.5, my: 0.25 }}
            >
              <ListItemText
                primary={`${m.icon}  ${m.label}`}
                primaryTypographyProps={{ fontSize: '0.9rem' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      {/* Contenido principal */}
      <Box component="main" sx={{ flexGrow: 1, p: 3, mt: 8, minWidth: 0 }}>
        {tab === 'upload'    && canUpload && <UploadPanel tablas={tablas} token={token} />}
        {tab === 'consulta'  && <ConsultaPanel tablas={tablas} token={token} isAdmin={canDelete} />}
        {tab === 'archivos'  && canUpload && <ControlArchivosPanel tablas={tablas} token={token} isAdmin={canRevert} />}
        {tab === 'registros' && isAdmin   && <RegistrosPanel token={token} />}
        {tab === 'usuarios'  && isAdmin   && <UsuariosPanel token={token} />}
      </Box>
    </Box>
  )
}
