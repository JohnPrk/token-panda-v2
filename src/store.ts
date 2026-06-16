import { Store } from "@tauri-apps/plugin-store";
import type { Account, AccountsConfig, ApiConfig, PlanConfig } from "./types";

const STORE_FILE = "config.json";
const KEY_PLAN = "plan_config";
const KEY_API = "api_config";          // legacy single-account credential blob
const KEY_ACCOUNTS = "accounts_config";
// 익명 사용 통계 opt-out 플래그. electron/telemetry.cjs 가 같은 config.json 의
// 같은 평면 키(OPT_OUT_KEY)를 읽으므로 이 문자열은 양쪽이 일치해야 한다.
const KEY_TELEMETRY_OPT_OUT = "telemetryOptOut";
// 계정 전환(펫 더블클릭) 안내 말풍선을 한 번 닫았는지. true 면 다시 안 띄운다.
const KEY_SWITCH_HINT_DISMISSED = "accountSwitchHintDismissed";

let storePromise: Promise<Store> | null = null;
function getStore() {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

export async function loadPlanConfig(): Promise<PlanConfig | null> {
  const store = await getStore();
  const v = await store.get<PlanConfig>(KEY_PLAN);
  return v ?? null;
}

export async function savePlanConfig(cfg: PlanConfig): Promise<void> {
  const store = await getStore();
  await store.set(KEY_PLAN, cfg);
  await store.save();
}

// 익명 사용 통계 opt-out 읽기/쓰기. 기본값은 opt-in(false = 수집 켜짐) — 백엔드와
// 동일하게 명시적으로 true 일 때만 꺼진 것으로 본다. 메인 프로세스가 단일 store
// 인스턴스를 들고 있어, 여기서 저장하면 다음 핑 주기에 telemetry.cjs 가 곧장 반영.
export async function loadTelemetryOptOut(): Promise<boolean> {
  const store = await getStore();
  const v = await store.get<boolean>(KEY_TELEMETRY_OPT_OUT);
  return v === true;
}

export async function saveTelemetryOptOut(optOut: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_TELEMETRY_OPT_OUT, optOut);
  await store.save();
}

// 계정 전환 안내 말풍선을 닫은 적 있는지(처음 시작 시 1회만 노출하기 위함).
export async function loadSwitchHintDismissed(): Promise<boolean> {
  const store = await getStore();
  const v = await store.get<boolean>(KEY_SWITCH_HINT_DISMISSED);
  return v === true;
}

export async function saveSwitchHintDismissed(dismissed: boolean): Promise<void> {
  const store = await getStore();
  await store.set(KEY_SWITCH_HINT_DISMISSED, dismissed);
  await store.save();
}

// 계정 묶음 로드. accounts_config가 있으면 그대로, 없고 legacy KEY_API가
// 있으면 단일 계정으로 1회 변환해서 저장하고 반환. 둘 다 없으면 빈 묶음.
export async function loadAccountsConfig(): Promise<AccountsConfig> {
  const store = await getStore();
  const existing = await store.get<AccountsConfig>(KEY_ACCOUNTS);
  const oldApi = await store.get<ApiConfig>(KEY_API);
  const oldPlan = await store.get<PlanConfig>(KEY_PLAN);
  const { config, needsWrite } = buildAccountsConfigFromLegacy(
    existing ?? null,
    oldApi ?? null,
    oldPlan ?? null,
    cryptoRandomId,
  );
  if (needsWrite) {
    await store.set(KEY_ACCOUNTS, config);
    await store.save();
  }
  return config;
}

