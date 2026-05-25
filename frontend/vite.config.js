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
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 600000,
          proxyTimeout: 600000,
        },
      },
    },
  }
})
