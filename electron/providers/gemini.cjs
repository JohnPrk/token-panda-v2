// Gemini provider — gemini.google.com 의 내부 batchexecute RPC `jSf9Qc`
// (BardFrontendService.GetUsageInfo) 를 사용자 세션 쿠키로 호출한다.
//
// claude.ai 는 REST 한 방이라 쿠키 한 줄이면 끝나지만, Gemini 는 Google 의
// batchexecute wire protocol 이라 호출 전에 페이지 HTML 에서 3 개 토큰을
// scrape 해야 한다:
//   SNlM0e (`at`)    — XSRF 토큰. 매 호출의 body 에 `at=` 로 동봉.
//   cfb2h  (`bl`)    — build label. 매 호출의 query 에 `bl=` 로 동봉.
//   FdrFJe (`f.sid`) — session id. 임의 정수도 통하지만 정식 값을 쓰면 안전.
//
// 토큰은 페이지 로드 시점마다 회전하므로 매 호출 직전에 새로 떠 온다.
// (간격이 짧을 땐 동일 토큰이 그대로 반환되므로 추가 캐시 없음 — 30초 폴링
// 주기에서 1 request → 1 page fetch 비용이 부담이면 향후 [소] 로 ttl 캐시.)
//
// credentials 모양:
//   { cookie }   — gemini.google.com 의 raw Cookie 헤더 한 줄.
//                  최소 SID/__Secure-1PSID/__Secure-3PSID 세 줄은 필수.

const { sanitizeCookie } = require("../claudeApi.cjs");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const APP_URL = "https://gemini.google.com/app";
const BATCHEXEC_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";
const USAGE_RPC_ID = "jSf9Qc";

const TIER_MAP = Object.freeze({
  2: "PRO",
  3: "ULTRA",
  4: "PLUS",
  6: "ULTRA",
});

const id = "gemini";
const displayName = "Gemini";
const capabilities = Object.freeze({
  prepaid: false,
  autoExtract: false,
  tier: true,
});

// ─── pure helpers (테스트 대상) ────────────────────────────────────────────

// HTML 의 `<script ... data-id="_gd">window.WIZ_global_data = {...};</script>`
// 또는 inline 변형에서 JSON 본문만 잘라 객체로. 못 찾으면 null.
function parseWizGlobalData(html) {
  if (typeof html !== "string" || !html) return null;
  // 정규식 두 가지 변형 — Google 이 인라인 위치/순서를 가끔 바꾼다.
  const patterns = [
    /window\.WIZ_global_data\s*=\s*(\{[\s\S]*?\});/,
    /WIZ_global_data\s*=\s*(\{[\s\S]*?\});/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try {
        return JSON.parse(m[1]);
      } catch {
        // JSON 안에 따옴표 escape 사정으로 실패하면 다음 패턴 시도.
      }
    }
  }
  return null;
}

