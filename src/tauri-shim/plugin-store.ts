// @tauri-apps/plugin-store 호환 shim. 백엔드(메인 프로세스)가 단일 소스라
// 여러 창이 같은 값을 본다. set/delete 는 메모리만, save 시 디스크 영속화.
import { tp } from "./bridge";

export class Store {
  private readonly file: string;

  private constructor(file: string) {
    this.file = file;
  }

  static async load(file: string): Promise<Store> {
    await tp().store.load(file);
    return new Store(file);
  }

  get<T = unknown>(key: string): Promise<T | undefined> {
    return tp().store.get<T>(this.file, key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await tp().store.set(this.file, key, value);
  }

  async save(): Promise<void> {
    await tp().store.save(this.file);
  }

  async delete(key: string): Promise<void> {
    await tp().store.delete(this.file, key);
  }
}
