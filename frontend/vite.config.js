import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || process.env.VITE_PROXY_TARGET || 'http://backend:8000'

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      
      // Configuración de Hot Module Replacement sincronizada con Nginx
      hmr: {
        host: '10.10.71.178',
        protocol: 'wss',   // Cambia a WebSocket Seguro ya que usamos HTTPS
        clientPort: 443,   // Le dice a Vite que escuche a través del puerto seguro de Nginx
      },

      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 600000,
          proxyTimeout: 600000,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-forwarded-proto', 'https')
            })
          },
        },
      },
    },
  }
})