// Provider 레지스트리. 새 LLM 서비스(GPT 등) 를 붙일 땐 같은 인터페이스의
// providers/<id>.cjs 한 파일만 추가하고 여기 register 한 줄 더하면 끝.
//
// 모든 provider 가 따르는 인터페이스:
//   id              : "claude" | "gemini" | …
//   displayName     : 사용자에게 보이는 이름
//   capabilities    : { prepaid: bool, autoExtract: bool, tier: bool }
//   fetchUsage(c)   : (c) => ApiUsage  필수
//   fetchPrepaid?(c): (c) => dollars   capabilities.prepaid=true 일 때
//   autoExtract?(r) : (rawCookie) => { credentials, label? }  capabilities.autoExtract=true 일 때
//
// ApiUsage (공통 shape):
//   { provider, five_hour_pct, weekly_pct, five_hour_resets_at, weekly_resets_at,
//     fetched_at, tier? }
//
// credentials 모양은 provider 별로 다름:
//   claude : { orgId, cookie, platformOrgId?, platformCookie? }
//   gemini : { cookie }
//
// 호출처(main.cjs / App.tsx 설정 UI) 는 항상 getProvider(id) 로 받아서
// capabilities 만 보고 분기. provider 별 if-else 분기는 두지 않는다.

const claudeProvider = require("./claude.cjs");
const geminiProvider = require("./gemini.cjs");
const codexProvider = require("./codex.cjs");

const PROVIDERS = Object.freeze({
  claude: claudeProvider,
  gemini: geminiProvider,
  codex: codexProvider,
});

const DEFAULT_PROVIDER_ID = "claude";

function listProviders() {
  return Object.values(PROVIDERS);
}

function listProviderIds() {
  return Object.keys(PROVIDERS);
}

function getProvider(id) {
  return PROVIDERS[id] || null;
}

// 모르는 id 가 들어오면 default(claude) 로 폴백. legacy store 의 `provider`
// 필드 없는 계정도 이 한 줄로 흡수된다.
function resolveProvider(id) {
  return getProvider(id) || PROVIDERS[DEFAULT_PROVIDER_ID];
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER_ID,
  listProviders,
  listProviderIds,
  getProvider,
  resolveProvider,
};
