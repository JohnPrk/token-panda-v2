// ============================================================================
// 🔒 FROZEN CONTRACT — DO NOT MODIFY FOR NEW FEATURES
// ----------------------------------------------------------------------------
// claude-desk-pet/src-tauri/src/usage.rs 의 cargo tests 를 vitest 로 그대로
// 포팅. 행동 명세를 그대로 옮긴 회귀 안전망이라 새 기능을 추가하다 깨지면
// 코드를 고쳐서 통과시킨다. 정당하게 기존 동작을 바꿔야 할 때만 panda
// 규칙 9-E 절차를 따라 명시적으로 업데이트.
// ============================================================================

import { describe, it, expect } from "vitest";
import usage from "./usage.cjs";

const {
  hasToolResult,
  extractUserPromptText,
  truncatePrompt,
  fiveHourWindowStart,
  nextWeekdayAt,
  groupIntoSessions,
  buildSnapshotFromEntries,
  ROLE_ASSISTANT,
  ROLE_USER_PROMPT,
} = usage;

// ─── helpers ─────────────────────────────────────────────────────────────────

const tsMs = (s) => Date.parse(s);

function assistant(tsStr) {
  return {
    timestamp: tsMs(tsStr),
    role: ROLE_ASSISTANT,
    tokens: 0,
    cacheHit: false,
    sessionId: "",
    userPromptText: null,
  };
}

function assistantIn(tsStr, session, cacheHit) {
  return {
    timestamp: tsMs(tsStr),
    role: ROLE_ASSISTANT,
    tokens: 0,
    cacheHit,
    sessionId: session,
    userPromptText: null,
  };
}

function userPromptIn(tsStr, session, text) {
  return {
    timestamp: tsMs(tsStr),
    role: ROLE_USER_PROMPT,
    tokens: 0,
    cacheHit: false,
    sessionId: session,
    userPromptText: text,
  };
}

// ─── has_tool_result ─────────────────────────────────────────────────────────

describe("hasToolResult", () => {
  it("false when content is null", () => {
    expect(hasToolResult(null)).toBe(false);
  });

  it("false when content is not array (single object)", () => {
    expect(hasToolResult({ type: "tool_result" })).toBe(false);
  });

  it("true when an array item has type tool_result", () => {
    expect(hasToolResult([{ type: "text", text: "hi" }, { type: "tool_result" }])).toBe(true);
  });

  it("false when array has no tool_result", () => {
    expect(hasToolResult([{ type: "text" }, { type: "image" }])).toBe(false);
  });

  it("false when array is empty", () => {
    expect(hasToolResult([])).toBe(false);
  });

  it("true when first item is tool_result", () => {
    expect(hasToolResult([{ type: "tool_result" }, { type: "text" }])).toBe(true);
  });

  it("true when multiple tool_results present", () => {
    expect(hasToolResult([{ type: "tool_result" }, { type: "tool_result" }])).toBe(true);
  });

  it("ignores items without type field", () => {
    expect(hasToolResult([{ foo: "bar" }, { type: "tool_result" }])).toBe(true);
  });
});

// ─── extractUserPromptText ───────────────────────────────────────────────────

