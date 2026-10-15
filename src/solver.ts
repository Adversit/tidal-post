/**
 * 潮汐邮局 - BFS 求解辅助(仅测试/校验用,不进游戏运行时)。
 *
 * 状态 = 各船位置与交付标记 + 剩余锚次数。
 * 动作 = 方向 × (不用锚 | 锚定一艘在场船)。
 * 选择锚与下一次有效移动合并为一个搜索动作;
 * 无效潮汐不产生新状态,不入队。
 */
import type { Direction, GameState, LevelDef, TideInput } from './types';
import { ALL_DIRECTIONS } from './types';
import { applyTide, cloneState, initialState } from './rules';

export type SolveStatus = 'solved' | 'unsolvable' | 'unknown';

export interface SolveResult {
  status: SolveStatus;
  /** solved 时为找到的动作序列 */
  path: TideInput[];
  /** 已探索状态数 */
  explored: number;
  budget: number;
}

export function stateKey(state: GameState): string {
  const parts = state.boats
    .map((b) => `${b.id}:${b.delivered ? 'X' : `${b.pos.r},${b.pos.c}`}`)
    .sort();
  return `${parts.join('|')}#${state.anchorsLeft}`;
}

export function solve(
  level: LevelDef,
  opts: { budget?: number; allowAnchor?: boolean } = {}
): SolveResult {
  const budget = opts.budget ?? 200_000;
  const allowAnchor = opts.allowAnchor ?? true;

  const start = initialState(level);
  const startKey = stateKey(start);
  const visited = new Set<string>([startKey]);
  // 队列元素:状态 + 到达路径
  const queue: Array<{ state: GameState; path: TideInput[] }> = [{ state: start, path: [] }];
  let head = 0;

  const isSolved = (s: GameState) => s.boats.every((b) => b.delivered);

  while (head < queue.length) {
    if (visited.size > budget) {
      return { status: 'unknown', path: [], explored: visited.size, budget };
    }
    const { state, path } = queue[head++];
    if (isSolved(state)) {
      return { status: 'solved', path, explored: visited.size, budget };
    }
    const inPlayIds = state.boats.filter((b) => !b.delivered).map((b) => b.id);
    for (const dir of ALL_DIRECTIONS) {
      const anchorChoices: Array<string | null> =
        allowAnchor && state.anchorsLeft > 0 ? [null, ...inPlayIds] : [null];
      for (const anchor of anchorChoices) {
        const result = applyTide(level, state, { dir: dir as Direction, pendingAnchor: anchor });
        if (!result.effective) continue;
        const key = stateKey(result.state);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({
          state: cloneState(result.state),
          path: [...path, { dir: dir as Direction, pendingAnchor: anchor }]
        });
      }
    }
  }
  return { status: 'unsolvable', path: [], explored: visited.size, budget };
}
