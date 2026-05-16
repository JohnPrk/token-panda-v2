import { Store } from "@tauri-apps/plugin-store";
import type { Account, AccountsConfig, ApiConfig, PlanConfig } from "./types";

const STORE_FILE = "config.json";
const KEY_PLAN = "plan_config";
const KEY_API = "api_config";          // legacy single-account credential blob
const KEY_ACCOUNTS = "accounts_config";

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

// Legacy. 활성 계정의 자격증명을 ApiConfig 모양으로 돌려준다.
// 호출처가 단계적으로 loadAccountsConfig로 옮겨지는 동안 유지.
export async function loadApiConfig(): Promise<ApiConfig | null> {
  const cfg = await loadAccountsConfig();
  const active = cfg.accounts.find((a) => a.id === cfg.activeAccountId);
  if (!active) return null;
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
