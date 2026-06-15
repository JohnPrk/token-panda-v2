import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './pet-drag.css'
import { PetApp } from './App.tsx'

// index.html 은 지키미 패널(라벨 "main") 전용 진입점. Electron frameless+transparent
// 창에서 -webkit-app-region(pet-drag.css)으로 드래그를 처리하므로, 과거 Tauri
// 클릭-통과용 pointer-events:none 강제는 더 이상 두지 않는다 (그게 켜지면
// Electron 에선 버튼·드래그가 모두 막힘).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetApp />
  </StrictMode>,
)
