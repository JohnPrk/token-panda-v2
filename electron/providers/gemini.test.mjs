// Gemini provider 의 pure helper 안전망.
// fetch 자체는 모킹이 무겁고 wire 가 회전하므로 *파싱 / 디코드 / wire 빌드*
// 까지를 단위로 잡고, fetchUsage 의 IO 부분은 스모크(9-B) 에 맡긴다.

import { describe, it, expect } from "vitest";
import gemini from "./gemini.cjs";

const {
  parseWizGlobalData,
  extractAtToken,
  extractBuildLabel,
  extractSessionId,
  decodeUsageResponse,
  epochToIso,
  parseUsageData,
  buildBatchexecuteBody,
  buildBatchexecuteQuery,
  USAGE_RPC_ID,
  TIER_MAP,
} = gemini;

describe("parseWizGlobalData", () => {
  it("표준 인라인 형태에서 객체 추출", () => {
    const html =
      'foo<script>window.WIZ_global_data = {"SNlM0e":"abc","cfb2h":"xyz"};</script>bar';
    const r = parseWizGlobalData(html);
    expect(r).toEqual({ SNlM0e: "abc", cfb2h: "xyz" });
  });

  it("var/let 없이 시작하는 inline 변형도 처리", () => {
    const html = '<script>WIZ_global_data = {"SNlM0e":"abc"};</script>';
    const r = parseWizGlobalData(html);
    expect(r).toEqual({ SNlM0e: "abc" });
  });

  it("WIZ blob 이 없으면 null", () => {
    expect(parseWizGlobalData("<html>no blob</html>")).toBeNull();
  });

  it("빈/널/숫자 입력 → null (방어)", () => {
    expect(parseWizGlobalData("")).toBeNull();
    expect(parseWizGlobalData(null)).toBeNull();
    expect(parseWizGlobalData(undefined)).toBeNull();
    expect(parseWizGlobalData(42)).toBeNull();
  });

  it("JSON 파싱 실패 시 null", () => {
    const html = "window.WIZ_global_data = {bad json};";
    expect(parseWizGlobalData(html)).toBeNull();
  });
});

describe("토큰 추출 헬퍼", () => {
  it("extractAtToken: SNlM0e 키에서 추출", () => {
    expect(extractAtToken({ SNlM0e: "tok" })).toBe("tok");
  });
  it("extractAtToken: 빈 문자열 / 누락 / 비-string → null", () => {
    expect(extractAtToken({ SNlM0e: "" })).toBeNull();
    expect(extractAtToken({})).toBeNull();
    expect(extractAtToken({ SNlM0e: 42 })).toBeNull();
    expect(extractAtToken(null)).toBeNull();
  });
  it("extractBuildLabel: cfb2h 키에서 추출", () => {
    expect(extractBuildLabel({ cfb2h: "boq-..." })).toBe("boq-...");
    expect(extractBuildLabel({})).toBeNull();
  });
  it("extractSessionId: 문자열 / 숫자 둘 다 처리", () => {
    expect(extractSessionId({ FdrFJe: "-206669217912469106" })).toBe("-206669217912469106");
    expect(extractSessionId({ FdrFJe: 12345 })).toBe("12345");
    expect(extractSessionId({})).toBeNull();
  });
});

describe("epochToIso", () => {
  it("[sec, ns] tuple 을 ISO 문자열로", () => {
    // 1779742525 sec = 2026-05-26T05:55:25Z 근사
    const iso = epochToIso([1779742525, 790279000]);
    expect(typeof iso).toBe("string");
    expect(iso).toMatch(/^2026-/);
  });
  it("ns 누락은 0 으로 가정", () => {
    const iso = epochToIso([1779742525]);
    expect(typeof iso).toBe("string");
  });
  it("0/음수/Invalid → null", () => {
    expect(epochToIso([0, 0])).toBeNull();
    expect(epochToIso([-1, 0])).toBeNull();
    expect(epochToIso(null)).toBeNull();
    expect(epochToIso([])).toBeNull();
    expect(epochToIso("not array")).toBeNull();
  });
});

describe("parseUsageData", () => {
  // 실제 jSf9Qc 응답에서 발췌한 inner 배열 (사용자 스크린샷 기준).
  const realInner = [
    2,
    [
      [42859, 0.11418147, 2, [[1779753325, 790538000]]],
      [991, 0.59, 1, [[1779742525, 790279000]]],
    ],
    false,
  ];

  it("실제 응답: tier PRO + 5h 41% + 주간 88.6% (remaining ratio 역산)", () => {
    // 응답 ratio 는 남은 비율 → 소비%로 역산. 0.59→41%, 0.11418147→88.581853%
    const r = parseUsageData(realInner);
    expect(r.tier).toBe("PRO");
    expect(r.five_hour_pct).toBeCloseTo(41, 5);
    expect(r.weekly_pct).toBeCloseTo(88.581853, 5);
    expect(r.five_hour_resets_at).toMatch(/^2026-/);
    expect(r.weekly_resets_at).toMatch(/^2026-/);
  });

  it("kind=1 만 있는 응답 (주간 데이터 없음)", () => {
    // 남은 0.42 → 소비 58%
    const r = parseUsageData([2, [[100, 0.42, 1, [[1779742525, 0]]]], false]);
    expect(r.five_hour_pct).toBeCloseTo(58, 5);
    expect(r.weekly_pct).toBe(0);
    expect(r.weekly_resets_at).toBeNull();
  });

  it("tier 매핑: 2=PRO / 3=ULTRA / 4=PLUS / 6=ULTRA / 미지=null", () => {
    expect(parseUsageData([2, [], false]).tier).toBe("PRO");
    expect(parseUsageData([3, [], false]).tier).toBe("ULTRA");
    expect(parseUsageData([4, [], false]).tier).toBe("PLUS");
    expect(parseUsageData([6, [], false]).tier).toBe("ULTRA");
    expect(parseUsageData([99, [], false]).tier).toBeNull();
  });

  it("entries 가 빈 배열이면 0%", () => {
    const r = parseUsageData([2, [], false]);
    expect(r.five_hour_pct).toBe(0);
    expect(r.weekly_pct).toBe(0);
  });

  it("형식 불일치 시 throw", () => {
    expect(() => parseUsageData(null)).toThrow();
    expect(() => parseUsageData([])).toThrow();
    expect(() => parseUsageData([2])).toThrow();
  });

  it("ratio 0 (남은 0) 이면 사용률 100% 로 역산", () => {
    const r = parseUsageData([2, [[0, 0, 1, [[1779742525, 0]]]], false]);
    expect(r.five_hour_pct).toBe(100);
  });
});