// Tauri Store에서 읽어온 세 값을 받아 어떤 AccountsConfig가 결과인지 + 새로
// 디스크에 써야 하는지 결정하는 pure 함수. `loadAccountsConfig`의 IO 본체와
// 분리해 cryptoRandomId만 의존성으로 주입한다. cargo test 대신 vitest로 검증.
//
// 2026-05-26 provider 추가 메모: 새 ClaudeAccount.provider 는 *optional*
// 이라 legacy 계정(`provider` 필드 없음) 도 그대로 ClaudeAccount union 으로
// 매칭된다. 따라서 read-time 마이그레이션이 필요 없고, 기존 frozen 케이스
// (provider 필드 없는 fixture) 들도 모양 변경 없이 그대로 통과한다.
export function buildAccountsConfigFromLegacy(
  existing: AccountsConfig | null,
  oldApi: ApiConfig | null,
  oldPlan: PlanConfig | null,
  idGen: () => string,
): { config: AccountsConfig; needsWrite: boolean } {
  if (existing && Array.isArray(existing.accounts)) {
    return { config: existing, needsWrite: false };
  }
  if (oldApi && oldApi.orgId && oldApi.cookie) {
    const acc: Account = {
      id: idGen(),
      label: "메인 계정",
      orgId: oldApi.orgId,
      cookie: oldApi.cookie,
      skinId: oldPlan?.skin ?? "panda",
    };
    return {
      config: { accounts: [acc], activeAccountId: acc.id },
      needsWrite: true,
    };
  }
  return {
    config: { accounts: [], activeAccountId: null },
    needsWrite: false,
  };
}

export async function saveAccountsConfig(cfg: AccountsConfig): Promise<void> {
  const store = await getStore();
  await store.set(KEY_ACCOUNTS, cfg);
  await store.save();
}

// Legacy. 활성 계정의 자격증명을 ApiConfig 모양으로 돌려준다 — claude
// 계정에만 의미가 있다. gemini 계정이 활성이면 null 반환 (호출처가 이걸
// 보고 옛 claude-only 경로를 건너뛰게). provider 필드가 없는 legacy 저장본은
// 자동으로 claude 로 본다.
export async function loadApiConfig(): Promise<ApiConfig | null> {
  const cfg = await loadAccountsConfig();
  const active = cfg.accounts.find((a) => a.id === cfg.activeAccountId);
  if (!active) return null;
  // claude 전용 모양 — claude 가 아닌 provider(gemini/codex)는 자격증명 모양이
  // 달라(또는 없어) null 을 돌려 옛 claude-only 경로를 건너뛰게 한다.
  if (active.provider === "gemini" || active.provider === "codex") return null;
  return { orgId: active.orgId, cookie: active.cookie };
}

// Legacy write. 새 멀티 계정 UI는 saveAccountsConfig만 쓴다.
export async function saveApiConfig(cfg: ApiConfig | null): Promise<void> {
  const store = await getStore();
  if (cfg) {
    await store.set(KEY_API, cfg);
  } else {
    await store.delete(KEY_API);
  }
  await store.save();
}

export function cryptoRandomId(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 펫 본체 더블클릭 계정 순환용 — 현재 활성 id 의 *다음* 계정 id 를 돌려준다.
 *  목록 끝이면 처음으로 wrap. 계정이 1개 이하면 전환이 무의미하므로 null(=no-op).
 *  활성 id 가 목록에 없으면(삭제 등) 첫 계정으로. 순수 함수라 vitest 로 경계를 굳힌다. */
export function nextActiveAccountId(
  ids: string[],
  currentId: string | null,
): string | null {
  if (ids.length < 2) return null;
  const idx = ids.indexOf(currentId ?? "");
  const nextIdx = idx < 0 ? 0 : (idx + 1) % ids.length;
  return ids[nextIdx];
}

// 펫 NSPanel 에선 onClick/dblclick DOM 이벤트가 안 잡혀(드래그·리사이즈가 전부
// pointer 이벤트), 더블클릭을 pointerup 두 번의 간격으로 직접 판정한다.
// prevTapMs=0(첫 탭)이거나 간격이 thresholdMs 이상이면 false. 순수 함수라 테스트.
export const DOUBLE_TAP_MS = 400;

export function isDoubleTap(
  prevTapMs: number,
  nowMs: number,
  thresholdMs: number = DOUBLE_TAP_MS,
): boolean {
  if (prevTapMs <= 0) return false;
  const dt = nowMs - prevTapMs;
  return dt >= 0 && dt < thresholdMs;
}
