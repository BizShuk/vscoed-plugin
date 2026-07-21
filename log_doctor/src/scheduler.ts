// src/scheduler.ts — 全域冷卻 (上次套用後 N 分鐘內不允許再套用)。
import type { Memento } from 'vscode';

const KEY = 'logDoctor.lastAppliedAt.v1';

export class Scheduler {
  private lastAppliedAt: number | null = null;

  constructor(
    private readonly memento: Memento,
    private readonly cooldownMinutes: number,
  ) {
    const stored = this.memento.get<number | null>(KEY, null);
    this.lastAppliedAt = typeof stored === 'number' ? stored : null;
  }

  /** 是否可立即執行一次套用。 */
  canRun(now: number = Date.now()): boolean {
    if (this.cooldownMinutes <= 0) return true;
    if (this.lastAppliedAt === null) return true;
    const elapsed = now - this.lastAppliedAt;
    return elapsed >= this.cooldownMinutes * 60 * 1000;
  }

  /** 距離下次可執行的毫秒數;若已可執行回傳 0。 */
  msUntilNextRun(now: number = Date.now()): number {
    if (this.canRun(now)) return 0;
    const elapsed = now - (this.lastAppliedAt ?? now);
    return this.cooldownMinutes * 60 * 1000 - elapsed;
  }

  /** 標記現在套用一次 (寫入 memento + 同步記憶體)。 */
  async markApplied(now: number = Date.now()): Promise<void> {
    this.lastAppliedAt = now;
    await this.memento.update(KEY, now);
  }
}
