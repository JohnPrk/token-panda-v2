// @tauri-apps/api/window 호환 shim (프론트엔드가 쓰는 표면만).
import { tp } from "./bridge";

class ShimWindow {
  get label(): string {
    return tp().label;
  }
  close(): Promise<void> {
    return tp().win("close");
  }
  show(): Promise<void> {
    return tp().win("show");
  }
  hide(): Promise<void> {
    return tp().win("hide");
  }
  setFocus(): Promise<void> {
    return tp().win("focus");
  }
  unminimize(): Promise<void> {
    return tp().win("unminimize");
  }
}

const current = new ShimWindow();

export function getCurrentWindow(): ShimWindow {
  return current;
}
