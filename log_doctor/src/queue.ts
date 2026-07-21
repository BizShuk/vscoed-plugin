// src/queue.ts — 持久化佇列,以 workspaceState 為儲存後端。
import type { Memento } from 'vscode';
import { QueueItem } from './types';

const STORAGE_KEY = 'logDoctor.queue.v1';

export class PersistentQueue {
  private items: QueueItem[] = [];
  private loaded = false;

  constructor(private readonly memento: Memento) {}

  /** 從 memento 載入;若已載入則快取。 */
  load(): void {
    if (this.loaded) return;
    const raw = this.memento.get<QueueItem[]>(STORAGE_KEY, []);
    this.items = Array.isArray(raw) ? raw : [];
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.memento.update(STORAGE_KEY, this.items);
  }

  /** 加入佇列。同 id 視為已存在,不重複加入。 */
  async add(item: QueueItem): Promise<void> {
    this.load();
    if (this.items.some((i) => i.id === item.id)) return;
    this.items.push({ ...item, updatedAt: Date.now() });
    await this.save();
  }

  /** 依 id 移除。 */
  async remove(id: string): Promise<void> {
    this.load();
    this.items = this.items.filter((i) => i.id !== id);
    await this.save();
  }

  /** 局部更新;傳入 partial 合併進既有項目。 */
  async update(id: string, patch: Partial<QueueItem>): Promise<void> {
    this.load();
    this.items = this.items.map((i) =>
      i.id === id ? { ...i, ...patch, id: i.id, updatedAt: Date.now() } : i,
    );
    await this.save();
  }

  /** 全部項目 (依 priority 排序)。 */
  list(): QueueItem[] {
    this.load();
    return [...this.items].sort((a, b) => a.priority - b.priority);
  }

  /** 取得優先最高的 pending 項,不移除。 */
  peek(): QueueItem | undefined {
    this.load();
    return this.items
      .filter((i) => i.status === 'pending')
      .sort((a, b) => a.priority - b.priority)[0];
  }

  /** 全部清空(主要給測試 / 重置流程用)。 */
  async clear(): Promise<void> {
    this.load();
    this.items = [];
    await this.save();
  }
}
