// Claude provider — 기존 claudeApi.cjs 를 provider 인터페이스로 감싼 얇은
// 어댑터. claudeApi.cjs 자체는 frozen(테스트도 frozen) 이라 손대지 않고
// 호출 시그니처만 정렬해 준다.
//
// credentials 모양:
//   { orgId, cookie, platformOrgId?, platformCookie? }

const claudeApi = require("../claudeApi.cjs");

const id = "claude";
const displayName = "Claude";
const capabilities = Object.freeze({
  prepaid: true,
  autoExtract: true,
  tier: false,
});

async function fetchUsage(credentials) {
  const c = credentials || {};
  if (!c.orgId || !c.cookie) {
    throw new Error("Claude provider 자격증명에 orgId / cookie 가 비어 있습니다.");
  }
  const u = await claudeApi.fetchUsage(c.orgId, c.cookie);
  return { ...u, provider: id };
}

async function fetchPrepaid(credentials) {
  const c = credentials || {};
  const orgId = c.platformOrgId || c.orgId;
  const cookie = c.platformCookie || c.cookie;
  if (!orgId || !cookie) {
    throw new Error("Claude provider prepaid 자격증명이 비어 있습니다.");
  }
  return claudeApi.fetchPrepaid(orgId, cookie);
}

async function autoExtract(rawCookie) {
  const r = await claudeApi.autoExtract(rawCookie);
  // claudeApi 는 { org_id, cookie } 모양으로 돌려준다 (snake_case 는 frontend
  // 와의 IPC 계약). provider 인터페이스 쪽은 credentials 묶음으로 정규화해서
  // 넘긴다.
  return {
    credentials: { orgId: r.org_id, cookie: r.cookie },
    legacy: r, // 기존 IPC 호출처가 그대로 r.org_id / r.cookie 읽을 수 있게 보존
  };
}

module.exports = {
  id,
  displayName,
  capabilities,
  fetchUsage,
  fetchPrepaid,
  autoExtract,
};
