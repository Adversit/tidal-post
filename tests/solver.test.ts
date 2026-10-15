/**
 * AC14 求解核对:BFS 独立搜索,与规则引擎共享 applyTide。
 * - 8 关均可解,最短有效潮汐数与上层摘要一致(需本项目实测复核)。
 * - L05-L08 禁锚后完整穷尽可达状态,判定 Unsolvable。
 * - 预算不足必须报 Unknown,不得冒充通过。
 */
import { describe, it, expect } from 'vitest';
import { LEVELS } from '../src/levels';
import { solve } from '../src/solver';
import { applyTide, initialState } from '../src/rules';

const expectedMin = [2, 4, 3, 6, 5, 5, 9, 8];

describe('AC14 求解核对', () => {
  LEVELS.forEach((lv, i) => {
    it(`${lv.id} 可解,最短 ${expectedMin[i]} 次有效潮汐,路径可回放`, () => {
      const r = solve(lv);
      expect(r.status).toBe('solved');
      expect(r.path.length).toBe(expectedMin[i]);
      let s = initialState(lv);
      for (const a of r.path) {
        const step = applyTide(lv, s, a);
        expect(step.effective).toBe(true);
        s = step.state;
      }
      expect(s.boats.every((b) => b.delivered)).toBe(true);
    });
  });

  for (const id of ['L05', 'L06', 'L07', 'L08']) {
    it(`${id} 禁锚后完整搜索不可解(Unsolvable)`, () => {
      const lv = LEVELS.find((l) => l.id === id)!;
      const r = solve(lv, { allowAnchor: false });
      expect(r.status).toBe('unsolvable');
    });
  }

  for (const id of ['L01', 'L02', 'L03', 'L04']) {
    it(`${id} 禁锚仍可解(这些关本不需要锚)`, () => {
      const lv = LEVELS.find((l) => l.id === id)!;
      const r = solve(lv, { allowAnchor: false });
      expect(r.status).toBe('solved');
    });
  }

  it('搜索预算不足记为 Unknown,不算通过', () => {
    const lv = LEVELS.find((l) => l.id === 'L08')!;
    const r = solve(lv, { budget: 2 });
    expect(r.status).toBe('unknown');
  });
});
