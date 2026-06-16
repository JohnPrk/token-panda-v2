import { describe, it, expect } from "vitest";
import {
  buildAccountsConfigFromLegacy,
  cryptoRandomId,
  isDoubleTap,
  nextActiveAccountId,
} from "./store";
import type { AccountsConfig, ApiConfig, GeminiAccount, PlanConfig } from "./types";
import { accountProvider } from "./types";

const fixedId = () => "id-fixed-1";

describe("buildAccountsConfigFromLegacy", () => {
  it("이미 accounts_config가 있으면 그대로 반환 + needsWrite=false", () => {
    const existing: AccountsConfig = {
      accounts: [
        { id: "a1", label: "A", orgId: "o", cookie: "c", skinId: "panda" },
      ],
      activeAccountId: "a1",
    };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      existing,
      null,
      null,
      fixedId,
    );
    expect(config).toBe(existing);
    expect(needsWrite).toBe(false);
  });

  it("existing 없고 legacy ApiConfig만 있으면 단일 계정으로 변환 + needsWrite=true", () => {
    const oldApi: ApiConfig = { orgId: "org-X", cookie: "cookie-Y" };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      null,
      oldApi,
      null,
      fixedId,
    );
    expect(needsWrite).toBe(true);
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0]).toEqual({
      id: "id-fixed-1",
      label: "메인 계정",
      orgId: "org-X",
      cookie: "cookie-Y",
      skinId: "panda",
    });
    expect(config.activeAccountId).toBe("id-fixed-1");
  });

  it("legacy ApiConfig + PlanConfig.skin 있으면 그 skin이 첫 계정에 적용", () => {
    const oldApi: ApiConfig = { orgId: "o", cookie: "c" };
    const oldPlan: PlanConfig = {
      plan: "pro",
      limits: { fiveHour: 1, weekly: 7 },
      skin: "cat",
    };
    const { config } = buildAccountsConfigFromLegacy(
      null,
      oldApi,
      oldPlan,
      fixedId,
    );
    expect(config.accounts[0].skinId).toBe("cat");
  });

  it("oldApi.orgId 또는 cookie가 비어 있으면 변환 안 함 (빈 묶음 반환)", () => {
    const partial: ApiConfig = { orgId: "", cookie: "c" };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      null,
      partial,
      null,
      fixedId,
    );
    expect(needsWrite).toBe(false);
    expect(config).toEqual({ accounts: [], activeAccountId: null });
  });

  it("아무 데이터도 없으면 빈 묶음 + needsWrite=false (첫 실행 케이스)", () => {
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      null,
      null,
      null,
      fixedId,
    );
    expect(needsWrite).toBe(false);
    expect(config).toEqual({ accounts: [], activeAccountId: null });
  });

  it("existing.accounts가 배열이 아니면 (corrupt) legacy 경로로 fallthrough", () => {
    // Tauri store에 손상된 값이 들어 있을 때. legacy 경로로 빠진 다음 oldApi
    // 있으면 변환, 없으면 빈 묶음.
    const corrupt = { accounts: "not an array" } as unknown as AccountsConfig;
    const oldApi: ApiConfig = { orgId: "o", cookie: "c" };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      corrupt,
      oldApi,
      null,
      fixedId,
    );
    expect(needsWrite).toBe(true);
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0].orgId).toBe("o");
  });

  // ===== 추가 회귀 케이스 (v1.51 테스트 커버리지 보강) =====

  it("existing.accounts 가 빈 배열이어도 그대로 반환 (계정 0개 상태 보존)", () => {
    // 사용자가 모든 계정을 삭제한 상태. 빈 배열을 legacy 로 떠넘기지 말아야 함.
    const existing: AccountsConfig = { accounts: [], activeAccountId: null };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      existing,
      { orgId: "o", cookie: "c" }, // legacy 가 있어도 existing 우선
      null,
      fixedId,
    );
    expect(config).toBe(existing);
    expect(needsWrite).toBe(false);
  });

  it("existing.accounts 가 1+ 인데 activeAccountId 가 null 이어도 보존", () => {
    // legacy 자동 변환 직후 activeAccountId 가 비어 있는 transient 상태도 있을 수 있음.
    // 그래도 existing.accounts 가 배열이면 그대로 반환.
    const existing: AccountsConfig = {
      accounts: [
        { id: "a1", label: "A", orgId: "o", cookie: "c", skinId: "panda" },
      ],
      activeAccountId: null,
    };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      existing,
      null,
      null,
      fixedId,
    );
    expect(config).toBe(existing);
    expect(needsWrite).toBe(false);
  });

  it("oldApi.cookie 만 비어 있어도 변환 안 함", () => {
    const partial: ApiConfig = { orgId: "o", cookie: "" };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      null,
      partial,
      null,
      fixedId,
    );
    expect(needsWrite).toBe(false);
    expect(config.accounts).toEqual([]);
  });

  it("oldPlan 만 있고 oldApi 없으면 변환 안 함 (자격증명 없으면 의미 없음)", () => {
    const oldPlan: PlanConfig = {
      plan: "pro",
      limits: { fiveHour: 1, weekly: 7 },
      skin: "cat",
    };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      null,
      null,
      oldPlan,
      fixedId,
    );
    expect(needsWrite).toBe(false);
    expect(config.accounts).toEqual([]);
    expect(config.activeAccountId).toBeNull();
  });

  it("oldPlan.skin 이 없으면 첫 계정 skinId 는 'panda' 기본값", () => {
    const oldApi: ApiConfig = { orgId: "o", cookie: "c" };
    const oldPlan: PlanConfig = {
      plan: "pro",
      limits: { fiveHour: 1, weekly: 7 },
      // skin 필드 누락
    } as PlanConfig;
    const { config } = buildAccountsConfigFromLegacy(
      null,
      oldApi,
      oldPlan,
      fixedId,
    );
    expect(config.accounts[0].skinId).toBe("panda");
  });

  it("activeAccountId 는 첫 계정 id 와 일치 (idGen 한 번만 호출)", () => {
    let count = 0;
    const counter = () => {
      count += 1;
      return `id-${count}`;
    };
    const oldApi: ApiConfig = { orgId: "o", cookie: "c" };
    const { config } = buildAccountsConfigFromLegacy(null, oldApi, null, counter);
    expect(count).toBe(1);
    expect(config.activeAccountId).toBe("id-1");
    expect(config.accounts[0].id).toBe("id-1");
  });
});

