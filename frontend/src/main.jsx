import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material'
import App from './App'
import { ColorModeContext } from './colorModeContext'
import './index.css'

function Root() {
  const [mode, setMode] = useState(() => localStorage.getItem('colorMode') || 'light')

  const colorMode = useMemo(() => ({
    mode,
    toggle: () => setMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      localStorage.setItem('colorMode', next)
      return next
    }),
  }), [mode])

  const theme = useMemo(() => createTheme({
    palette: {
      mode,
      primary: { main: '#1a3a5c' },
      secondary: { main: '#555' },
    },
    typography: { fontFamily: 'system-ui, sans-serif' },
  }), [mode])

  useEffect(() => {
    document.documentElement.dataset.colorMode = mode
  }, [mode])

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
