// Codex provider 의 pure helper + 로컬 파일 IO 안전망.
// 네트워크가 없는 provider 라(로컬 rollout 로그만 읽음) IO 까지 tmp 디렉토리
// fixture 로 단위 검증한다. fetchUsage 의 happy-path 는 스모크(9-B)에도 걸린다.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import codex from "./codex.cjs";

const {
  classifyWindow,
  epochSecToIso,
  planTypeToTier,
  parseRateLimits,
  extractLatestRateLimits,
  listRolloutFiles,
  readLatestRateLimits,
  fetchUsage,
} = codex;

// 2026-06-13 로컬 실측 (free 플랜): primary=월간(43200분), secondary=null.
const REAL_FREE_RL = {
  limit_id: "codex",
  limit_name: null,
  primary: { used_percent: 80.0, window_minutes: 43200, resets_at: 1783927909 },
  secondary: null,
  credits: null,
  individual_limit: null,
  plan_type: "free",
  rate_limit_reached_type: null,
};

// 합성 (Plus/Pro 가정): primary=5h(300분), secondary=주간(10080분). 스키마는
// 실측 free 와 동일, 두 윈도우가 채워지는 케이스 검증용.
const SYNTH_PLUS_RL = {
  limit_id: "codex",
  primary: { used_percent: 42.5, window_minutes: 300, resets_at: 1783900000 },
  secondary: { used_percent: 13.0, window_minutes: 10080, resets_at: 1784400000 },
  plan_type: "plus",
};

function tokenCountLine(rateLimits, ts = "2026-06-13T08:01:50.213Z") {
  return JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { total_tokens: 123 } },
      rate_limits: rateLimits,
    },
  });
}

describe("classifyWindow", () => {
  it("canonical 값을 정확히 분류", () => {
    expect(classifyWindow(300)).toBe("five_hour");
    expect(classifyWindow(10080)).toBe("weekly");
    expect(classifyWindow(43200)).toBe("monthly");
  });

  it("근사값도 가장 가까운 canonical 로", () => {
    expect(classifyWindow(305)).toBe("five_hour");
    expect(classifyWindow(9000)).toBe("weekly");
    expect(classifyWindow(44640)).toBe("monthly"); // 31일
  });

  it("문자열 숫자도 허용", () => {
    expect(classifyWindow("10080")).toBe("weekly");
  });

  it("0·음수·NaN·비숫자는 null", () => {
    expect(classifyWindow(0)).toBeNull();
    expect(classifyWindow(-5)).toBeNull();
    expect(classifyWindow(NaN)).toBeNull();
    expect(classifyWindow("abc")).toBeNull();
    expect(classifyWindow(null)).toBeNull();
    expect(classifyWindow(undefined)).toBeNull();
  });
});