describe("decodeUsageResponse", () => {
  // 실제 사용자 스크린샷에서 본 응답 형태를 재현.
  const realResp =
    `)]}'\n\n` +
    `200\n` +
    `[["wrb.fr","jSf9Qc","[2,[[42859,0.11418147,2,[[1779753325,790538000]]],[991,0.59,1,[[1779742525,790279000]]]],false]",null,null,null,"generic"]]\n` +
    `25\n` +
    `[["e",4,null,null,236]]\n`;

  it("실제 응답 형태에서 inner array 디코드", () => {
    const r = decodeUsageResponse(realResp, "jSf9Qc");
    expect(Array.isArray(r)).toBe(true);
    expect(r[0]).toBe(2);
    expect(Array.isArray(r[1])).toBe(true);
  });

  it("매칭 RPC id 가 없으면 throw", () => {
    expect(() => decodeUsageResponse(realResp, "missing")).toThrow(/RPC id/);
  });

  it("빈 응답이면 throw", () => {
    expect(() => decodeUsageResponse("", "jSf9Qc")).toThrow();
    expect(() => decodeUsageResponse(null, "jSf9Qc")).toThrow();
  });

  it("prefix `)]}'` 없는 응답도 처리", () => {
    const noPrefix =
      `200\n` +
      `[["wrb.fr","jSf9Qc","[2,[],false]",null,null,null,"generic"]]\n`;
    const r = decodeUsageResponse(noPrefix, "jSf9Qc");
    expect(r[0]).toBe(2);
  });
});

describe("buildBatchexecuteBody", () => {
  it("URL-encoded f.req + at", () => {
    const body = buildBatchexecuteBody("jSf9Qc", "tok");
    const params = new URLSearchParams(body);
    expect(params.get("at")).toBe("tok");
    const fReq = params.get("f.req");
    expect(fReq).toBeTruthy();
    // outer JSON.parse → [[["jSf9Qc","[]",null,"generic"]]]
    const outer = JSON.parse(fReq);
    expect(outer[0][0][0]).toBe("jSf9Qc");
    expect(outer[0][0][1]).toBe("[]");
    expect(outer[0][0][3]).toBe("generic");
  });

  it("at 토큰 없어도 f.req 는 채워진다", () => {
    const body = buildBatchexecuteBody("jSf9Qc", null);
    const params = new URLSearchParams(body);
    expect(params.has("at")).toBe(false);
    expect(params.get("f.req")).toContain("jSf9Qc");
  });
});

describe("buildBatchexecuteQuery", () => {
  it("필요한 쿼리 키를 모두 박는다", () => {
    const q = buildBatchexecuteQuery({
      rpcId: "jSf9Qc",
      buildLabel: "boq-...",
      sessionId: "sid",
      reqId: 12345,
      hl: "ko",
    });
    const sp = new URLSearchParams(q);
    expect(sp.get("rpcids")).toBe("jSf9Qc");
    expect(sp.get("source-path")).toBe("/app");
    expect(sp.get("bl")).toBe("boq-...");
    expect(sp.get("f.sid")).toBe("sid");
    expect(sp.get("hl")).toBe("ko");
    expect(sp.get("_reqid")).toBe("12345");
    expect(sp.get("rt")).toBe("c");
  });

  it("buildLabel / sessionId 누락은 그 키 자체를 빠뜨림", () => {
    const q = buildBatchexecuteQuery({ rpcId: "jSf9Qc", reqId: 1 });
    const sp = new URLSearchParams(q);
    expect(sp.has("bl")).toBe(false);
    expect(sp.has("f.sid")).toBe(false);
    expect(sp.get("hl")).toBe("ko"); // 기본값
  });
});

describe("provider contract", () => {
  it("USAGE_RPC_ID 는 jSf9Qc (frozen)", () => {
    expect(USAGE_RPC_ID).toBe("jSf9Qc");
  });

  it("TIER_MAP 의 4 키만 존재 (PRO/PLUS/ULTRA*2)", () => {
    expect(TIER_MAP).toEqual({ 2: "PRO", 3: "ULTRA", 4: "PLUS", 6: "ULTRA" });
    expect(Object.isFrozen(TIER_MAP)).toBe(true);
  });

  it("fetchUsage 에 빈 credentials 주면 즉시 throw (네트워크 호출 전)", async () => {
    await expect(gemini.fetchUsage({})).rejects.toThrow(/cookie/);
    await expect(gemini.fetchUsage(null)).rejects.toThrow(/cookie/);
  });
});
