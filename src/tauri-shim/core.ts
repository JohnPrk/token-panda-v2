// @tauri-apps/api/core 호환 shim.
import { tp } from "./bridge";

export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tp().invoke<T>(cmd, args);
}
