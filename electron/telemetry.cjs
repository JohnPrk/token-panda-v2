// 익명 사용 텔레메트리 — 앱은 이미 시간당 GitHub 업데이트 체크(updater.cjs)를
// 하는데, 그 옆에서 fire-and-forget 핑을 자체 엔드포인트(Cloudflare Worker)로
// 한 번 더 쏴서 "활성 설치 수 / 리텐션 / 버전 분포"를 측정한다.
//
// updater.cjs 와 완전히 분리한 이유: 업데이트 체크는 load-bearing(업뎃 알림 +
// 자동설치)이라 절대 깨지면 안 됨. 텔레메트리 엔드포인트가 죽거나 느려도
// 업데이트 흐름엔 0 영향이도록, 별도 호출 + 절대 throw 안 함 + 짧은 타임아웃.
//
// 프라이버시: PII 없음. 랜덤 UUID(설치별 1회 생성) + 앱 버전 + OS 만 보낸다.
// IP 는 저장 안 함(국가는 서버가 CF 헤더에서 coarse 하게만 파생). config.json 의
// telemetryOptOut=true 또는 환경변수 TP_TELEMETRY=0 으로 완전히 끌 수 있다.

const crypto = require("crypto");

// 프로덕션: 아래 빈 문자열("")을 배포한 Worker 의 /ping URL 로 바꿔 박는다.
// 패키징된 앱은 process.env 를 *런타임*(사용자 PC)에 읽으므로 빌드 때 넣은
// 환경변수는 안 들어간다 → 프로덕션 값은 반드시 이 상수에 박아야 한다.
// TP_TELEMETRY_ENDPOINT 는 개발(electron:dev) 중 런타임 오버라이드 용도.
// 비어 있으면 핑은 no-op — 배포 전/ fork 에서는 아무것도 안 나간다(안전 기본값).
const TELEMETRY_ENDPOINT =
  process.env.TP_TELEMETRY_ENDPOINT ||
  "https://tp-telemetry.token-guardians.workers.dev/ping";

const PING_TIMEOUT_MS = 5000;
const INSTALL_ID_KEY = "telemetryInstallId";
const OPT_OUT_KEY = "telemetryOptOut";

// config.json 에서 설치 ID 를 읽고, 없으면 새로 만들어 영속화. 익명 UUID 라
// 어떤 개인정보와도 연결되지 않는다(설치 인스턴스 식별용일 뿐).
function getOrCreateInstallId(store) {
  const existing = store.op("get", "config.json", INSTALL_ID_KEY);
  if (typeof existing === "string" && existing.length >= 8) return existing;
  const id = crypto.randomUUID();
  store.op("set", "config.json", INSTALL_ID_KEY, id);
  store.op("save", "config.json");
  return id;
}

// 사용자가 텔레메트리를 껐는가. 환경변수(TP_TELEMETRY=0)가 최우선, 그다음
// config 플래그. 명시적으로 true 일 때만 opt-out — 기본값은 켜짐(false).
function isOptedOut(store) {
  if (process.env.TP_TELEMETRY === "0") return true;
  return store.op("get", "config.json", OPT_OUT_KEY) === true;
}

// 핑을 보낼 조건(순수): 엔드포인트가 설정돼 있고 && opt-out 이 아닐 때만.
function shouldPing({ endpoint, optedOut }) {
  return Boolean(endpoint) && !optedOut;
}

// 전송 페이로드(순수). 화이트리스트 3필드만 — 의도치 않은 값 유출 방지.
function buildPingPayload({ id, version, os }) {
  return {
    id: typeof id === "string" ? id : "",
    v: typeof version === "string" ? version : "",
    os: typeof os === "string" ? os : "",
  };
}

async function postWithTimeout(url, body, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "token-panda-telemetry",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// fire-and-forget 한 발. 절대 throw 하지 않는다 — 호출부가 await 하든 말든
// 안전하고, 실패해도 무시한다. 반환값 {sent, reason?}은 테스트/디버깅용.
async function sendPing(store, opts = {}) {
  const { version, os, endpoint = TELEMETRY_ENDPOINT } = opts;
  try {
    const optedOut = isOptedOut(store);
    if (!shouldPing({ endpoint, optedOut })) {
      return { sent: false, reason: optedOut ? "opted-out" : "no-endpoint" };
    }
    const id = getOrCreateInstallId(store);
    const payload = buildPingPayload({ id, version, os });
    await postWithTimeout(endpoint, payload, PING_TIMEOUT_MS);
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: "error", error: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  sendPing,
  getOrCreateInstallId,
  isOptedOut,
  shouldPing,
  buildPingPayload,
  TELEMETRY_ENDPOINT,
  INSTALL_ID_KEY,
  OPT_OUT_KEY,
};
