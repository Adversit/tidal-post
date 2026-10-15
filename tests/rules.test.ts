/**
 * 规则引擎行为测试(AC01-AC08、AC11 的引擎部分)。
 * 所有案例均为独立构造的小棋盘,不依赖 8 个正式关卡。
 */
import { describe, it, expect } from 'vitest';
import { applyTide, initialState } from '../src/rules';
import type { GameState } from '../src/types';
import { mkLevel } from './helpers';

function boat(state: GameState, id: string) {
  const b = state.boats.find((x) => x.id === id);
  if (!b) throw new Error(`no boat ${id}`);
  return { pos: { ...b.pos }, delivered: b.delivered };
}

describe('AC01 基本移动', () => {
  it('每次有效指令只移动一格,不滑到底', () => {
    const lv = mkLevel({
      grid: ['#####', '#...#', '#####'],
      boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 1, c: 3 } }]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(r.effective).toBe(true);
    expect(boat(r.state, 'A').pos).toEqual({ r: 1, c: 2 }); // 不是 [1,3]
    expect(boat(r.state, 'A').delivered).toBe(false);
    expect(r.state.moves).toBe(1);
  });

  it('越界被阻挡', () => {
    const lv = mkLevel({
      grid: ['#####', '#...#', '#####'],
      boats: [{ id: 'A', start: { r: 1, c: 3 }, dock: { r: 1, c: 1 } }]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(r.effective).toBe(false);
    expect(boat(r.state, 'A').pos).toEqual({ r: 1, c: 3 });
    expect(r.state.moves).toBe(0);
  });

  it('陆地被阻挡', () => {
    const lv = mkLevel({
      grid: ['#####', '#.#.#', '#####'],
      boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 1, c: 3 } }]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(r.effective).toBe(false);
    expect(boat(r.state, 'A').pos).toEqual({ r: 1, c: 1 });
  });
});

describe('AC02 同步跟随', () => {
  const boats = [
    { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } },
    { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
  ];

  it('A 进入 B 腾出的格,B 同时前进', () => {
    const lv = mkLevel({ grid: ['....', '....'], boats });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 1 });
    expect(boat(r.state, 'B').pos).toEqual({ r: 0, c: 2 });
  });

  it('交换 boats 数组顺序,结果不变', () => {
    const lv1 = mkLevel({ grid: ['....', '....'], boats });
    const lv2 = mkLevel({ grid: ['....', '....'], boats: [...boats].reverse() });
    const r1 = applyTide(lv1, initialState(lv1), { dir: 'R', pendingAnchor: null });
    const r2 = applyTide(lv2, initialState(lv2), { dir: 'R', pendingAnchor: null });
    expect(boat(r2.state, 'A')).toEqual(boat(r1.state, 'A'));
    expect(boat(r2.state, 'B')).toEqual(boat(r1.state, 'B'));
  });
});

describe('AC03 阻挡传递', () => {
  it('前船撞墙,后船同样停住且不重叠', () => {
    const lv = mkLevel({
      grid: ['..#.', '....'],
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } },
        { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
      ]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(r.effective).toBe(false);
    expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 0 });
    expect(boat(r.state, 'B').pos).toEqual({ r: 0, c: 1 });
  });

  it('前船被锚定后船停住;有其他船移动则本次有效且消耗锚', () => {
    const lv = mkLevel({
      grid: ['....', '....', '....'],
      anchorCharges: 1,
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } },
        { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } },
        { id: 'C', start: { r: 2, c: 2 }, dock: { r: 2, c: 0 } }
      ]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: 'B' });
    expect(r.effective).toBe(true); // C 移动
    expect(r.anchorConsumed).toBe(true);
    expect(r.state.anchorsLeft).toBe(0);
    expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 0 }); // 被锚定的 B 阻挡
    expect(boat(r.state, 'B').pos).toEqual({ r: 0, c: 1 });
    expect(boat(r.state, 'C').pos).toEqual({ r: 2, c: 3 });
    const occupied = r.state.boats.filter((b) => !b.delivered).map((b) => `${b.pos.r},${b.pos.c}`);
    expect(new Set(occupied).size).toBe(occupied.length); // 无重叠
  });
});

it('AC04 跟随进港:前船交付并腾出原格', () => {
  const lv = mkLevel({
    grid: ['...', '...'],
    boats: [
      { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 2 } },
      { id: 'B', start: { r: 0, c: 1 }, dock: { r: 0, c: 2 } }
    ]
  });
  const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
  expect(boat(r.state, 'B').delivered).toBe(true);
  expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 1 });
});

describe('AC05 码头匹配', () => {
  it('进入自己的码头完成交付', () => {
    const lv = mkLevel({
      grid: ['..', '..'],
      boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } }]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(boat(r.state, 'A').delivered).toBe(true);
    expect(r.events.some((e) => e.type === 'complete')).toBe(true);
  });

  it('他人码头视为障碍', () => {
    const lv = mkLevel({
      grid: ['...', '...'],
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 0 } },
        { id: 'B', start: { r: 1, c: 1 }, dock: { r: 0, c: 1 } }
      ]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 0 }); // 被 B 的码头挡住
    expect(boat(r.state, 'B').pos).toEqual({ r: 1, c: 2 });
    expect(
      r.events.some((e) => e.type === 'blocked' && e.boatId === 'A' && e.reason === 'dock')
    ).toBe(true);
  });

  it('已交付码头仍然保留且阻挡其他船', () => {
    const lv = mkLevel({
      grid: ['...', '...'],
      boats: [
        { id: 'B', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } },
        { id: 'A', start: { r: 1, c: 0 }, dock: { r: 1, c: 2 } }
      ]
    });
    let s = initialState(lv);
    s = applyTide(lv, s, { dir: 'R', pendingAnchor: null }).state; // B 交付至 [0,1];A 到 [1,1]
    expect(boat(s, 'B').delivered).toBe(true);
    const r2 = applyTide(lv, s, { dir: 'U', pendingAnchor: null }); // A 想进 [0,1]
    expect(r2.effective).toBe(false);
    expect(boat(r2.state, 'A').pos).toEqual({ r: 1, c: 1 });
  });
});

