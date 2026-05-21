// src-tauri/src/claude_api.rs + login_capture.rs 의 MVP 포팅 (usage 조회 + 쿠키→org 추출).
// Node 18+ 글로벌 fetch 사용. 동작/필드명은 Rust 원본과 1:1로 맞춰 프론트엔드가
// 기대하는 스냅샷 형태를 그대로 만족시킨다.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const KEEP = ["sessionKey", "cf_clearance", "__cf_bm", "_cfuvid", "routingHint"];

// Slack/Notion 등에서 복사 시 끼는 마크다운 autolink([text](url))를 평탄화하고
// 줄바꿈/공백을 단일 공백으로 접는다 (HTTP 헤더는 raw 개행 거부).
function sanitizeCookie(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "[") {
      const close = raw.indexOf("]", i + 1);
      if (close !== -1) {
        if (raw[close + 1] === "(") {
          const paren = raw.indexOf(")", close + 2);
          if (paren !== -1) {
            out += raw.slice(i + 1, close);
            i = paren + 1;
            continue;
          }
        }
        out += raw.slice(i + 1, close);
        i = close + 1;
        continue;
      }
    }
    out += raw[i];
    i++;
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

function pickUtilization(w) {
  const cands = [
    "utilization",
    "utilization_pct",
    "utilization_percentage",
    "percent_used",
    "pct_used",
    "used_pct",
  ];
  for (const c of cands) {
    const v = w && w[c];
    if (typeof v === "number") return v <= 1.5 ? v * 100 : v;
  }
  if (w && Array.isArray(w.buckets)) {
    let best = null;
    for (const it of w.buckets) {
      const v = pickUtilization(it);
      if (v != null) best = best == null ? v : Math.max(best, v);
    }
    if (best != null) return best;
  }
  return null;
}

function pickReset(w) {
  const cands = ["resets_at", "reset_at", "expires_at", "ends_at"];
  for (const c of cands) {
    const s = w && w[c];
    if (typeof s === "string") {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function extractWindow(root, keys) {
  for (const k of keys) {
    const w = root && root[k];
    if (w != null) {
      const u = pickUtilization(w);
      const r = pickReset(w);
      if (u != null || r != null) return [u, r];
    }
  }
  return [null, null];
}

async function fetchWithTimeout(url, headers, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// claude.ai 내부 usage 엔드포인트 조회. 성공 시 ApiUsage(JSON) 반환, 실패 시 throw.
async function fetchUsage(orgId, cookie) {
  const ck = sanitizeCookie(cookie);
  const url = `https://claude.ai/api/organizations/${orgId}/usage`;
  let resp;
  try {
    resp = await fetchWithTimeout(
      url,
      {
        Cookie: ck,
        Accept: "*/*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://claude.ai/settings/usage",
        "anthropic-client-platform": "web_claude_ai",
        "anthropic-client-version": "1.0.0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "User-Agent": UA,
      },
      10000,
    );
  } catch (e) {
    throw new Error("request: " + (e && e.message ? e.message : String(e)));
  }
  const body = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} — ${body.slice(0, 200).trim()}`);
  }
  let root;
  try {
    root = JSON.parse(body);
  } catch (e) {
    throw new Error(`응답 파싱 실패: ${e.message} (${body.slice(0, 200).trim()})`);
  }
  const [five, fiveR] = extractWindow(root, [
    "five_hour",
    "five_hour_limit",
    "five_hour_window",
    "five_hour_usage",
  ]);
  const [week, weekR] = extractWindow(root, [
    "seven_day",
    "seven_day_limit",
    "seven_day_window",
    "weekly",
    "weekly_limit",
    "weekly_overall",
  ]);
  if (five == null && week == null) {
    throw new Error(
      `응답에서 five_hour/seven_day 필드를 못 찾음: ${body.slice(0, 300).trim()}`,
    );
  }
  return {
    five_hour_pct: five == null ? 0 : five,
    weekly_pct: week == null ? 0 : week,
    five_hour_resets_at: fiveR,
    weekly_resets_at: weekR,
    fetched_at: new Date().toISOString(),
  };
}

function parseRawCookieHeader(raw) {
  const out = [];
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name) out.push([name, value]);
    }
  }
  return out;
}

function buildCookieHeader(pairs) {
  const picked = [];
  for (const name of KEEP) {
    const hit = pairs.find(([n]) => n === name);
    if (hit) picked.push(`${name}=${hit[1]}`);
  }
  return picked.join("; ");
}

function extractOrgId(body) {
  try {
    const v = JSON.parse(body);
    if (!Array.isArray(v)) return null;
    for (const o of v) {
      const u = o && o.uuid;
      if (typeof u === "string" && u.length > 0) return u;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// 붙여넣은 raw cookie 한 줄 → 5종만 추려 /api/organizations 호출 → org_id 추출.
// 성공 시 { org_id, cookie } (프론트엔드가 snake_case org_id를 읽음).
async function autoExtract(rawCookie) {
  const pairs = parseRawCookieHeader(rawCookie);
  if (!pairs.some(([n]) => n === "sessionKey")) {
    throw new Error(
      "sessionKey 쿠키가 보이지 않아요. claude.ai의 cookie 헤더 한 줄을 통째로 붙여넣어 주세요.",
    );
  }
  const cookieHeader = buildCookieHeader(pairs);
  let resp;
  try {
    resp = await fetchWithTimeout(
      "https://claude.ai/api/organizations",
      {
        Cookie: cookieHeader,
        Accept: "*/*",
        Referer: "https://claude.ai/",
        "anthropic-client-platform": "web_claude_ai",
        "anthropic-client-version": "1.0.0",
        "User-Agent": UA,
      },
      10000,
    );
  } catch (e) {
    throw new Error("/api/organizations 요청 실패: " + (e && e.message ? e.message : String(e)));
  }
  const body = await resp.text();
  if (!resp.ok) throw new Error(`/api/organizations HTTP ${resp.status}`);
  const orgId = extractOrgId(body);
  if (!orgId) throw new Error("organizations 응답에서 org_id를 추출하지 못했어요");
  return { org_id: orgId, cookie: cookieHeader };
}

module.exports = { fetchUsage, autoExtract, sanitizeCookie };
