import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import roslibHandler from './api/roselib-search.js'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-middleware',
      configureServer(server) {
        server.middlewares.use('/api/roselib-search', async (req, res) => {
          const url = new URL(req.url, 'http://localhost')
          const query = Object.fromEntries(url.searchParams)
          await roslibHandler({ query }, res)
        })
      },
    },
  ],
  server: {
    proxy: {
      '/naver-api': {
        target: 'https://openapi.naver.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/naver-api/, ''),
      },
    },
  },
})
