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
      
      // 👇 CONFIGURACIÓN PARA REPARAR EL WEBSOCKET BAJO SSL LOCAL
      hmr: {
        host: '10.10.71.178', // La IP local de tu servidor Ubuntu
        protocol: 'wss',      // Obliga a usar WebSocket Seguro (WSS) debido al SSL de Nginx
        clientPort: 443,      // El puerto externo seguro que atiende Nginx
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