// @tauri-apps/plugin-store 호환 최소 스토어. 메인 프로세스가 단일 소스로
// 들고 있어 여러 창이 같은 값을 본다 (Tauri 플러그인 의미론과 동일).
// set/delete 는 메모리만 갱신, save 시 디스크(JSON)로 영속화.
const fs = require("fs");
const path = require("path");

module.exports = function createStore(app) {
  const dir = app.getPath("userData");
  const cache = new Map(); // file -> object

  function filePath(file) {
    return path.join(dir, file);
  }

  function load(file) {
    if (cache.has(file)) return cache.get(file);
    let obj = {};
    try {
      obj = JSON.parse(fs.readFileSync(filePath(file), "utf8")) || {};
    } catch {
      obj = {};
    }
    cache.set(file, obj);
    return obj;
  }

  function op(operation, file, key, val) {
    const obj = load(file);
    switch (operation) {
      case "load":
        return null;
      case "get":
        return obj[key];
      case "set":
        obj[key] = val;
        return null;
      case "delete":
        delete obj[key];
        return null;
      case "save":
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath(file), JSON.stringify(obj, null, 2), "utf8");
        } catch (e) {
          console.error("[tp] store save failed:", e);
        }
        return null;
      default:
        return null;
    }
  }

  return { op };
};
