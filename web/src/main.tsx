import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { BarreiraDeErro } from '@/componentes/barreira-de-erro'
import { queryClient } from '@/lib/query-client'
import { instalarRecargaPorVersaoNova } from '@/lib/versao-nova'

import App from './app.tsx'
import './index.css'

// uma versão nova publicada com a página aberta: o código velho das telas sob demanda deixa de existir
// no servidor, e a página recarrega UMA vez para buscar o novo (PERF-12)
instalarRecargaPorVersaoNova()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BarreiraDeErro>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </BarreiraDeErro>
  </StrictMode>,
)
