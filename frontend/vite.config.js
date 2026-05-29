import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || process.env.VITE_PROXY_TARGET || 'http://backend:8000'
  const hmrHost = env.VITE_HMR_HOST || process.env.VITE_HMR_HOST || null

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      hmr: hmrHost
        ? { host: hmrHost, protocol: 'wss', clientPort: 443 }
        : true,
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