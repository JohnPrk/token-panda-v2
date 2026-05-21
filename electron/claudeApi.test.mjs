// ============================================================================
// 🔒 FROZEN CONTRACT — DO NOT MODIFY FOR NEW FEATURES
// ----------------------------------------------------------------------------
// 이 파일의 케이스들은 v1.74.8 시점의 동작을 묶어둔 회귀 안전망이다. 새 기능을
// 추가하다 깨지면 *기능을 고쳐서* 통과시켜야지, 테스트를 손봐선 안 된다.
// 정당하게 기존 동작을 바꿔야 할 때만 PROGRESS.md 의 "테스트 정책" 항목 절차를
// 따라 명시적으로 업데이트한다. 새 분기/필드가 추가됐을 때 *추가* 케이스를
// 덧붙이는 건 자유.
// ============================================================================

import { describe, it, expect } from "vitest";
import claudeApi from "./claudeApi.cjs";
const { sanitizeCookie, parsePrepaidCredits, coerceDollars } = claudeApi;

describe("sanitizeCookie", () => {
  it("passes plain cookie through unchanged (only whitespace collapse)", () => {
    expect(sanitizeCookie("sessionKey=abc; foo=bar")).toBe("sessionKey=abc; foo=bar");
  });

  it("collapses newlines / multiple spaces to a single space (HTTP header safety)", () => {
    expect(sanitizeCookie("a=1;\n  b=2;   c=3")).toBe("a=1; b=2; c=3");
  });

  it("flattens Slack/Notion markdown autolink [text](url) to text", () => {
    const raw = "sessionKey=[abc123](https://example.com/x); foo=bar";
    expect(sanitizeCookie(raw)).toBe("sessionKey=abc123; foo=bar");
  });

  it("strips bracket-only wrapping when no following parenthesis", () => {
    expect(sanitizeCookie("sessionKey=[xyz]; b=2")).toBe("sessionKey=xyz; b=2");
  });
});

describe("coerceDollars (v1.74 cents 휴리스틱)", () => {
  it("treats integer values as cents (divide by 100)", () => {
    expect(coerceDollars(963)).toBeCloseTo(9.63, 2);
    expect(coerceDollars(1234)).toBeCloseTo(12.34, 2);
    expect(coerceDollars(100)).toBeCloseTo(1.0, 2);
    expect(coerceDollars(0)).toBeCloseTo(0.0, 2);
  });

  it("treats fractional values as dollars (unchanged)", () => {
    expect(coerceDollars(12.34)).toBeCloseTo(12.34, 2);
    expect(coerceDollars(0.5)).toBeCloseTo(0.5, 2);
    expect(coerceDollars(9.63)).toBeCloseTo(9.63, 2);
  });
});

describe("parsePrepaidCredits", () => {
  it("picks first direct dollar key (balance)", () => {
    expect(parsePrepaidCredits({ balance: 12.34 })).toBeCloseTo(12.34, 2);
  });

  it("picks explicit *_cents key with /100 conversion", () => {
    expect(parsePrepaidCredits({ balance_cents: 1234 })).toBeCloseTo(12.34, 2);
  });

  it("sums credits[] array", () => {
    const r = { credits: [{ amount: 500 }, { amount: 480 }] };
    // 500 cents → $5.00, 480 cents → $4.80, sum $9.80
    expect(parsePrepaidCredits(r)).toBeCloseTo(9.8, 2);
  });

  it("recurses into nested data wrapper", () => {
    expect(parsePrepaidCredits({ data: { balance: 9.99 } })).toBeCloseTo(9.99, 2);
  });

  it("recurses into prepaid wrapper", () => {
    expect(parsePrepaidCredits({ prepaid: { amount: 1290 } })).toBeCloseTo(12.9, 2);
  });

  it("returns null when no matching field found", () => {
    expect(parsePrepaidCredits({ foo: 1, bar: 2 })).toBeNull();
  });

  it("returns null for empty credits[] array", () => {
    expect(parsePrepaidCredits({ credits: [] })).toBeNull();
  });

  it("skips negative amounts (auto_reload sentinel guard)", () => {
    expect(parsePrepaidCredits({ amount: -1 })).toBeNull();
  });

  it("falls through to next positive when first candidate is negative", () => {
    expect(parsePrepaidCredits({ amount: -1, balance_cents: 1290 })).toBeCloseTo(12.9, 2);
  });

  it("returns 0 when balance is genuinely zero", () => {
    expect(parsePrepaidCredits({ balance_cents: 0 })).toBe(0);
  });

  it("returns null for null/undefined root", () => {
    expect(parsePrepaidCredits(null)).toBeNull();
    expect(parsePrepaidCredits(undefined)).toBeNull();
  });

  it("rounds to 2 decimal places", () => {
    expect(parsePrepaidCredits({ balance: 12.345 })).toBeCloseTo(12.35, 2);
  });
});