describe("epochSecToIso", () => {
  it("정상 epoch 초 → ISO", () => {
    expect(epochSecToIso(1700000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("실측 resets_at 도 ISO 문자열로", () => {
    expect(epochSecToIso(1783927909)).toBe(
      new Date(1783927909 * 1000).toISOString(),
    );
    expect(epochSecToIso(1783927909)).toMatch(/Z$/);
  });

  it("0·음수·NaN·null 은 null", () => {
    expect(epochSecToIso(0)).toBeNull();
    expect(epochSecToIso(-1)).toBeNull();
    expect(epochSecToIso(NaN)).toBeNull();
    expect(epochSecToIso(null)).toBeNull();
    expect(epochSecToIso(undefined)).toBeNull();
  });
});

describe("planTypeToTier", () => {
  it("알려진 plan_type 라벨", () => {
    expect(planTypeToTier("free")).toBe("Free");
    expect(planTypeToTier("plus")).toBe("Plus");
    expect(planTypeToTier("pro")).toBe("Pro");
    expect(planTypeToTier("PRO")).toBe("Pro"); // 대소문자 무시
    expect(planTypeToTier("team")).toBe("Team");
    expect(planTypeToTier("enterprise")).toBe("Enterprise");
  });

  it("모르는 값은 첫 글자만 대문자", () => {
    expect(planTypeToTier("startup")).toBe("Startup");
  });

  it("빈 값·비문자열은 null", () => {
    expect(planTypeToTier("")).toBeNull();
    expect(planTypeToTier("   ")).toBeNull();
    expect(planTypeToTier(null)).toBeNull();
    expect(planTypeToTier(42)).toBeNull();
  });
});

describe("parseRateLimits", () => {
  it("실측 free: primary=월간만, 5h/주간은 0", () => {
    const r = parseRateLimits(REAL_FREE_RL);
    expect(r.five_hour_pct).toBe(0);
    expect(r.weekly_pct).toBe(0);
    expect(r.five_hour_resets_at).toBeNull();
    expect(r.weekly_resets_at).toBeNull();
    expect(r.monthly_pct).toBe(80);
    expect(r.monthly_resets_at).toBe(new Date(1783927909 * 1000).toISOString());
    expect(r.tier).toBe("Free");
    expect(r.plan_type).toBe("free");
  });

  it("Plus: primary=5h, secondary=주간 두 윈도우 채움", () => {
    const r = parseRateLimits(SYNTH_PLUS_RL);
    expect(r.five_hour_pct).toBe(42.5);
    expect(r.weekly_pct).toBe(13.0);
    expect(r.five_hour_resets_at).toBe(new Date(1783900000 * 1000).toISOString());
    expect(r.weekly_resets_at).toBe(new Date(1784400000 * 1000).toISOString());
    expect(r.monthly_pct).toBeNull();
    expect(r.tier).toBe("Plus");
  });

  it("used_percent 는 소비% 그대로(역산 없음)", () => {
    const r = parseRateLimits({
      primary: { used_percent: 7, window_minutes: 300, resets_at: 1783900000 },
    });
    expect(r.five_hour_pct).toBe(7); // 100-7=93 같은 역산이 아님
  });

  it("used_percent 누락 슬롯은 0/유지, resets 누락은 null", () => {
    const r = parseRateLimits({
      primary: { window_minutes: 300 },
      secondary: { used_percent: "bad", window_minutes: 10080 },
    });
    expect(r.five_hour_pct).toBe(0);
    expect(r.five_hour_resets_at).toBeNull();
    expect(r.weekly_pct).toBe(0);
  });

  it("null·비객체는 기본값", () => {
    const r = parseRateLimits(null);
    expect(r.five_hour_pct).toBe(0);
    expect(r.weekly_pct).toBe(0);
    expect(r.monthly_pct).toBeNull();
    expect(r.tier).toBeNull();
    expect(parseRateLimits("nope").five_hour_pct).toBe(0);
  });
});

describe("extractLatestRateLimits", () => {
  it("여러 token_count 중 마지막 rate_limits 채택", () => {
    const text = [
      tokenCountLine(SYNTH_PLUS_RL, "2026-06-13T08:00:00.000Z"),
      '{"timestamp":"x","type":"event_msg","payload":{"type":"agent_message","message":"hi"}}',
      tokenCountLine(REAL_FREE_RL, "2026-06-13T08:05:00.000Z"),
    ].join("\n");
    const rl = extractLatestRateLimits(text);
    expect(rl.plan_type).toBe("free");
    expect(rl.primary.window_minutes).toBe(43200);
  });

  it("rate_limits 없는 라인·다른 이벤트는 무시", () => {
    const text = [
      '{"type":"session_meta","payload":{"id":"abc"}}',
      '{"type":"event_msg","payload":{"type":"agent_message","message":"no rate_limits here"}}',
    ].join("\n");
    expect(extractLatestRateLimits(text)).toBeNull();
  });

  it("rate_limits 가 null 인 token_count 는 건너뛰고 직전 유효값 유지", () => {
    const nullRlLine = JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", info: {}, rate_limits: null },
    });
    const text = [tokenCountLine(SYNTH_PLUS_RL), nullRlLine].join("\n");
    const rl = extractLatestRateLimits(text);
    expect(rl).not.toBeNull();
    expect(rl.plan_type).toBe("plus");
  });

  it("깨진 JSON 라인은 건너뜀", () => {
    const text = [
      '{"type":"event_msg","payload":{"type":"token_count","rate_limits": BROKEN',
      tokenCountLine(REAL_FREE_RL),
    ].join("\n");
    const rl = extractLatestRateLimits(text);
    expect(rl.plan_type).toBe("free");
  });

  it("빈 문자열·비문자열은 null", () => {
    expect(extractLatestRateLimits("")).toBeNull();
    expect(extractLatestRateLimits(null)).toBeNull();
    expect(extractLatestRateLimits(123)).toBeNull();
  });
});

// ─── 로컬 파일 IO (tmp fixture 디렉토리) ───────────────────────────────────

describe("listRolloutFiles + readLatestRateLimits (IO)", () => {
  function mkFixtureDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
    fs.mkdirSync(path.join(dir, "2026", "06", "13"), { recursive: true });
    return dir;
  }
  function writeRollout(dir, name, content, mtimeSec) {
    const p = path.join(dir, "2026", "06", "13", name);
    fs.writeFileSync(p, content);
    if (mtimeSec != null) fs.utimesSync(p, mtimeSec, mtimeSec);
    return p;
  }

  it("rollout-*.jsonl 만 모아 mtime 내림차순", () => {
    const dir = mkFixtureDir();
    writeRollout(dir, "rollout-a.jsonl", tokenCountLine(REAL_FREE_RL), 1000);
    writeRollout(dir, "rollout-b.jsonl", tokenCountLine(SYNTH_PLUS_RL), 2000);
    writeRollout(dir, "not-a-rollout.jsonl", "x", 3000);
    writeRollout(dir, "rollout-c.txt", "x", 4000);
    const files = listRolloutFiles(dir);
    const names = files.map((f) => path.basename(f.path));
    expect(names).toEqual(["rollout-b.jsonl", "rollout-a.jsonl"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("가장 최근 파일의 rate_limits 채택", () => {
    const dir = mkFixtureDir();
    writeRollout(dir, "rollout-old.jsonl", tokenCountLine(REAL_FREE_RL), 1000);
    writeRollout(dir, "rollout-new.jsonl", tokenCountLine(SYNTH_PLUS_RL), 2000);
    const found = readLatestRateLimits(dir);
    expect(found.rateLimits.plan_type).toBe("plus");
    expect(path.basename(found.sourcePath)).toBe("rollout-new.jsonl");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("최신 파일에 rate_limits 가 없으면 다음 파일로 폴백", () => {
    const dir = mkFixtureDir();
    writeRollout(dir, "rollout-old.jsonl", tokenCountLine(REAL_FREE_RL), 1000);
    writeRollout(
      dir,
      "rollout-new.jsonl",
      '{"type":"event_msg","payload":{"type":"agent_message","message":"started"}}',
      2000,
    );
    const found = readLatestRateLimits(dir);
    expect(found.rateLimits.plan_type).toBe("free");
    expect(path.basename(found.sourcePath)).toBe("rollout-old.jsonl");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("디렉토리가 없으면 null", () => {
    expect(readLatestRateLimits(path.join(os.tmpdir(), "no-such-codex-dir-xyz"))).toBeNull();
  });

  it("fetchUsage: free fixture → ApiUsage(월간 채움, provider=codex)", async () => {
    const dir = mkFixtureDir();
    writeRollout(dir, "rollout-a.jsonl", tokenCountLine(REAL_FREE_RL), 1000);
    const u = await fetchUsage({}, undefined, dir);
    expect(u.provider).toBe("codex");
    expect(u.five_hour_pct).toBe(0);
    expect(u.weekly_pct).toBe(0);
    expect(u.monthly_pct).toBe(80);
    expect(u.tier).toBe("Free");
    expect(typeof u.fetched_at).toBe("string");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fetchUsage: 기록 없으면 안내 에러", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-empty-"));
    await expect(fetchUsage({}, undefined, dir)).rejects.toThrow(/Codex 사용 기록/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
