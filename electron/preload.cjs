// 렌더러에 window.__TP__ 를 노출한다. src/tauri-shim/* 가 이 표면을 통해
// Tauri API(invoke/emit/listen/Store/getCurrentWindow)를 흉내낸다.
const { contextBridge, ipcRenderer } = require("electron");

// 메인이 webPreferences.additionalArguments 로 박아주는 창 라벨.
const labelArg = process.argv.find((a) => a.startsWith("--tp-label="));
const label = labelArg ? labelArg.slice("--tp-label=".length) : "main";

contextBridge.exposeInMainWorld("__TP__", {
  label,
  invoke: (cmd, args) => ipcRenderer.invoke("tp:invoke", cmd, args),
  emit: (event, payload) => ipcRenderer.invoke("tp:emit", event, payload),
  // 메인이 broadcast 하는 tp:event 를 받아 콜백에 넘긴다. 반환값은 해제 함수.
  on: (cb) => {
    const handler = (_e, msg) => {
      try {
        cb(msg);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("tp:event", handler);
    return () => ipcRenderer.removeListener("tp:event", handler);
  },
  win: (action) => ipcRenderer.invoke("tp:win", action),
  store: {
    get: (file, key) => ipcRenderer.invoke("tp:store", "get", file, key),
    set: (file, key, val) => ipcRenderer.invoke("tp:store", "set", file, key, val),
    save: (file) => ipcRenderer.invoke("tp:store", "save", file),
    delete: (file, key) => ipcRenderer.invoke("tp:store", "delete", file, key),
    load: (file) => ipcRenderer.invoke("tp:store", "load", file),
  },
});
