import { describe, it, expect } from "vitest";
import telemetry from "./telemetry.cjs";

const { shouldPing, buildPingPayload, getOrCreateInstallId, isOptedOut } = telemetry;

// config.json 만 흉내내는 인메모리 store (store.cjs 의 op 시그니처 호환).
function fakeStore(initial = {}) {
  const obj = { ...initial };
  let saves = 0;
  return {
    op(operation, _file, key, val) {
      switch (operation) {
        case "get": return obj[key];
        case "set": obj[key] = val; return null;
        case "save": saves += 1; return null;
        default: return null;
      }
    },
    _obj: obj,
    get _saves() { return saves; },
  };
}

describe("shouldPing", () => {
  it("엔드포인트가 있고 opt-out 이 아닐 때만 true", () => {
    expect(shouldPing({ endpoint: "https://x/ping", optedOut: false })).toBe(true);
    expect(shouldPing({ endpoint: "", optedOut: false })).toBe(false);
    expect(shouldPing({ endpoint: "https://x/ping", optedOut: true })).toBe(false);
  });
});

describe("buildPingPayload", () => {
  it("id/v/os 만 화이트리스트, 누락은 빈 문자열로", () => {
    expect(buildPingPayload({ id: "abc", version: "2.24.1", os: "darwin" }))
      .toEqual({ id: "abc", v: "2.24.1", os: "darwin" });
    expect(buildPingPayload({})).toEqual({ id: "", v: "", os: "" });
  });

  it("예상 밖 필드는 떨어뜨린다(유출 방지)", () => {
    const p = buildPingPayload({ id: "a", version: "1", os: "win32", secret: "leak" });
    expect(p).not.toHaveProperty("secret");
    expect(p).toEqual({ id: "a", v: "1", os: "win32" });
  });
});

describe("getOrCreateInstallId", () => {
  it("첫 호출에 UUID 를 만들어 영속화한다", () => {
    const s = fakeStore();
    const id = getOrCreateInstallId(s);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(s._obj.telemetryInstallId).toBe(id);
    expect(s._saves).toBe(1);
  });

  it("기존 ID 가 있으면 그대로 반환하고 다시 저장하지 않는다", () => {
    const s = fakeStore({ telemetryInstallId: "existing-id-1234" });
    const id = getOrCreateInstallId(s);
    expect(id).toBe("existing-id-1234");
    expect(s._saves).toBe(0);
  });
});

describe("isOptedOut", () => {
  it("config 플래그가 정확히 true 일 때만 opt-out", () => {
    expect(isOptedOut(fakeStore())).toBe(false);
    expect(isOptedOut(fakeStore({ telemetryOptOut: false }))).toBe(false);
    expect(isOptedOut(fakeStore({ telemetryOptOut: true }))).toBe(true);
  });
});
