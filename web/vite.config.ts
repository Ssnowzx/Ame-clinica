/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Proxy em dev: /api e /sanctum viram same-origin com o Laravel (design D2),
// eliminando CORS/cookie cross-site — o Sanctum enxerga localhost:5173 como stateful.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Pedaços com nome que diz o que são (PERF-13). Com as telas da área de Indicadores sob demanda
  // (`React.lazy`), o empacotador separava o código que elas dividem com o resto do sistema num pedaço
  // pré-carregado batizado pelo primeiro módulo dele — e o React inteiro descia num `indicadores-*.js`,
  // um nome que engana quem lê o painel de rede. Agora: as BIBLIOTECAS em `vendor-[hash].js`; o código
  // da casa dividido entre telas em `compartilhado-[hash].js`; cada tela sob demanda com o nome dela.
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: /[\\/]node_modules[\\/]/ }],
        },
        chunkFileNames: (pedaco) =>
          pedaco.isDynamicEntry || pedaco.name === 'vendor' || pedaco.name.startsWith('rolldown')
            ? 'assets/[name]-[hash].js'
            : 'assets/compartilhado-[hash].js',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/sanctum': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
