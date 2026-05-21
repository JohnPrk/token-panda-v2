// preload.cjs 가 노출한 window.__TP__ 의 타입.
export type TPEventMsg = { event: string; payload: unknown };

export interface TPBridge {
  label: string;
  invoke<T = unknown>(cmd: string, args?: unknown): Promise<T>;
  emit(event: string, payload?: unknown): Promise<void>;
  on(cb: (msg: TPEventMsg) => void): () => void;
  win(action: "close" | "show" | "hide" | "focus" | "unminimize"): Promise<void>;
  store: {
    get<T = unknown>(file: string, key: string): Promise<T | undefined>;
    set(file: string, key: string, value: unknown): Promise<void>;
    save(file: string): Promise<void>;
    delete(file: string, key: string): Promise<void>;
    load(file: string): Promise<void>;
  };
}

export function tp(): TPBridge {
  const b = (window as unknown as { __TP__?: TPBridge }).__TP__;
  if (!b) {
    throw new Error(
      "__TP__ bridge 미주입 — Electron preload 밖(브라우저 직접 접근)에서 Tauri shim 호출됨",
    );
  }
  return b;
}
