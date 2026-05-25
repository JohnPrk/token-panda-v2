// providers registry 의 contract 안전망.
// 새 provider 추가 시 capability 누락이나 인터페이스 메서드 누락을 빌드 시점에
// 잡기 위한 게이트. 동작 자체보다 *모양* 을 검증.

import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  DEFAULT_PROVIDER_ID,
  listProviders,
  listProviderIds,
  getProvider,
  resolveProvider,
} from "./index.cjs";

describe("providers registry", () => {
  it("Claude 와 Gemini 가 모두 등록되어 있다", () => {
    expect(getProvider("claude")).toBeTruthy();
    expect(getProvider("gemini")).toBeTruthy();
  });

  it("listProviderIds 가 claude, gemini 를 포함한다", () => {
    const ids = listProviderIds();
    expect(ids).toContain("claude");
    expect(ids).toContain("gemini");
  });

  it("listProviders 가 객체 형태로 모두 돌려준다", () => {
    const arr = listProviders();
    expect(arr.length).toBeGreaterThanOrEqual(2);
    for (const p of arr) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.displayName).toBe("string");
      expect(typeof p.fetchUsage).toBe("function");
      expect(p.capabilities).toBeTruthy();
      expect(typeof p.capabilities.prepaid).toBe("boolean");
      expect(typeof p.capabilities.autoExtract).toBe("boolean");
      expect(typeof p.capabilities.tier).toBe("boolean");
    }
  });

  it("getProvider 가 알 수 없는 id 에 null 을 돌려준다", () => {
    expect(getProvider("nonexistent")).toBeNull();
    expect(getProvider("")).toBeNull();
    expect(getProvider(undefined)).toBeNull();
  });

  it("resolveProvider 는 알 수 없는 id 도 default(claude) 로 폴백한다", () => {
    expect(resolveProvider("nonexistent").id).toBe("claude");
    expect(resolveProvider(undefined).id).toBe("claude");
    expect(resolveProvider("").id).toBe("claude");
  });

  it("DEFAULT_PROVIDER_ID 는 claude (legacy 호환)", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("claude");
  });

  it("PROVIDERS 는 freeze 되어 외부에서 변형 불가", () => {
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
  });

  it("Claude provider capability: prepaid=true, autoExtract=true, tier=false", () => {
    const c = getProvider("claude");
    expect(c.capabilities.prepaid).toBe(true);
    expect(c.capabilities.autoExtract).toBe(true);
    expect(c.capabilities.tier).toBe(false);
  });

  it("Gemini provider capability: prepaid=false, autoExtract=false, tier=true", () => {
    const g = getProvider("gemini");
    expect(g.capabilities.prepaid).toBe(false);
    expect(g.capabilities.autoExtract).toBe(false);
    expect(g.capabilities.tier).toBe(true);
  });

  it("capability=true 면 그 메서드가 함수로 존재한다 (역도 성립)", () => {
    for (const p of listProviders()) {
      if (p.capabilities.prepaid) expect(typeof p.fetchPrepaid).toBe("function");
      else expect(p.fetchPrepaid).toBeUndefined();
      if (p.capabilities.autoExtract) expect(typeof p.autoExtract).toBe("function");
      else expect(p.autoExtract).toBeUndefined();
    }
  });
});
