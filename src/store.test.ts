import { describe, it, expect } from "vitest";
import { buildAccountsConfigFromLegacy } from "./store";
import type { AccountsConfig, ApiConfig, PlanConfig } from "./types";

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
});
