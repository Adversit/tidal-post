/**
 * 关卡数据校验(AC12)与参考路径回放(AC13)。
 */
import { describe, it, expect } from 'vitest';
import { LEVELS, validateLevel } from '../src/levels';
import { applyTide, initialState, parseSolutionStep } from '../src/rules';
import { mkLevel } from './helpers';

describe('AC12 关卡数据校验', () => {
  it('首批 8 关全部通过校验', () => {
    for (const lv of LEVELS) {
      expect(validateLevel(lv), `${lv.id} 应合法`).toEqual([]);
    }
  });

  it('检出非矩形网格与非法字符', () => {
    const lv = mkLevel({ grid: ['###', '#.'], boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 0, c: 1 } }] });
    const errs = validateLevel(lv);
    expect(errs.some((e) => e.includes('非矩形'))).toBe(true);
    const lv2 = mkLevel({ grid: ['#x#', '#.#'], boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 0, c: 1 } }] });
    expect(validateLevel(lv2).some((e) => e.includes('非法字符'))).toBe(true);
  });

  it('检出起点/码头问题', () => {
    const onLand = mkLevel({ grid: ['##', '#.'], boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 1 } }] });
    expect(validateLevel(onLand).some((e) => e.includes('起点不在水格'))).toBe(true);

    const dup = mkLevel({
      grid: ['...', '...'],
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 0 } },
        { id: 'B', start: { r: 0, c: 0 }, dock: { r: 1, c: 1 } }
      ]
    });
    expect(validateLevel(dup).some((e) => e.includes('起点重叠'))).toBe(true);

    const bornOnDock = mkLevel({
      grid: ['...', '...'],
      boats: [
        { id: 'A', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } },
        { id: 'B', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } } // B 的码头是 A 的起点
      ]
    });
    expect(validateLevel(bornOnDock).some((e) => e.includes('出生在码头'))).toBe(true);

    const dockOverlap = mkLevel({
      grid: ['...', '...'],
      boats: [
        { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 0 } },
        { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
      ]
    });
    expect(validateLevel(dockOverlap).some((e) => e.includes('码头重叠'))).toBe(true);
  });

  it('检出水闸与浮标问题', () => {
    const notAdjacent = mkLevel({
      grid: ['....', '....'],
      boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 3 } }],
      gates: [{ id: 'G', a: { r: 0, c: 1 }, b: { r: 0, c: 3 }, pads: [{ r: 1, c: 1 }] }]
    });
    expect(validateLevel(notAdjacent).some((e) => e.includes('不正交相邻'))).toBe(true);

    const gateOnLand = mkLevel({
      grid: ['.#.', '...'],
      boats: [{ id: 'A', start: { r: 1, c: 0 }, dock: { r: 1, c: 2 } }],
      gates: [{ id: 'G', a: { r: 0, c: 1 }, b: { r: 1, c: 1 }, pads: [{ r: 1, c: 0 }] }]
    });
    expect(validateLevel(gateOnLand).some((e) => e.includes('端点'))).toBe(true);

    const twoPads = mkLevel({
      grid: ['...', '...'],
      boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 2 } }],
      gates: [{ id: 'G', a: { r: 0, c: 1 }, b: { r: 1, c: 1 }, pads: [{ r: 0, c: 2 }, { r: 1, c: 0 }] }]
    });
    expect(validateLevel(twoPads).some((e) => e.includes('恰好 1 个'))).toBe(true);

    const padOnLand = mkLevel({
      grid: ['.#.', '...'],
      boats: [{ id: 'A', start: { r: 1, c: 0 }, dock: { r: 1, c: 2 } }],
      gates: [{ id: 'G', a: { r: 1, c: 0 }, b: { r: 1, c: 1 }, pads: [{ r: 0, c: 1 }] }]
    });
    expect(validateLevel(padOnLand).some((e) => e.includes('浮标不在水格'))).toBe(true);
  });

  it('检出非法锚次数与非法/未知船的参考解', () => {
    const badCharges = mkLevel({
      grid: ['..'],
      boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } }],
      anchorCharges: -1
    });
    expect(validateLevel(badCharges).some((e) => e.includes('anchorCharges'))).toBe(true);

    const badStep = mkLevel({
      grid: ['..'],
      boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } }],
      referenceSolution: ['X']
    });
    expect(validateLevel(badStep).some((e) => e.includes('参考解步骤非法'))).toBe(true);

    const unknownBoat = mkLevel({
      grid: ['..'],
      boats: [{ id: 'A', start: { r: 0, c: 0 }, dock: { r: 0, c: 1 } }],
      referenceSolution: ['R@Z']
    });
    expect(validateLevel(unknownBoat).some((e) => e.includes('未知船'))).toBe(true);
  });
});

describe('AC13 参考路径回放(真实规则引擎)', () => {
  const expectedMoves = [2, 4, 3, 6, 5, 5, 9, 8];
  LEVELS.forEach((lv, i) => {
    it(`${lv.id}《${lv.title}》参考解完成投递,有效潮汐 ${expectedMoves[i]} 次`, () => {
      let s = initialState(lv);
      for (const step of lv.referenceSolution) {
        const r = applyTide(lv, s, parseSolutionStep(step));
        expect(r.effective, `${lv.id} 步骤 ${step} 应为有效潮汐`).toBe(true);
        s = r.state;
      }
      expect(s.boats.every((b) => b.delivered)).toBe(true);
      expect(s.moves).toBe(expectedMoves[i]);
    });
  });
});
