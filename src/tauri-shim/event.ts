// @tauri-apps/api/event 호환 shim.
// Tauri 의 listen<T>(event, handler) 는 handler 에 { payload, event, id } 를 넘긴다.
// 프론트엔드는 e.payload 만 읽으므로 그 형태를 맞춰준다.
import { tp } from "./bridge";

export interface Event<T> {
  event: string;
  payload: T;
}
export type EventCallback<T> = (event: Event<T>) => void;
export type UnlistenFn = () => void;

const listeners = new Map<string, Set<EventCallback<unknown>>>();
let installed = false;

function ensureInstalled() {
  if (installed) return;
  installed = true;
  tp().on((msg) => {
    const set = listeners.get(msg.event);
    if (!set) return;
    for (const cb of set) cb({ event: msg.event, payload: msg.payload });
  });
}

export async function listen<T = unknown>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  ensureInstalled();
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as EventCallback<unknown>);
  return () => {
    set!.delete(handler as EventCallback<unknown>);
  };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  await tp().emit(event, payload);
}
