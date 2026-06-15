// claude-desk-pet/src-tauri/src/usage.rs 의 Node 포트.
// ~/.claude/projects/**/*.jsonl 를 워크해서 5h/주간 토큰, cache hit/miss/콤보,
// 활성 세션 카드(top 5)를 한 번에 만들어낸다. IO 와 순수 로직을 분리해서
// 순수부는 vitest 로 검증 가능 (helpers.cjs 패턴 동일).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const WEEKLY_LOOKBACK_DAYS = 7;
const CACHE_WINDOW_MS = 5 * 60 * 1000;
// 활성 세션 정의: 마지막 assistant 응답이 5분 이내 (prompt cache TTL 과 동일).
const SESSION_ACTIVE_SECS = 5 * 60;
const MAX_ACTIVE_SESSIONS = 5;
const SESSION_PROMPT_PREVIEW_CHARS = 10;

const ROLE_ASSISTANT = "assistant";
const ROLE_USER_PROMPT = "user_prompt";
const ROLE_USER_TOOL_RESULT = "user_tool_result";

// ─── 순수 helpers ─────────────────────────────────────────────────────────────

// content array 에 tool_result 항목이 있으면 true. user role 의 tool_result
// follow-up 을 UserPrompt 와 구분하는 데 쓰인다.
function hasToolResult(content) {
  if (content == null) return false;
  if (!Array.isArray(content)) return false;
  for (const item of content) {
    if (item && typeof item === "object" && item.type === "tool_result") {
      return true;
    }
  }
  return false;
}

// UserPrompt content 에서 첫 text 블록을 뽑는다. Anthropic JSONL 의 content 는
// `[{"type":"text","text":"..."}]` 형태가 일반적이고, 가끔 그냥 string.
function extractUserPromptText(content) {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === "object" && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }
  return null;
}

// 줄바꿈/연속 공백을 한 칸으로 압축 + maxChars 초과 시 말줄임표. char 단위
// (Array.from) 이라 한글도 안전. maxChars=0 + 비어있지 않은 입력 → "…".
function truncatePrompt(s, maxChars) {
  const cleaned = (s || "").split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(cleaned);
  if (chars.length <= maxChars) return cleaned;
  const truncated = chars.slice(0, maxChars).join("").replace(/\s+$/, "");
  return `${truncated}…`;
}

// 5시간 윈도우 anchor. assistant 응답들을 시간순으로 훑으며, 직전 윈도우가
// 만료(start+5h <= entry.ts)되면 그 entry 로 새 윈도우를 시작. 모든 윈도우가
// now 이전에 만료되면 null.
function fiveHourWindowStart(assistantEntries, now) {
  if (assistantEntries.length === 0) return null;
  let start = assistantEntries[0].timestamp;
  let end = start + 5 * 3600 * 1000;
  for (let i = 1; i < assistantEntries.length; i++) {
    const ts = assistantEntries[i].timestamp;
    if (ts >= end) {
      start = ts;
      end = start + 5 * 3600 * 1000;
    }
  }
  if (now >= end) return null;
  return start;
}

// Asia/Seoul (UTC+9, DST 없음) 기준 다음 weekday 의 hh:mm 을 UTC 로 환산.
// weekday: 0=Mon ... 6=Sun (Rust `num_days_from_monday` 호환). now 와 candidate
// 가 같은 시각이면 다음 주로 점프(candidate <= now).
function nextWeekdayAt(nowUtcMs, weekday, hour, minute) {
  const KST_OFFSET_MS = 9 * 3600 * 1000;
  const kstMs = nowUtcMs + KST_OFFSET_MS;
  const kstDate = new Date(kstMs);
  // JS getUTCDay: 0=Sun..6=Sat. 0=Mon..6=Sun 으로 변환.
  const currentWeekday = (kstDate.getUTCDay() + 6) % 7;
  let delta = (weekday - currentWeekday + 7) % 7;
  let targetKstMs = Date.UTC(
    kstDate.getUTCFullYear(),
    kstDate.getUTCMonth(),
    kstDate.getUTCDate() + delta,
    hour,
    minute,
    0,
  );
  let targetUtcMs = targetKstMs - KST_OFFSET_MS;
  if (targetUtcMs <= nowUtcMs) {
    targetUtcMs += 7 * 24 * 3600 * 1000;
  }
  return targetUtcMs;
}