// ===== Gemini provider 도입 후 추가 회귀 (v2.18, 2026-05-26) =====
// 기존 케이스(provider 필드 없음)는 9-E 룰에 따라 손대지 않고, 새 회귀만 추가.

describe("buildAccountsConfigFromLegacy — provider 도입 후 안전망", () => {
  it("기존 legacy account(provider undefined) 가 union 의 claude 쪽으로 매칭된다", () => {
    const existing: AccountsConfig = {
      accounts: [
        { id: "a1", label: "A", orgId: "o", cookie: "c", skinId: "panda" },
      ],
      activeAccountId: "a1",
    };
    const { config } = buildAccountsConfigFromLegacy(existing, null, null, fixedId);
    // accountProvider 가 legacy 를 "claude" 로 정규화하는지
    expect(accountProvider(config.accounts[0])).toBe("claude");
  });

  it("Gemini 계정과 Claude 계정이 섞여 있어도 needsWrite=false 로 그대로 보존", () => {
    const gem: GeminiAccount = {
      id: "g1",
      label: "Gemini PRO",
      provider: "gemini",
      cookie: "SID=...; SAPISID=...",
      skinId: "panda",
    };
    const existing: AccountsConfig = {
      accounts: [
        { id: "a1", label: "Claude", orgId: "o", cookie: "c", skinId: "cat" },
        gem,
      ],
      activeAccountId: "g1",
    };
    const { config, needsWrite } = buildAccountsConfigFromLegacy(
      existing,
      null,
      null,
      fixedId,
    );
    expect(needsWrite).toBe(false);
    expect(config.accounts).toHaveLength(2);
    expect(accountProvider(config.accounts[0])).toBe("claude");
    expect(accountProvider(config.accounts[1])).toBe("gemini");
  });

  it("legacy oldApi 마이그레이션 결과는 union 의 claude 쪽으로 식별된다", () => {
    const oldApi: ApiConfig = { orgId: "o", cookie: "c" };
    const { config } = buildAccountsConfigFromLegacy(null, oldApi, null, fixedId);
    expect(accountProvider(config.accounts[0])).toBe("claude");
  });
});

