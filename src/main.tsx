import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// index.html의 inline script와 같은 효과를 React 진입에서도 한 번 더 강제.
// 펫 윈도우(view 없음)일 때만 root chain의 pointer-events를 none으로 박아
// 빈 영역 클릭이 데스크톱으로 통과되게 한다. CSS :has() 의존 없이 가장
// 신뢰 가능한 경로.
//
// v1.75: query string → hash 라우팅으로 전환. App.tsx 의 viewFromUrl 동일
// 사유. 펫 윈도우는 URL 자체에 hash 가 없거나 view 가 없는 형태.
{
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const hasView = new URLSearchParams(raw).get('view')
  if (!hasView) {
    document.documentElement.style.pointerEvents = 'none'
    document.body.style.pointerEvents = 'none'
    const root = document.getElementById('root')
    if (root) root.style.pointerEvents = 'none'
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
