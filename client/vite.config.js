import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Follow redirects through the proxy so the session cookie
        // is set on the same origin as Vite (5173)
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Rewrite Set-Cookie domain so browser accepts it on localhost:5173
            const cookies = proxyRes.headers['set-cookie']
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map(c =>
                c.replace(/; Domain=[^;]+/i, '').replace(/; Secure/gi, '')
              )
            }
          })
        },
      },
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
})
