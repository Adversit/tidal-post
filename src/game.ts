/**
 * 潮汐邮局 - 游戏控制器:状态、历史、锚选择与输入入口。
 *
 * 所有潮向输入(滑动 / 按钮 / 键盘)都必须调用同一个入口 tide()。
 * 动画期间 locked=true,移动/锚/撤回/重来全部拒绝。
 */
import type { Direction, GameEvent, GameState, LevelDef, TideResult } from './types';
import { applyTide, cloneState, initialState } from './rules';

export type EventsHandler = (events: GameEvent[], result: TideResult, done: () => void) => void;

export class GameController {
  level: LevelDef;
  state: GameState;
  /** 每次有效潮汐前的状态快照,用于无限撤回 */
  history: GameState[] = [];
  /** 待用锚目标 */
  pendingAnchor: string | null = null;
  /** 锚选船模式(点了锚按钮,等待点船) */
  anchorSelecting = false;
  complete = false;
  /** 动画/结算进行中:拒绝一切新操作 */
  locked = false;

  /** 渲染层消费事件;动画结束后必须调用 done() 解锁 */
  onEvents: EventsHandler = (_events, _result, done) => done();
  /** 任何状态变化后的轻量刷新通知 */
  onChange: () => void = () => {};

  constructor(level: LevelDef) {
    this.level = level;
    this.state = initialState(level);
  }

  loadLevel(level: LevelDef): void {
    this.level = level;
    this.state = initialState(level);
    this.history = [];
    this.pendingAnchor = null;
    this.anchorSelecting = false;
    this.complete = false;
    this.locked = false;
    this.onChange();
  }

  /** 唯一潮汐入口 */
  tide(dir: Direction): TideResult | null {
    if (this.locked) return null;
    const result = applyTide(this.level, this.state, {
      dir,
      pendingAnchor: this.pendingAnchor
    });

    if (!result.effective) {
      // 无效潮汐:不扣锚、不进历史、保留待用锚,仅轻量反馈
      this.onEvents(result.events, result, () => {});
      this.onChange();
      return result;
    }

    this.history.push(cloneState(this.state));
    this.state = result.state;
    this.pendingAnchor = null;
    this.anchorSelecting = false;
    if (result.events.some((e) => e.type === 'complete')) this.complete = true;

    this.locked = true;
    this.onEvents(result.events, result, () => {
      this.locked = false;
      this.onChange();
    });
    this.onChange();
    return result;
  }

  /** 点锚按钮:进入/取消选船状态。不消耗次数。 */
  toggleAnchorSelect(): void {
    if (this.locked) return;
    if (this.level.anchorCharges === 0) return; // L01-L04 未解锁
    if (this.state.anchorsLeft === 0) return; // 已用完,按钮应已禁用
    if (this.anchorSelecting) {
      this.anchorSelecting = false;
    } else {
      this.anchorSelecting = true;
    }
    this.onChange();
  }

  /** 选船模式下点击船:设为/更换/取消待用锚目标。不消耗次数。 */
  pickAnchorTarget(boatId: string): void {
    if (this.locked || !this.anchorSelecting) return;
    const boat = this.state.boats.find((b) => b.id === boatId);
    if (!boat || boat.delivered) return;
    this.pendingAnchor = this.pendingAnchor === boatId ? null : boatId;
    this.onChange();
  }

  /** 清除待用锚(保留选船模式与否由调用方决定) */
  clearPendingAnchor(): void {
    if (this.locked) return;
    this.pendingAnchor = null;
    this.anchorSelecting = false;
    this.onChange();
  }

  /** 无限撤回:恢复上一次有效潮汐前的完整状态 */
  undo(): boolean {
    if (this.locked || this.history.length === 0) return false;
    this.state = this.history.pop()!;
    this.complete = this.state.boats.every((b) => b.delivered);
    this.pendingAnchor = null;
    this.anchorSelecting = false;
    this.onChange();
    return true;
  }

  /** 重来本关:回到初始状态,清空历史与选择 */
  restart(): boolean {
    if (this.locked) return false;
    this.state = initialState(this.level);
    this.history = [];
    this.pendingAnchor = null;
    this.anchorSelecting = false;
    this.complete = false;
    this.onChange();
    return true;
  }

  deliveredCount(): number {
    return this.state.boats.filter((b) => b.delivered).length;
  }
}