describe("extractUserPromptText", () => {
  it("picks text from array of blocks", () => {
    expect(extractUserPromptText([{ type: "text", text: "hello" }])).toBe("hello");
  });

  it("returns bare string as-is", () => {
    expect(extractUserPromptText("plain prompt")).toBe("plain prompt");
  });

  it("returns null when no text block", () => {
    expect(extractUserPromptText([{ type: "tool_result", content: "x" }])).toBe(null);
  });

  it("returns null when content missing", () => {
    expect(extractUserPromptText(null)).toBe(null);
  });

  it("picks first text block when multiple present", () => {
    expect(
      extractUserPromptText([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first");
  });

  it("skips non-text blocks before text", () => {
    expect(
      extractUserPromptText([
        { type: "tool_result", content: "x" },
        { type: "text", text: "the prompt" },
      ]),
    ).toBe("the prompt");
  });
});

// ─── truncatePrompt ──────────────────────────────────────────────────────────

describe("truncatePrompt", () => {
  it("keeps short strings intact", () => {
    expect(truncatePrompt("짧음", 40)).toBe("짧음");
  });

  it("collapses whitespace", () => {
    expect(truncatePrompt("a\n\nb   c", 40)).toBe("a b c");
  });

  it("appends ellipsis on overflow", () => {
    const s = "a".repeat(50);
    const out = truncatePrompt(s, 10);
    expect(Array.from(out).length).toBe(11);
    expect(out.endsWith("…")).toBe(true);
  });

  it("counts chars not bytes for Korean", () => {
    expect(truncatePrompt("한글한글한글한글", 4)).toBe("한글한글…");
  });

  it("empty string returns empty", () => {
    expect(truncatePrompt("", 10)).toBe("");
  });

  it("only whitespace collapses to empty", () => {
    expect(truncatePrompt("   \n\t  ", 10)).toBe("");
  });

  it("zero maxChars on non-empty returns just ellipsis", () => {
    expect(truncatePrompt("a", 0)).toBe("…");
    expect(truncatePrompt("", 0)).toBe("");
  });

  it("exactly at maxChars no ellipsis", () => {
    expect(truncatePrompt("0123456789", 10)).toBe("0123456789");
  });
});

// ─── fiveHourWindowStart ─────────────────────────────────────────────────────

describe("fiveHourWindowStart", () => {
  it("none when empty", () => {
    expect(fiveHourWindowStart([], tsMs("2026-05-16T12:00:00Z"))).toBe(null);
  });

  it("anchored at first message within 5h", () => {
    const e1 = assistant("2026-05-16T10:00:00Z");
    const e2 = assistant("2026-05-16T11:30:00Z");
    const now = tsMs("2026-05-16T12:00:00Z");
    expect(fiveHourWindowStart([e1, e2], now)).toBe(tsMs("2026-05-16T10:00:00Z"));
  });

  it("re-anchors when previous 5h lapsed", () => {
    const e1 = assistant("2026-05-16T10:00:00Z");
    const e2 = assistant("2026-05-16T15:30:00Z");
    const now = tsMs("2026-05-16T17:00:00Z");
    expect(fiveHourWindowStart([e1, e2], now)).toBe(tsMs("2026-05-16T15:30:00Z"));
  });

  it("none when latest window already expired", () => {
    const e1 = assistant("2026-05-16T10:00:00Z");
    const now = tsMs("2026-05-16T20:00:00Z");
    expect(fiveHourWindowStart([e1], now)).toBe(null);
  });

  it("returns none at exact 5h boundary (half-open)", () => {
    const e1 = assistant("2026-05-16T10:00:00Z");
    const now = tsMs("2026-05-16T15:00:00Z");
    expect(fiveHourWindowStart([e1], now)).toBe(null);
  });

  it("message at exact +5h boundary starts new window", () => {
    const e1 = assistant("2026-05-16T10:00:00Z");
    const e2 = assistant("2026-05-16T15:00:00Z");
    const now = tsMs("2026-05-16T16:00:00Z");
    expect(fiveHourWindowStart([e1, e2], now)).toBe(tsMs("2026-05-16T15:00:00Z"));
  });

  it("chains three consecutive windows", () => {
    const e1 = assistant("2026-05-16T10:00:00Z");
    const e2 = assistant("2026-05-16T15:30:00Z");
    const e3 = assistant("2026-05-16T21:00:00Z");
    const now = tsMs("2026-05-16T22:00:00Z");
    expect(fiveHourWindowStart([e1, e2, e3], now)).toBe(tsMs("2026-05-16T21:00:00Z"));
  });

  it("single entry within 5h", () => {
    const e1 = assistant("2026-05-16T11:00:00Z");
    const now = tsMs("2026-05-16T13:00:00Z");
    expect(fiveHourWindowStart([e1], now)).toBe(tsMs("2026-05-16T11:00:00Z"));
  });
});

// ─── nextWeekdayAt (Asia/Seoul, weekday 0=Mon..6=Sun) ────────────────────────

describe("nextWeekdayAt", () => {
  it("jumps a week when same day already past", () => {
    // KST 월요일 14:00 → target Mon 09:00 KST → 다음 주 월요일
    const now = tsMs("2026-05-18T05:00:00Z");
    expect(nextWeekdayAt(now, 0, 9, 0)).toBe(tsMs("2026-05-25T00:00:00Z"));
  });

  it("returns today when target time still future on same weekday", () => {
    // KST 월요일 08:00 → target Mon 09:00 KST → 같은 날 09:00 KST
    const now = tsMs("2026-05-17T23:00:00Z");
    expect(nextWeekdayAt(now, 0, 9, 0)).toBe(tsMs("2026-05-18T00:00:00Z"));
  });

  it("returns next Friday 06:00 KST from Thursday 12:00 KST", () => {
    const now = tsMs("2026-05-21T03:00:00Z");
    // weekday 4 = Friday (0=Mon..6=Sun)
    expect(nextWeekdayAt(now, 4, 6, 0)).toBe(tsMs("2026-05-21T21:00:00Z"));
  });

  it("same weekday exact time jumps to next week", () => {
    const now = tsMs("2026-05-18T00:00:00Z");
    expect(nextWeekdayAt(now, 0, 9, 0)).toBe(tsMs("2026-05-25T00:00:00Z"));
  });
});

// ─── groupIntoSessions ───────────────────────────────────────────────────────

describe("groupIntoSessions", () => {
  it("returns empty when no entries", () => {
    expect(groupIntoSessions([], tsMs("2026-05-16T13:00:00Z"))).toEqual([]);
  });

  it("returns one for single session", () => {
    const entries = [
      userPromptIn("2026-05-16T12:58:00Z", "sess-A", "안녕, 코드 리뷰 좀"),
      assistantIn("2026-05-16T12:58:30Z", "sess-A", true),
    ];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions.length).toBe(1);
    expect(sessions[0].session_id).toBe("sess-A");
    expect(sessions[0].last_user_prompt).toBe("안녕, 코드 리뷰…");
    expect(sessions[0].cache_hit).toBe(true);
    expect(sessions[0].last_assistant_at).toBe("2026-05-16T12:58:30.000Z");
  });

  it("drops inactive session past 5min", () => {
    const entries = [
      userPromptIn("2026-05-16T12:52:00Z", "sess-old", "옛 질문"),
      assistantIn("2026-05-16T12:53:00Z", "sess-old", false),
    ];
    expect(groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"))).toEqual([]);
  });

  it("separates by session_id", () => {
    const entries = [
      userPromptIn("2026-05-16T12:58:00Z", "A", "질문 A"),
      assistantIn("2026-05-16T12:58:30Z", "A", false),
      userPromptIn("2026-05-16T12:59:00Z", "B", "질문 B"),
      assistantIn("2026-05-16T12:59:30Z", "B", true),
    ];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions.length).toBe(2);
    expect(sessions[0].session_id).toBe("B");
    expect(sessions[1].session_id).toBe("A");
  });

  it("caps at 5 most recent", () => {
    const entries = [];
    for (let i = 0; i < 7; i++) {
      const session = `s${i}`;
      const userSec = String(i * 5).padStart(2, "0");
      const asstSec = String(i * 5 + 1).padStart(2, "0");
      entries.push(userPromptIn(`2026-05-16T12:55:${userSec}Z`, session, "q"));
      entries.push(assistantIn(`2026-05-16T12:55:${asstSec}Z`, session, false));
    }
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T12:59:00Z"));
    expect(sessions.length).toBe(5);
    expect(sessions[0].session_id).toBe("s6");
    expect(sessions[4].session_id).toBe("s2");
  });

  it("picks prompt just before last assistant", () => {
    const entries = [
      userPromptIn("2026-05-16T12:50:00Z", "X", "첫 질문"),
      assistantIn("2026-05-16T12:50:30Z", "X", false),
      userPromptIn("2026-05-16T12:58:00Z", "X", "두 번째 질문"),
      assistantIn("2026-05-16T12:58:30Z", "X", true),
    ];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions.length).toBe(1);
    expect(sessions[0].last_user_prompt).toBe("두 번째 질문");
  });

  it("fallbacks to placeholder when no prompt", () => {
    const entries = [assistantIn("2026-05-16T12:59:00Z", "Y", false)];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions.length).toBe(1);
    expect(sessions[0].last_user_prompt).toBe("(없음)");
  });

  it("skips empty session_id", () => {
    const entries = [
      userPromptIn("2026-05-16T12:59:00Z", "", "q"),
      assistantIn("2026-05-16T12:59:30Z", "", false),
    ];
    expect(groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"))).toEqual([]);
  });

  it("keeps session with assistant at exact cutoff", () => {
    const entries = [
      userPromptIn("2026-05-16T12:54:00Z", "S", "경계"),
      assistantIn("2026-05-16T12:55:00Z", "S", false),
    ];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions.length).toBe(1);
  });

  it("orders strictly by last assistant time desc", () => {
    const entries = [
      userPromptIn("2026-05-16T12:58:00Z", "A", "qA"),
      assistantIn("2026-05-16T12:58:30Z", "A", false),
      userPromptIn("2026-05-16T12:59:00Z", "B", "qB"),
      assistantIn("2026-05-16T12:59:30Z", "B", true),
      userPromptIn("2026-05-16T12:59:15Z", "C", "qC"),
      assistantIn("2026-05-16T12:59:45Z", "C", false),
    ];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions[0].session_id).toBe("C");
    expect(sessions[1].session_id).toBe("B");
    expect(sessions[2].session_id).toBe("A");
  });

  it("carries cache_hit flag of latest assistant", () => {
    const entries = [
      userPromptIn("2026-05-16T12:58:00Z", "X", "q1"),
      assistantIn("2026-05-16T12:58:30Z", "X", true),
      userPromptIn("2026-05-16T12:59:00Z", "X", "q2"),
      assistantIn("2026-05-16T12:59:30Z", "X", false),
    ];
    const sessions = groupIntoSessions(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(sessions.length).toBe(1);
    expect(sessions[0].cache_hit).toBe(false);
  });
});