// ParsedEntry[] → SessionInfo[]. 같은 session_id 끼리 묶고 마지막 assistant 가
// 5분 이내인 세션만 추림. 라벨은 마지막 assistant 직전 UserPrompt 의 text.
// 최신 응답 desc 정렬, 상위 5 개. session_id 가 빈 문자열인 그룹은 drop.
function groupIntoSessions(entries, nowMs) {
  const cutoff = nowMs - SESSION_ACTIVE_SECS * 1000;
  const bySession = new Map();
  for (const e of entries) {
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId).push(e);
  }
  const sessions = [];
  for (const [sessionId, group] of bySession) {
    if (sessionId === "") continue;
    group.sort((a, b) => a.timestamp - b.timestamp);
    let asstIdx = -1;
    for (let i = group.length - 1; i >= 0; i--) {
      if (group[i].role === ROLE_ASSISTANT) {
        asstIdx = i;
        break;
      }
    }
    if (asstIdx === -1) continue;
    const asst = group[asstIdx];
    if (asst.timestamp < cutoff) continue;
    // 마지막 assistant 직전의 UserPrompt (tool_result follow-up 은 안 잡힘).
    let promptText = null;
    for (let i = asstIdx - 1; i >= 0; i--) {
      if (group[i].role === ROLE_USER_PROMPT) {
        promptText = group[i].userPromptText;
        break;
      }
    }
    if (promptText == null) promptText = "(없음)";
    sessions.push({
      session_id: sessionId,
      last_user_prompt: truncatePrompt(promptText, SESSION_PROMPT_PREVIEW_CHARS),
      last_assistant_at: new Date(asst.timestamp).toISOString(),
      cache_hit: asst.cacheHit,
    });
  }
  // Array.sort 는 ES2019 이후 stable. 같은 시각이면 삽입 순서 유지.
  sessions.sort((a, b) => Date.parse(b.last_assistant_at) - Date.parse(a.last_assistant_at));
  return sessions.slice(0, MAX_ACTIVE_SESSIONS);
}

// 파싱된 ParsedEntry[] 를 받아 UsageSnapshot (active_sessions + 5h/주간 토큰
// + cache hit/miss/콤보) 를 만든다. IO 없는 순수 함수라 테스트 가능.
function buildSnapshotFromEntries(entries, nowMs) {
  const assistants = entries.filter((e) => e.role === ROLE_ASSISTANT);
  const fiveStart = fiveHourWindowStart(assistants, nowMs);
  const fiveReset = fiveStart != null ? fiveStart + 5 * 3600 * 1000 : null;

  let fiveHour = 0;
  let weekly = 0;
  let weeklyFirst = null;
  let lastAssistantAt = null;
  let lastUserPromptAt = null;
  const cacheWindowStart = nowMs - CACHE_WINDOW_MS;
  let hits5min = 0;
  let misses5min = 0;
  let lastCacheHit = null;

  for (const e of entries) {
    if (e.role === ROLE_ASSISTANT) {
      weekly += e.tokens;
      if (weeklyFirst == null) weeklyFirst = e.timestamp;
      if (fiveStart != null && e.timestamp >= fiveStart && e.timestamp <= nowMs) {
        fiveHour += e.tokens;
      }
      lastAssistantAt = e.timestamp;
      lastCacheHit = e.cacheHit;
      if (e.timestamp >= cacheWindowStart) {
        if (e.cacheHit) hits5min += 1;
        else misses5min += 1;
      }
    } else if (e.role === ROLE_USER_PROMPT) {
      lastUserPromptAt = e.timestamp;
    }
  }

  // Combo: 마지막 assistant 부터 뒤로 가며 hit 연속 카운트, miss 만나면 멈춤.
  let combo = 0;
  for (let i = assistants.length - 1; i >= 0; i--) {
    if (assistants[i].cacheHit) combo += 1;
    else break;
  }

  // Anthropic 주간 윈도우는 계정마다 고정 요일 기준. 한국 계정 기본값 = 금 06:00 KST.
  const weeklyReset = nextWeekdayAt(nowMs, 4, 6, 0);

  const isThinking =
    lastUserPromptAt != null && lastAssistantAt != null
      ? lastUserPromptAt > lastAssistantAt
      : lastUserPromptAt != null && lastAssistantAt == null;

  return {
    five_hour_tokens: fiveHour,
    weekly_tokens: weekly,
    last_request_at: lastAssistantAt != null ? new Date(lastAssistantAt).toISOString() : null,
    last_user_prompt_at: lastUserPromptAt != null ? new Date(lastUserPromptAt).toISOString() : null,
    is_thinking: isThinking,
    five_hour_window_start: fiveStart != null ? new Date(fiveStart).toISOString() : null,
    five_hour_resets_at: fiveReset != null ? new Date(fiveReset).toISOString() : null,
    weekly_window_start: weeklyFirst != null ? new Date(weeklyFirst).toISOString() : null,
    weekly_resets_at: new Date(weeklyReset).toISOString(),
    cache_hits_5min: hits5min,
    cache_misses_5min: misses5min,
    current_combo: combo,
    last_cache_hit: lastCacheHit,
    active_sessions: groupIntoSessions(entries, nowMs),
  };
}

