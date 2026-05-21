import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// v1.75: Vite 8 이 생성하는 `<script type="module" crossorigin>` /
// `<link rel="modulepreload" crossorigin>` / `<link rel="stylesheet" crossorigin>`
// 의 crossorigin 속성을 제거한다.
//
// Why: Tauri 2 Windows WebView2 의 커스텀 프로토콜(`http://tauri.localhost`)
// 응답이 CORS 헤더를 흘리지 않으면 crossorigin 속성이 붙은 모듈 로드가
// Chromium 정책으로 차단돼 React 마운트 자체가 0 이 되는 회귀 가능성.
// macOS 의 `tauri://` 는 다른 핸들러 경로라 같은 build 가 정상이라
// Windows 만 흰 화면이 되는 비대칭이 발생. 같은 origin 으로 서빙되는
// asset 이라 crossorigin 자체가 불필요 — 제거가 가장 단순한 회피.
function stripCrossoriginPlugin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      // crossorigin / crossorigin="..." / crossorigin='...' 세 변형 모두.
      return html.replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?(?=[\s>])/g, '')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stripCrossoriginPlugin()],
})