// ─── buildSnapshotFromEntries — 통합 ────────────────────────────────────────

describe("buildSnapshotFromEntries", () => {
  it("empty entries → zero counts + null timestamps + empty sessions", () => {
    const snap = buildSnapshotFromEntries([], tsMs("2026-05-16T13:00:00Z"));
    expect(snap.five_hour_tokens).toBe(0);
    expect(snap.weekly_tokens).toBe(0);
    expect(snap.last_request_at).toBe(null);
    expect(snap.last_user_prompt_at).toBe(null);
    expect(snap.is_thinking).toBe(false);
    expect(snap.five_hour_window_start).toBe(null);
    expect(snap.five_hour_resets_at).toBe(null);
    expect(snap.cache_hits_5min).toBe(0);
    expect(snap.cache_misses_5min).toBe(0);
    expect(snap.current_combo).toBe(0);
    expect(snap.last_cache_hit).toBe(null);
    expect(snap.active_sessions).toEqual([]);
  });

  it("aggregates 5h + weekly tokens from assistants only", () => {
    const e1 = { ...assistant("2026-05-16T11:00:00Z"), tokens: 100 };
    const e2 = { ...assistant("2026-05-16T12:00:00Z"), tokens: 250 };
    const snap = buildSnapshotFromEntries([e1, e2], tsMs("2026-05-16T13:00:00Z"));
    expect(snap.five_hour_tokens).toBe(350);
    expect(snap.weekly_tokens).toBe(350);
    expect(snap.five_hour_window_start).toBe("2026-05-16T11:00:00.000Z");
    expect(snap.five_hour_resets_at).toBe("2026-05-16T16:00:00.000Z");
  });

  it("is_thinking true when user prompt newer than last assistant", () => {
    const a = { ...assistant("2026-05-16T12:00:00Z"), tokens: 0 };
    const u = userPromptIn("2026-05-16T12:30:00Z", "S", "q");
    const snap = buildSnapshotFromEntries([a, u], tsMs("2026-05-16T13:00:00Z"));
    expect(snap.is_thinking).toBe(true);
  });

  it("is_thinking false when last assistant newer than user prompt", () => {
    const u = userPromptIn("2026-05-16T12:00:00Z", "S", "q");
    const a = { ...assistant("2026-05-16T12:30:00Z"), tokens: 0 };
    const snap = buildSnapshotFromEntries([u, a], tsMs("2026-05-16T13:00:00Z"));
    expect(snap.is_thinking).toBe(false);
  });

  it("combo counts consecutive trailing hits", () => {
    // hit, miss, hit, hit, hit → combo=3
    const entries = [
      { ...assistantIn("2026-05-16T12:50:00Z", "S", true), tokens: 1 },
      { ...assistantIn("2026-05-16T12:51:00Z", "S", false), tokens: 1 },
      { ...assistantIn("2026-05-16T12:52:00Z", "S", true), tokens: 1 },
      { ...assistantIn("2026-05-16T12:53:00Z", "S", true), tokens: 1 },
      { ...assistantIn("2026-05-16T12:54:00Z", "S", true), tokens: 1 },
    ];
    const snap = buildSnapshotFromEntries(entries, tsMs("2026-05-16T12:55:00Z"));
    expect(snap.current_combo).toBe(3);
    expect(snap.last_cache_hit).toBe(true);
  });

  it("hits/misses within 5min window counted", () => {
    const entries = [
      { ...assistantIn("2026-05-16T12:40:00Z", "S", true), tokens: 1 }, // > 5min ago, drop
      { ...assistantIn("2026-05-16T12:56:00Z", "S", true), tokens: 1 },
      { ...assistantIn("2026-05-16T12:57:00Z", "S", false), tokens: 1 },
      { ...assistantIn("2026-05-16T12:58:00Z", "S", true), tokens: 1 },
    ];
    const snap = buildSnapshotFromEntries(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(snap.cache_hits_5min).toBe(2);
    expect(snap.cache_misses_5min).toBe(1);
  });

  it("active_sessions populated from entries", () => {
    const entries = [
      userPromptIn("2026-05-16T12:58:00Z", "S", "리뷰 부탁"),
      { ...assistantIn("2026-05-16T12:58:30Z", "S", true), tokens: 100 },
    ];
    const snap = buildSnapshotFromEntries(entries, tsMs("2026-05-16T13:00:00Z"));
    expect(snap.active_sessions.length).toBe(1);
    expect(snap.active_sessions[0].session_id).toBe("S");
    expect(snap.active_sessions[0].last_user_prompt).toBe("리뷰 부탁");
  });
});
