// 의존성 없는 Electron dev 러너:
//   1) vite 렌더러 dev 서버 기동
//   2) 서버가 응답할 때까지 대기 (실제 바인딩된 포트를 vite 로그에서 파싱)
//   3) TP_DEV_URL 을 주입해 electron 기동
//   4) electron 종료 시 vite 정리
import { spawn } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";

function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok || res.status === 404) return resolve();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error("vite dev server timeout: " + url));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const vite = spawn(npmCmd, ["run", "dev"], { stdio: ["ignore", "pipe", "inherit"], shell: isWin });

let devUrl = null;
let resolvedReady;
const ready = new Promise((r) => (resolvedReady = r));

vite.stdout.on("data", (buf) => {
  const s = buf.toString();
  process.stdout.write(s);
  const m = s.match(/Local:\s+(https?:\/\/[^\s/]+)\/?/i);
  if (m && !devUrl) {
    devUrl = m[1];
    resolvedReady();
  }
});

let electron = null;
function cleanup() {
  try { if (electron) electron.kill(); } catch {}
  try { vite.kill(); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

(async () => {
  // vite 가 포트를 로그로 알려줄 때까지 대기 (없으면 기본 5173 가정).
  await Promise.race([ready, new Promise((r) => setTimeout(r, 8000))]);
  const url = devUrl || "http://localhost:5173";
  await waitForUrl(url);

  const electronPath = (await import("electron")).default;
  electron = spawn(electronPath, ["electron/main.cjs"], {
    stdio: "inherit",
    env: { ...process.env, TP_DEV_URL: url },
  });
  electron.on("exit", (code) => {
    cleanup();
    process.exit(code == null ? 0 : code);
  });
})().catch((err) => {
  console.error("[electron-dev]", err);
  cleanup();
  process.exit(1);
});
