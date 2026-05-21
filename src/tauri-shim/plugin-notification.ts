// @tauri-apps/plugin-notification 호환 shim. Electron 렌더러의 Web Notification
// API 로 구현 (실제 OS 알림이 뜬다).
export type Permission = "granted" | "denied" | "default";

export async function isPermissionGranted(): Promise<boolean> {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export async function requestPermission(): Promise<Permission> {
  if (typeof Notification === "undefined") return "denied";
  try {
    return (await Notification.requestPermission()) as Permission;
  } catch {
    return "denied";
  }
}

export function sendNotification(options: { title: string; body?: string } | string): void {
  const o = typeof options === "string" ? { title: options } : options;
  try {
    new Notification(o.title, { body: o.body });
  } catch {
    /* ignore */
  }
}