// ─── IO ──────────────────────────────────────────────────────────────────────

function claudeProjectsDir() {
  const home = os.homedir();
  if (!home) return null;
  const p = path.join(home, ".claude", "projects");
  try {
    if (fs.statSync(p).isDirectory()) return p;
  } catch {}
  return null;
}

// 한 jsonl 파일을 라인 단위로 파싱해서 ParsedEntry 들을 out 에 push.
// since 이전 timestamp 는 drop. session_id 는 파일 basename(확장자 제외).
function scanFile(filePath, sinceMs, out) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const sessionId = path.basename(filePath, path.extname(filePath));
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.includes('"timestamp"')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj && obj.message;
    if (!msg) continue;
    const tsStr = obj.timestamp;
    if (typeof tsStr !== "string") continue;
    const ts = Date.parse(tsStr);
    if (!Number.isFinite(ts)) continue;
    if (ts < sinceMs) continue;

    let role;
    if (msg.role === "assistant") {
      role = ROLE_ASSISTANT;
    } else if (msg.role === "user") {
      role = hasToolResult(msg.content) ? ROLE_USER_TOOL_RESULT : ROLE_USER_PROMPT;
    } else {
      continue;
    }

    let tokens = 0;
    let cacheHit = false;
    if (role === ROLE_ASSISTANT) {
      const u = msg.usage;
      if (!u) continue;
      // Anthropic 청구 가중치: input/output/cache_creation 풀가 + cache_read ~0.1×.
      // 청구 비율을 quota 근사로 미러링 — 지키미 % 가 Claude UI % 와 ~5% 안 일치.
      const cacheRead = numOr0(u.cache_read_input_tokens);
      tokens =
        numOr0(u.input_tokens) +
        numOr0(u.output_tokens) +
        numOr0(u.cache_creation_input_tokens) +
        Math.floor(cacheRead / 10);
      cacheHit = cacheRead > 0;
    }

    const userPromptText = role === ROLE_USER_PROMPT ? extractUserPromptText(msg.content) : null;

    out.push({
      timestamp: ts,
      role,
      tokens,
      cacheHit,
      sessionId,
      userPromptText,
    });
  }
}

function numOr0(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ~/.claude/projects 아래 *.jsonl 전부 워크. 파일 mtime 이 since-1h 이전이면
// 스킵 (오래된 파일 안 열어도 됨). 결과는 timestamp asc 정렬.
function collectParsedSince(sinceMs) {
  const root = claudeProjectsDir();
  if (!root) return [];
  const skipBefore = sinceMs - 3600 * 1000;
  const out = [];
  walkJsonl(root, (filePath, mtimeMs) => {
    if (Number.isFinite(mtimeMs) && mtimeMs < skipBefore) return;
    scanFile(filePath, sinceMs, out);
  });
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

function walkJsonl(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkJsonl(full, onFile);
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      let mtimeMs = NaN;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {}
      onFile(full, mtimeMs);
    }
  }
}

// main.cjs 폴링에서 호출되는 진입점. 현재 시각 기준 7일 이전부터 워크.
function snapshot(nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const since = now - WEEKLY_LOOKBACK_DAYS * 24 * 3600 * 1000;
  const parsed = collectParsedSince(since);
  return buildSnapshotFromEntries(parsed, now);
}

module.exports = {
  // pure
  hasToolResult,
  extractUserPromptText,
  truncatePrompt,
  fiveHourWindowStart,
  nextWeekdayAt,
  groupIntoSessions,
  buildSnapshotFromEntries,
  // io
  claudeProjectsDir,
  scanFile,
  collectParsedSince,
  snapshot,
  // constants (테스트 편의)
  ROLE_ASSISTANT,
  ROLE_USER_PROMPT,
  ROLE_USER_TOOL_RESULT,
  MAX_ACTIVE_SESSIONS,
  SESSION_PROMPT_PREVIEW_CHARS,
};
