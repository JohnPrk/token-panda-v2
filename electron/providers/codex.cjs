// Codex (OpenAI) provider — claude / gemini 와 달리 네트워크·쿠키가 전혀 없다.
// codex CLI 는 매 턴 OpenAI 응답 헤더(x-codex-primary/secondary-*)로 받은 rate
// limit 을 로컬 rollout 로그(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)의
// token_count 이벤트 안 `rate_limits` 객체로 그대로 저장한다. 우리는 그 *마지막*
// 값을 읽어 표시만 한다 → Claude 의 ~/.claude/projects jsonl 워크(usage.cjs)와
// 같은 결, 인증(쿠키/OAuth) 불필요.
//
// rate_limits 실측 형태 (2026-06-13, free plan 계정):
//   { limit_id:"codex", limit_name:null,
//     primary:{ used_percent:80.0, window_minutes:43200, resets_at:1783927909 },
//     secondary:null, credits:null, individual_limit:null,
//     plan_type:"free", rate_limit_reached_type:null }
//   위치: payload.rate_limits (payload.info 의 형제), payload.type === "token_count".
//
// 윈도우 식별은 슬롯명(primary/secondary)이 아니라 window_minutes 로:
//   ~300 = 5h · ~10080 = 주간 · ~43200 = 월간.
// used_percent 는 *소비%* 라 앱 전역의 *_pct(utilization) 규약에 그대로 직결한다
//   (gemini 의 100 - ratio*100 역산과 대비 — codex 는 역산하지 않는다).
// resets_at 는 epoch 초.
//
// 함정: 무료 플랜은 secondary=null + primary=월간(43200)이라 5h/주간이 안 나온다.
//   5h + 주간 두 윈도우는 Plus/Pro 에서 노출된다. 그래서 월간도 같이 파싱해
//   ApiUsage.monthly_* (optional)로 실어 보낸다 — free 사용자도 최소한 월간은 보게.
//
// credentials: 없음. fetchUsage 는 첫 두 인자를 무시하고 로컬 파일만 읽는다.

const fs = require("fs");
const path = require("path");
const os = require("os");

const id = "codex";
const displayName = "Codex";
const capabilities = Object.freeze({
  prepaid: false,
  autoExtract: false,
  tier: true,
});

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

// ─── pure helpers (테스트 대상) ────────────────────────────────────────────

// 윈도우 길이(분) → 어느 한도 버킷인지. 정확히 300/10080/43200 이 아니어도
// 가장 가까운 canonical 로 분류(로그-비율 거리 → 스케일 무관). 0/음수/NaN → null.
const CANONICAL_WINDOWS = Object.freeze([
  { key: "five_hour", minutes: 300 },
  { key: "weekly", minutes: 10080 },
  { key: "monthly", minutes: 43200 },
]);

function classifyWindow(windowMinutes) {
  const m = Number(windowMinutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const w of CANONICAL_WINDOWS) {
    const dist = Math.abs(Math.log(m / w.minutes));
    if (dist < bestDist) {
      bestDist = dist;
      best = w.key;
    }
  }
  return best;
}

