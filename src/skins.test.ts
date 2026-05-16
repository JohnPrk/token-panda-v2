import { describe, it, expect } from "vitest";
import { DEFAULT_SKIN_ID, findSkin, SKINS } from "./skins";

describe("findSkin", () => {
  it("기본 스킨 id로 찾으면 같은 스킨 반환", () => {
    const s = findSkin(DEFAULT_SKIN_ID);
    expect(s.id).toBe(DEFAULT_SKIN_ID);
  });

  it("등록되지 않은 id는 첫 번째 스킨으로 fallback", () => {
    const s = findSkin("not-a-real-skin-xxx");
    expect(s.id).toBe(SKINS[0].id);
  });

  it("모든 SKINS 항목이 9개 PetState 프레임을 갖고 있다", () => {
    const states = [
      "full",
      "high",
      "good",
      "mid",
      "low",
      "tired",
      "sleepy",
      "dead",
      "disconnected",
    ] as const;
    for (const skin of SKINS) {
      for (const st of states) {
        expect(skin.frames[st]).toBeTruthy();
      }
    }
  });
});
