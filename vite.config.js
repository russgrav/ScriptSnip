import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer (FFmpeg.wasm optimization)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  build: {
    target: 'esnext',
  }
})