describe("accountProvider 정규화 helper", () => {
  it("provider undefined → claude", () => {
    expect(
      accountProvider({
        id: "a1",
        label: "A",
        orgId: "o",
        cookie: "c",
        skinId: "panda",
      }),
    ).toBe("claude");
  });

  it('provider "claude" → claude', () => {
    expect(
      accountProvider({
        id: "a1",
        label: "A",
        provider: "claude",
        orgId: "o",
        cookie: "c",
        skinId: "panda",
      }),
    ).toBe("claude");
  });

  it('provider "gemini" → gemini', () => {
    expect(
      accountProvider({
        id: "g1",
        label: "G",
        provider: "gemini",
        cookie: "SID=...",
        skinId: "panda",
      }),
    ).toBe("gemini");
  });
});

describe("cryptoRandomId", () => {
  it("반환된 id 는 비어 있지 않은 문자열", () => {
    const id = cryptoRandomId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("연달아 호출해도 거의 항상 다른 id (충돌 확률 극히 낮음)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      ids.add(cryptoRandomId());
    }
    // 50개 모두 distinct 여야 함. (Math.random 폴백이라도 충분히 안전)
    expect(ids.size).toBe(50);
  });
});

describe("nextActiveAccountId — 펫 더블클릭 계정 순환", () => {
  it("다음 계정으로 이동", () => {
    expect(nextActiveAccountId(["a", "b", "c"], "a")).toBe("b");
    expect(nextActiveAccountId(["a", "b", "c"], "b")).toBe("c");
  });

  it("마지막 계정이면 처음으로 wrap", () => {
    expect(nextActiveAccountId(["a", "b", "c"], "c")).toBe("a");
  });

  it("계정 2개면 둘 사이를 토글", () => {
    expect(nextActiveAccountId(["a", "b"], "a")).toBe("b");
    expect(nextActiveAccountId(["a", "b"], "b")).toBe("a");
  });

  it("계정 1개 이하면 null (전환 무의미 = no-op)", () => {
    expect(nextActiveAccountId(["a"], "a")).toBeNull();
    expect(nextActiveAccountId([], null)).toBeNull();
  });

  it("활성 id 가 목록에 없으면(삭제 등) 첫 계정", () => {
    expect(nextActiveAccountId(["a", "b", "c"], "zzz")).toBe("a");
    expect(nextActiveAccountId(["a", "b"], null)).toBe("a");
  });
});

describe("isDoubleTap — 펫 pointer 기반 더블탭 판정", () => {
  it("threshold 안의 두 번째 탭은 true", () => {
    expect(isDoubleTap(1000, 1200)).toBe(true); // 200ms
    expect(isDoubleTap(1000, 1399)).toBe(true); // 399ms < 400
  });

  it("threshold 이상이면 false (느린 두 번째 탭)", () => {
    expect(isDoubleTap(1000, 1400)).toBe(false); // 정확히 400
    expect(isDoubleTap(1000, 2000)).toBe(false);
  });

  it("첫 탭(prev=0)은 항상 false", () => {
    expect(isDoubleTap(0, 1200)).toBe(false);
  });

  it("음수 간격(시계 역행)은 false", () => {
    expect(isDoubleTap(2000, 1000)).toBe(false);
  });

  it("커스텀 threshold 적용", () => {
    expect(isDoubleTap(1000, 1250, 200)).toBe(false);
    expect(isDoubleTap(1000, 1150, 200)).toBe(true);
  });
});