// epoch 초 → ISO 8601. null/0/음수/NaN → null.
function epochSecToIso(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;
  const d = new Date(s * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// plan_type 문자열 → 사용자 표시 tier 라벨. 모르는 값은 첫 글자만 대문자로.
const PLAN_TIER_LABELS = Object.freeze({
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
});

function planTypeToTier(planType) {
  if (typeof planType !== "string" || !planType.trim()) return null;
  const key = planType.trim().toLowerCase();
  if (PLAN_TIER_LABELS[key]) return PLAN_TIER_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// rate_limits 객체 → 앱 ApiUsage 의 부분 shape. primary/secondary 두 슬롯을
// window_minutes 로 분류해 5h/주간/월간 자리에 각각 꽂는다. used_percent 는 이미
// 소비% 라 그대로(역산 없음). 누락/형식오류 슬롯은 건너뛴다.
function parseRateLimits(rl) {
  const out = {
    five_hour_pct: 0,
    weekly_pct: 0,
    monthly_pct: null,
    five_hour_resets_at: null,
    weekly_resets_at: null,
    monthly_resets_at: null,
    tier: null,
    plan_type: null,
  };
  if (!rl || typeof rl !== "object") return out;
  out.plan_type = typeof rl.plan_type === "string" ? rl.plan_type : null;
  out.tier = planTypeToTier(rl.plan_type);

  for (const slot of [rl.primary, rl.secondary]) {
    if (!slot || typeof slot !== "object") continue;
    const bucket = classifyWindow(slot.window_minutes);
    if (!bucket) continue;
    const pct = Number(slot.used_percent);
    const iso = epochSecToIso(slot.resets_at);
    if (bucket === "five_hour") {
      out.five_hour_pct = Number.isFinite(pct) ? pct : 0;
      out.five_hour_resets_at = iso;
    } else if (bucket === "weekly") {
      out.weekly_pct = Number.isFinite(pct) ? pct : 0;
      out.weekly_resets_at = iso;
    } else if (bucket === "monthly") {
      out.monthly_pct = Number.isFinite(pct) ? pct : null;
      out.monthly_resets_at = iso;
    }
  }
  return out;
}

// rollout-*.jsonl 텍스트에서 *마지막* token_count 이벤트의 rate_limits 객체를
// 돌려준다. 라인 단위 JSON. rate_limits 가 없거나(null) 깨진 라인은 skip. 끝까지
// 훑어 마지막 비-null rate_limits 를 반환(같은 파일에서 가장 최신). 없으면 null.
function extractLatestRateLimits(jsonlText) {
  if (typeof jsonlText !== "string" || !jsonlText) return null;
  let found = null;
  const lines = jsonlText.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    // 값싼 1차 필터 — 대부분 라인엔 rate_limits 가 없어 JSON.parse 비용을 아낀다.
    if (line.indexOf("rate_limits") < 0) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = obj && obj.payload;
    if (!payload || payload.type !== "token_count") continue;
    const rl = payload.rate_limits;
    if (rl && typeof rl === "object") found = rl;
  }
  return found;
}

// ─── IO (테스트는 sessionsDir 주입으로 fixture 디렉토리를 가리킨다) ──────────

// sessionsDir 아래 rollout-*.jsonl 들을 { path, mtimeMs } 로 모아 mtime 내림차순.
// 디렉토리 구조(YYYY/MM/DD)는 가정하지 않고 재귀 walk. 못 읽는 디렉토리는 skip.
function listRolloutFiles(sessionsDir) {
  const out = [];
  const stack = [sessionsDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (
        e.isFile() &&
        e.name.startsWith("rollout-") &&
        e.name.endsWith(".jsonl")
      ) {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        out.push({ path: full, mtimeMs });
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

// 가장 최근(mtime) 파일부터 훑어 rate_limits 가 든 첫 파일의 마지막 값을 반환.
// rate limit 은 계정 전역이라 가장 최근에 쓰인 파일이 가장 최신 상태를 갖는다.
// 새 세션이 아직 한 턴도 안 끝나 rate_limits 가 없을 수 있어 다음 파일로 넘어간다.
// 최대 MAX_SCAN 개만 확인(보통 첫 파일에서 끝남).
const MAX_SCAN = 25;

function readLatestRateLimits(sessionsDir) {
  const files = listRolloutFiles(sessionsDir || DEFAULT_SESSIONS_DIR);
  let scanned = 0;
  for (const f of files) {
    if (scanned >= MAX_SCAN) break;
    scanned += 1;
    let text;
    try {
      text = fs.readFileSync(f.path, "utf8");
    } catch {
      continue;
    }
    const rl = extractLatestRateLimits(text);
    if (rl) return { rateLimits: rl, sourcePath: f.path, sourceMtimeMs: f.mtimeMs };
  }
  return null;
}

// provider 인터페이스. credentials / onRefresh 는 무시(로컬 파일만 읽음).
// sessionsDir 은 테스트 주입용 — main 은 2 인자로만 호출해 DEFAULT 를 쓴다.
async function fetchUsage(_credentials, _onRefresh, sessionsDir) {
  const found = readLatestRateLimits(sessionsDir || DEFAULT_SESSIONS_DIR);
  if (!found) {
    throw new Error(
      "Codex 사용 기록을 찾지 못했어요. Codex CLI(코덱스)를 한 번 이상 실행하면 " +
        "~/.codex/sessions 에 사용량이 기록됩니다.",
    );
  }
  const d = parseRateLimits(found.rateLimits);
  const usage = {
    provider: id,
    five_hour_pct: d.five_hour_pct,
    weekly_pct: d.weekly_pct,
    five_hour_resets_at: d.five_hour_resets_at,
    weekly_resets_at: d.weekly_resets_at,
    fetched_at: new Date().toISOString(),
  };
  if (d.tier) usage.tier = d.tier;
  // 월간 한도(주로 free 플랜)도 있으면 같이 실어 준다. 5h/주간이 0 이어도
  // 사용자가 최소한 월간은 볼 수 있도록 — 표시 UI 는 optional 필드를 읽어 분기.
  if (d.monthly_pct != null) {
    usage.monthly_pct = d.monthly_pct;
    usage.monthly_resets_at = d.monthly_resets_at;
  }
  return usage;
}

module.exports = {
  id,
  displayName,
  capabilities,
  fetchUsage,
  DEFAULT_SESSIONS_DIR,
  // 아래는 테스트에서 직접 검증되는 pure/IO helpers — 외부 호출처는 fetchUsage 만 쓴다.
  classifyWindow,
  epochSecToIso,
  planTypeToTier,
  parseRateLimits,
  extractLatestRateLimits,
  listRolloutFiles,
  readLatestRateLimits,
  CANONICAL_WINDOWS,
};
