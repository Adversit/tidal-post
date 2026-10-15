/**
 * 游戏控制器测试(AC08 控制器部分、AC09 撤回、AC10 输入锁定、锚选择流程)。
 */
import { describe, it, expect } from 'vitest';
import { GameController } from '../src/game';
import { getLevel } from '../src/levels';
import { gateOpen } from '../src/rules';
import { mkLevel } from './helpers';

/** 立即可解锁的控制器(动画时长视为 0) */
function makeController(levelId: string): GameController {
  const c = new GameController(getLevel(levelId));
  c.onEvents = (_e, _r, done) => done();
  return c;
}

describe('AC08 无效潮汐(控制器层)', () => {
  it('保留待用锚目标、不进历史、不计数', () => {
    const c = makeController('L05');
    c.toggleAnchorSelect();
    c.pickAnchorTarget('A');
    const r = c.tide('U'); // L05 初始向上:A、B 均被陆地挡住
    expect(r?.effective).toBe(false);
    expect(c.pendingAnchor).toBe('A'); // 待用锚保留
    expect(c.state.anchorsLeft).toBe(1); // 未消耗
    expect(c.state.moves).toBe(0);
    expect(c.history.length).toBe(0); // 不产生撤回记录
  });
});

describe('AC09 撤回', () => {
  it('恢复船位与计数,支持连续撤回', () => {
    const c = makeController('L03');
    c.tide('U');
    c.tide('R');
    expect(c.state.moves).toBe(2);
    expect(c.undo()).toBe(true);
    expect(c.state.moves).toBe(1);
    expect(c.undo()).toBe(true);
    expect(c.state.moves).toBe(0);
    const a = c.state.boats.find((b) => b.id === 'A')!;
    const b = c.state.boats.find((x) => x.id === 'B')!;
    expect(a.pos).toEqual({ r: 2, c: 1 });
    expect(b.pos).toEqual({ r: 3, c: 1 });
    expect(c.undo()).toBe(false); // 历史耗尽
  });

  it('撤回恢复交付状态与锚次数,并清除待用选择', () => {
    const c = makeController('L05');
    c.toggleAnchorSelect();
    c.pickAnchorTarget('A');
    expect(c.pendingAnchor).toBe('A');
    c.tide('R'); // 消耗锚
    expect(c.state.anchorsLeft).toBe(0);
    expect(c.pendingAnchor).toBeNull(); // 有效潮汐后待用锚被清除
    expect(c.undo()).toBe(true);
    expect(c.state.anchorsLeft).toBe(1); // 次数恢复
    expect(c.pendingAnchor).toBeNull(); // 待用选择已清除
    expect(c.anchorSelecting).toBe(false);
    expect(c.state.moves).toBe(0);
  });

  it('通关后可撤回,完成态被撤销', () => {
    const c = makeController('L01');
    c.tide('R');
    c.tide('R');
    expect(c.complete).toBe(true);
    expect(c.undo()).toBe(true);
    expect(c.complete).toBe(false);
    expect(c.state.boats.some((b) => !b.delivered)).toBe(true);
  });

  it('撤回后门状态按恢复后的船位重新推导', () => {
    const c = makeController('L04');
    c.tide('R'); // A 上浮标,门打开
    const gate = c.level.gates[0];
    expect(gateOpen(gate, c.state.boats)).toBe(true);
    c.undo();
    expect(gateOpen(gate, c.state.boats)).toBe(false); // 由船位推导,非残留状态
  });

  it('重来恢复初始并清空历史', () => {
    const c = makeController('L03');
    c.tide('U');
    c.tide('R');
    expect(c.restart()).toBe(true);
    expect(c.state.moves).toBe(0);
    expect(c.history.length).toBe(0);
    expect(c.complete).toBe(false);
  });
});

describe('AC10 重复输入锁定', () => {
  it('动画未完成时移动/锚/撤回/重来全部被拒', () => {
    const c = new GameController(
      mkLevel({
        grid: ['....', '....'],
        boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } }]
      })
    );
    let unlock: (() => void) | null = null;
    c.onEvents = (_e, _r, done) => {
      unlock = done; // 故意不调 done,模拟动画进行中
    };
    const r1 = c.tide('R');
    expect(r1).not.toBeNull();
    expect(c.locked).toBe(true);
    expect(c.tide('R')).toBeNull(); // 快速重复点击不产生额外结算
    expect(c.undo()).toBe(false);
    expect(c.restart()).toBe(false);
    expect(c.state.moves).toBe(1); // 只结算了一次
    unlock!();
    expect(c.locked).toBe(false);
    expect(c.tide('R')).not.toBeNull();
    expect(c.state.moves).toBe(2);
  });

  it('无效潮汐不锁定输入', () => {
    const c = makeController('L01');
    const r = c.tide('U');
    expect(r?.effective).toBe(false);
    expect(c.locked).toBe(false);
  });
});

describe('锚选择流程', () => {
  it('进入/选择/更换/取消均不消耗次数', () => {
    const c = makeController('L05');
    c.toggleAnchorSelect();
    expect(c.anchorSelecting).toBe(true);
    c.pickAnchorTarget('A');
    expect(c.pendingAnchor).toBe('A');
    c.pickAnchorTarget('B'); // 更换目标
    expect(c.pendingAnchor).toBe('B');
    c.pickAnchorTarget('B'); // 再点取消
    expect(c.pendingAnchor).toBeNull();
    expect(c.state.anchorsLeft).toBe(1);
    expect(c.state.moves).toBe(0);
    expect(c.history.length).toBe(0);
  });

  it('L01-L04 不提供锚:进入选择被忽略', () => {
    const c = makeController('L01');
    c.toggleAnchorSelect();
    expect(c.anchorSelecting).toBe(false);
    c.pickAnchorTarget('A');
    expect(c.pendingAnchor).toBeNull();
  });

  it('已交付船不能被锚定', () => {
    const c = new GameController(
      mkLevel({
        grid: ['...', '...'],
        anchorCharges: 1,
        boats: [
          { id: 'A', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } },
          { id: 'B', start: { r: 1, c: 0 }, dock: { r: 1, c: 2 } }
        ]
      })
    );
    c.onEvents = (_e, _r, done) => done();
    c.tide('R'); // A 交付
    expect(c.state.boats.find((b) => b.id === 'A')!.delivered).toBe(true);
    c.toggleAnchorSelect();
    c.pickAnchorTarget('A'); // 已交付,忽略
    expect(c.pendingAnchor).toBeNull();
    c.pickAnchorTarget('B');
    expect(c.pendingAnchor).toBe('B');
  });
});