describe('AC06 门的开始快照', () => {
  it('一船离开浮标,另一船同回合跨门:允许通过', () => {
    const lv = mkLevel({
      grid: ['....', '....'],
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } },
        { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
      ],
      gates: [{ id: 'G', a: { r: 0, c: 1 }, b: { r: 0, c: 2 }, pads: [{ r: 0, c: 0 }] }]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 1 }); // A 离开浮标
    expect(boat(r.state, 'B').pos).toEqual({ r: 0, c: 2 }); // B 同回合跨门成功
  });

  it('本回合才压上浮标,另一船本回合不能通过;下一回合可以', () => {
    const lv = mkLevel({
      grid: ['.....', '.....'],
      boats: [
        { id: 'A', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } },
        { id: 'B', start: { r: 0, c: 3 }, dock: { r: 1, c: 4 } }
      ],
      gates: [{ id: 'G', a: { r: 0, c: 3 }, b: { r: 0, c: 4 }, pads: [{ r: 0, c: 2 }] }]
    });
    const r1 = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: null });
    expect(boat(r1.state, 'A').pos).toEqual({ r: 0, c: 2 }); // A 到达浮标
    expect(boat(r1.state, 'B').pos).toEqual({ r: 0, c: 3 }); // B 被关闭的门挡住
    expect(
      r1.events.some((e) => e.type === 'blocked' && e.boatId === 'B' && e.reason === 'gate')
    ).toBe(true);
    const r2 = applyTide(lv, r1.state, { dir: 'R', pendingAnchor: null });
    expect(boat(r2.state, 'B').pos).toEqual({ r: 0, c: 4 }); // 门现在开了
  });
});

describe('AC07 锚持续时间', () => {
  const mk = () =>
    mkLevel({
      grid: ['....', '....'],
      anchorCharges: 1,
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } },
        { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
      ]
    });

  it('只固定下一次有效潮汐,随后恢复正常响应', () => {
    const lv = mk();
    const r1 = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: 'A' });
    expect(boat(r1.state, 'A').pos).toEqual({ r: 0, c: 0 }); // 锚定不动
    expect(boat(r1.state, 'B').pos).toEqual({ r: 0, c: 2 });
    expect(r1.state.anchorsLeft).toBe(0);
    const r2 = applyTide(lv, r1.state, { dir: 'R', pendingAnchor: null });
    expect(boat(r2.state, 'A').pos).toEqual({ r: 0, c: 1 }); // 恢复响应
    expect(boat(r2.state, 'B').pos).toEqual({ r: 0, c: 3 });
  });

  it('锚定船仍然压住浮标让门打开', () => {
    const lv = mkLevel({
      grid: ['....', '....'],
      anchorCharges: 1,
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } },
        { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
      ],
      gates: [{ id: 'G', a: { r: 0, c: 1 }, b: { r: 0, c: 2 }, pads: [{ r: 0, c: 0 }] }]
    });
    const r = applyTide(lv, initialState(lv), { dir: 'R', pendingAnchor: 'A' });
    expect(boat(r.state, 'A').pos).toEqual({ r: 0, c: 0 }); // A 锚定留在浮标上
    expect(boat(r.state, 'B').pos).toEqual({ r: 0, c: 2 }); // B 跨过开着的门
  });
});

it('AC08 无效潮汐:全体不动时不扣锚、不计数、不改状态', () => {
  const lv = mkLevel({
    grid: ['#####', '#...#', '#####'],
    anchorCharges: 1,
    boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 1, c: 3 } }]
  });
  const s0 = initialState(lv);
  const r = applyTide(lv, s0, { dir: 'U', pendingAnchor: 'A' });
  expect(r.effective).toBe(false);
  expect(r.anchorConsumed).toBe(false);
  expect(r.state).toBe(s0); // 原状态对象未被替换/污染
  expect(r.state.moves).toBe(0);
  expect(r.state.anchorsLeft).toBe(1);
});

describe('AC11 终局', () => {
  it('最后一船交付触发 complete;无效方向不触发失败;完成后推潮安全无效', () => {
    const lv = mkLevel({
      grid: ['#####', '#...#', '#####'],
      boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 1, c: 3 } }]
    });
    let s = initialState(lv);
    const bad = applyTide(lv, s, { dir: 'U', pendingAnchor: null });
    expect(bad.effective).toBe(false);
    expect(bad.events.some((e) => e.type === 'complete')).toBe(false);
    s = applyTide(lv, s, { dir: 'R', pendingAnchor: null }).state;
    const fin = applyTide(lv, s, { dir: 'R', pendingAnchor: null });
    expect(fin.events.some((e) => e.type === 'complete')).toBe(true);
    expect(fin.state.boats.every((b) => b.delivered)).toBe(true);
    const after = applyTide(lv, fin.state, { dir: 'L', pendingAnchor: null });
    expect(after.effective).toBe(false);
  });
});
