import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { OnboardingApp } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OnboardingApp />
  </StrictMode>,
)