function extractAtToken(wiz) {
  if (!wiz || typeof wiz !== "object") return null;
  const v = wiz["SNlM0e"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function extractBuildLabel(wiz) {
  if (!wiz || typeof wiz !== "object") return null;
  const v = wiz["cfb2h"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function extractSessionId(wiz) {
  if (!wiz || typeof wiz !== "object") return null;
  const v = wiz["FdrFJe"];
  // FdrFJe 는 문자열로 들어오는 경우가 많고, 음수 정수일 수도 있다.
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// batchexecute 응답은 헤더 prefix `)]}'` + 청크 (정수 byte count + JSON
// 페이로드) 의 반복. byte count 는 *원본 transfer encoding 기준* 이라
// 라이브러리/플랫폼 마다 살짝 어긋날 수 있어, count 는 hint 로만 보고
// 진짜로는 라인 단위로 JSON.parse 를 시도해서 wrb.fr / <rpcid> entry 를
// 찾아내는 방식. 라인 안에 ["wrb.fr",…] entry 가 보이면 그 안의 inner JSON
// 문자열을 한 번 더 JSON.parse 해 돌려준다.
function decodeUsageResponse(text, rpcId) {
  if (typeof text !== "string" || !text) {
    throw new Error("빈 응답");
  }
  let body = text;
  if (body.startsWith(")]}'")) body = body.slice(4);

  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    // 빈 줄 / 정수 라인(byte count) 은 skip
    if (!line || /^\d+$/.test(line)) continue;
    if (!line.startsWith("[")) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      if (Array.isArray(entry) && entry[0] === "wrb.fr" && entry[1] === rpcId) {
        const innerStr = entry[2];
        if (typeof innerStr !== "string") continue;
        try {
          return JSON.parse(innerStr);
        } catch (e) {
          throw new Error("RPC 응답 inner JSON 파싱 실패: " + e.message);
        }
      }
    }
  }
  throw new Error(`응답에서 RPC id "${rpcId}" 를 찾지 못했습니다`);
}

// [sec, ns] tuple → ISO 8601 문자열. null/invalid → null.
function epochToIso(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 1) return null;
  const sec = Number(tuple[0]);
  const ns = Number(tuple[1] || 0);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const ms = sec * 1000 + Math.floor(ns / 1e6);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// jSf9Qc 응답 내부 형태 디코드:
//   [tier:int, [[count, ratio, kind, [[sec, ns]]], …], i8:bool]
//   kind === 1  → 5h (current)
//   kind === 2  → weekly
//   ratio       → 0..1 *남은 비율(remaining)*. 앱 전역의 *_pct 규약은
//                 utilization(소비%)이라 (claudeApi.fetchUsage 와 동일) 100*(1-ratio)
//                 로 역산해 넣는다. ratio 0.59 = 남은 59% → 소비 41%.
//                 (사용자 실측으로 방향 확정, 2026-05-26)
function parseUsageData(arr) {
  if (!Array.isArray(arr) || arr.length < 2) {
    throw new Error("usage 응답 형식이 예상과 다름");
  }
  const tier = TIER_MAP[arr[0]] || null;
  const entries = Array.isArray(arr[1]) ? arr[1] : [];

  let five_hour_pct = 0;
  let weekly_pct = 0;
  let five_hour_resets_at = null;
  let weekly_resets_at = null;

  for (const e of entries) {
    if (!Array.isArray(e) || e.length < 4) continue;
    const ratio = Number(e[1]);
    const kind = Number(e[2]);
    const resetTuple = Array.isArray(e[3]) ? e[3][0] : null;
    // remaining ratio → utilization(소비%) 역산. ratio 누락 시엔 0%(소비 없음).
    const pct = Number.isFinite(ratio) ? 100 - ratio * 100 : 0;
    const iso = epochToIso(resetTuple);
    if (kind === 1) {
      five_hour_pct = pct;
      five_hour_resets_at = iso;
    } else if (kind === 2) {
      weekly_pct = pct;
      weekly_resets_at = iso;
    }
  }

  return {
    tier,
    five_hour_pct,
    weekly_pct,
    five_hour_resets_at,
    weekly_resets_at,
  };
}

// batchexecute 의 f.req body 빌더. RPC argv 는 JSON 문자열이고, 그 문자열이
// 한 번 더 outer JSON 안에 들어간다 (Google wire convention).
function buildBatchexecuteBody(rpcId, atToken) {
  const inner = JSON.stringify([[[rpcId, "[]", null, "generic"]]]);
  const params = new URLSearchParams();
  params.set("f.req", inner);
  if (atToken) params.set("at", atToken);
  return params.toString();
}

// batchexecute 의 query string 빌더. _reqid 는 호출자별 증가 카운터.
function buildBatchexecuteQuery({ rpcId, buildLabel, sessionId, reqId, hl }) {
  const sp = new URLSearchParams();
  sp.set("rpcids", rpcId);
  sp.set("source-path", "/app");
  if (buildLabel) sp.set("bl", buildLabel);
  if (sessionId) sp.set("f.sid", sessionId);
  sp.set("hl", hl || "ko");
  sp.set("_reqid", String(reqId || 1));
  sp.set("rt", "c");
  return sp.toString();
}

// ─── IO (테스트 안 함, fetch 모킹 어렵고 핵심은 위의 pure 들) ───────────

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchSessionTokens(cookie) {
  const ck = sanitizeCookie(cookie);
  let resp;
  try {
    resp = await fetchWithTimeout(
      APP_URL,
      {
        method: "GET",
        headers: {
          Cookie: ck,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "User-Agent": UA,
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "Upgrade-Insecure-Requests": "1",
        },
      },
      10000,
    );
  } catch (e) {
    throw new Error("gemini /app 요청 실패: " + (e && e.message ? e.message : String(e)));
  }
  const html = await resp.text();
  if (!resp.ok) {
    throw new Error(`gemini /app HTTP ${resp.status} — ${html.slice(0, 200).trim()}`);
  }
  const wiz = parseWizGlobalData(html);
  if (!wiz) {
    throw new Error(
      "gemini.google.com 페이지에서 WIZ_global_data 를 찾지 못했습니다. " +
        "쿠키 만료 또는 Google 로그아웃 상태일 수 있어요.",
    );
  }
  const at = extractAtToken(wiz);
  const bl = extractBuildLabel(wiz);
  const sid = extractSessionId(wiz);
  if (!at) {
    throw new Error(
      "WIZ_global_data 에 SNlM0e(at 토큰) 가 비어 있어요. 로그아웃 상태로 보입니다.",
    );
  }
  return { at, bl, sid, cookie: ck };
}

let reqIdCounter = Math.floor(Math.random() * 9000) + 1000;

async function callUsageRpc({ cookie, at, bl, sid }) {
  reqIdCounter += 100000;
  const query = buildBatchexecuteQuery({
    rpcId: USAGE_RPC_ID,
    buildLabel: bl,
    sessionId: sid,
    reqId: reqIdCounter,
    hl: "ko",
  });
  const body = buildBatchexecuteBody(USAGE_RPC_ID, at);

  let resp;
  try {
    resp = await fetchWithTimeout(
      `${BATCHEXEC_URL}?${query}`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Accept: "*/*",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Origin: "https://gemini.google.com",
          Referer: "https://gemini.google.com/",
          "User-Agent": UA,
          "x-same-domain": "1",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        body,
      },
      10000,
    );
  } catch (e) {
    throw new Error("gemini batchexecute 요청 실패: " + (e && e.message ? e.message : String(e)));
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`gemini batchexecute HTTP ${resp.status} — ${text.slice(0, 200).trim()}`);
  }
  return decodeUsageResponse(text, USAGE_RPC_ID);
}

async function fetchUsage(credentials) {
  const c = credentials || {};
  if (!c.cookie || !String(c.cookie).trim()) {
    throw new Error("Gemini provider 자격증명에 cookie 가 비어 있습니다.");
  }
  const tokens = await fetchSessionTokens(c.cookie);
  const inner = await callUsageRpc(tokens);
  const decoded = parseUsageData(inner);
  return {
    provider: id,
    five_hour_pct: decoded.five_hour_pct,
    weekly_pct: decoded.weekly_pct,
    five_hour_resets_at: decoded.five_hour_resets_at,
    weekly_resets_at: decoded.weekly_resets_at,
    tier: decoded.tier || undefined,
    fetched_at: new Date().toISOString(),
  };
}

module.exports = {
  id,
  displayName,
  capabilities,
  fetchUsage,
  // 아래는 테스트에서 직접 검증되는 pure helpers — 외부 호출처는 fetchUsage 만 쓴다.
  parseWizGlobalData,
  extractAtToken,
  extractBuildLabel,
  extractSessionId,
  decodeUsageResponse,
  epochToIso,
  parseUsageData,
  buildBatchexecuteBody,
  buildBatchexecuteQuery,
  USAGE_RPC_ID,
  TIER_MAP,
};
