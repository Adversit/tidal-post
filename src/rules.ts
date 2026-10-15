/**
 * 潮汐邮局 - 纯规则引擎 (TIDE-RULES-1)
 *
 * 约束:
 * - 不依赖 DOM / Canvas / 动画时钟 / 随机数。
 * - 输入状态与动作,输出确定的新状态及事件;不原地修改输入。
 * - 门状态不随状态存储,始终由船位推导(gateOpen)。
 */
import type {
  BlockReason,
  Direction,
  GameEvent,
  GameState,
  GateDef,
  LevelDef,
  Pos,
  TideInput,
  TideResult
} from './types';
import { DIRS } from './types';

export function posEq(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}

export function gridRows(level: LevelDef): number {
  return level.grid.length;
}

export function gridCols(level: LevelDef): number {
  return level.grid[0]?.length ?? 0;
}

export function inBounds(level: LevelDef, p: Pos): boolean {
  return p.r >= 0 && p.r < gridRows(level) && p.c >= 0 && p.c < gridCols(level);
}

export function isWater(level: LevelDef, p: Pos): boolean {
  return inBounds(level, p) && level.grid[p.r][p.c] === '.';
}

/** 返回该格码头归属的船 id;无码头返回 null。已交付码头仍保留归属。 */
export function dockOwnerAt(level: LevelDef, p: Pos): string | null {
  for (const b of level.boats) {
    if (posEq(b.dock, p)) return b.id;
  }
  return null;
}

/** p、q 正交相邻且之间存在水闸时返回该闸门 */
export function gateBetween(level: LevelDef, p: Pos, q: Pos): GateDef | null {
  for (const g of level.gates) {
    if ((posEq(g.a, p) && posEq(g.b, q)) || (posEq(g.a, q) && posEq(g.b, p))) {
      return g;
    }
  }
  return null;
}

/**
 * 由船位推导门是否打开:任一关联浮标上有未交付的船。
 * 这是门状态的唯一来源(移动前的快照与移动后的画面都用它)。
 */
export function gateOpen(gate: GateDef, boats: readonly { pos: Pos; delivered: boolean }[]): boolean {
  return gate.pads.some((pad) => boats.some((b) => !b.delivered && posEq(b.pos, pad)));
}

export function initialState(level: LevelDef): GameState {
  return {
    boats: level.boats.map((b) => ({ id: b.id, pos: { ...b.start }, delivered: false })),
    anchorsLeft: level.anchorCharges,
    moves: 0
  };
}

export function cloneState(state: GameState): GameState {
  return {
    boats: state.boats.map((b) => ({ id: b.id, pos: { ...b.pos }, delivered: b.delivered })),
    anchorsLeft: state.anchorsLeft,
    moves: state.moves
  };
}

/**
 * 结算一次潮汐。
 *
 * 流程:
 * 1. 以潮汐开始前的船位快照决定每扇门本次开/关。
 * 2. 计算所有船的 canMove(跟随链 memo 化,与 boats 数组顺序无关)。
 * 3. 全部判定完成后一次性提交移动与交付。
 * 4. 全体不动 => 无效潮汐:不改状态、不扣锚、不计数。
 * 5. 有效潮汐 => 若使用了待用锚则消耗一次并计数 +1。
 */
export function applyTide(level: LevelDef, state: GameState, input: TideInput): TideResult {
  const { dir } = input;
  const delta = DIRS[dir];
  const events: GameEvent[] = [];

  // 待用锚校验:必须有剩余次数、目标在场(未交付)。控制器保证,引擎兜底。
  const anchoredId =
    input.pendingAnchor !== null &&
    state.anchorsLeft > 0 &&
    state.boats.some((b) => b.id === input.pendingAnchor && !b.delivered)
      ? input.pendingAnchor
      : null;

  // --- 1. 开始前快照:门本次开/关 ---
  const openAtStart = new Map<string, boolean>();
  for (const g of level.gates) {
    openAtStart.set(g.id, gateOpen(g, state.boats));
  }
  const padActiveAtStart = new Map<string, boolean>();
  for (const g of level.gates) {
    for (const pad of g.pads) {
      const active = state.boats.some((b) => !b.delivered && posEq(b.pos, pad));
      padActiveAtStart.set(`${pad.r},${pad.c}`, active);
    }
  }

  // --- 2. canMove 判定(带 memo 与环保护) ---
  const canMove = new Map<string, boolean>();
  const blockedReason = new Map<string, BlockReason>();
  const liveBoatAt = (p: Pos) =>
    state.boats.find((b) => !b.delivered && posEq(b.pos, p)) ?? null;

  const resolve = (boatId: string, visiting: Set<string>): boolean => {
    const memo = canMove.get(boatId);
    if (memo !== undefined) return memo;
    if (visiting.has(boatId)) return false; // 同向平移不会成环,此处仅兜底
    visiting.add(boatId);

    const boat = state.boats.find((b) => b.id === boatId)!;
    const t: Pos = { r: boat.pos.r + delta.r, c: boat.pos.c + delta.c };
    let ok = false;
    let reason: BlockReason = 'boat';

    if (!inBounds(level, t)) {
      reason = 'bounds';
    } else if (!isWater(level, t)) {
      reason = 'land';
    } else {
      const dockOwner = dockOwnerAt(level, t);
      if (dockOwner !== null && dockOwner !== boat.id) {
        reason = 'dock';
      } else {
        const gate = gateBetween(level, boat.pos, t);
        if (gate && !openAtStart.get(gate.id)) {
          reason = 'gate';
        } else {
          const occupant = liveBoatAt(t);
          if (occupant) {
            if (occupant.id === anchoredId) {
              reason = 'anchored'; // 锚定船不腾位
            } else if (resolve(occupant.id, visiting)) {
              ok = true; // 前船腾出(含前船进港)
            } else {
              reason = 'boat'; // 阻挡传递
            }
          } else {
            ok = true;
          }
        }
      }
    }

    visiting.delete(boatId);
    canMove.set(boatId, ok);
    if (!ok) blockedReason.set(boatId, reason);
    return ok;
  };

  for (const b of state.boats) {
    if (b.delivered || b.id === anchoredId) continue;
    resolve(b.id, new Set());
  }

  // --- 3. 一次性提交 ---
  const newBoats = state.boats.map((b) => ({ id: b.id, pos: { ...b.pos }, delivered: b.delivered }));
  let anyMoved = false;
  for (const nb of newBoats) {
    if (nb.delivered || nb.id === anchoredId) continue;
    if (!canMove.get(nb.id)) continue;
    const from = { ...nb.pos };
    nb.pos = { r: nb.pos.r + delta.r, c: nb.pos.c + delta.c };
    anyMoved = true;
    events.push({ type: 'move', boatId: nb.id, from, to: { ...nb.pos }, dir });
    if (dockOwnerAt(level, nb.pos) === nb.id) {
      nb.delivered = true;
      events.push({ type: 'delivered', boatId: nb.id, dock: { ...nb.pos } });
    }
  }

  // --- 4. 无效潮汐 ---
  if (!anyMoved) {
    events.push({ type: 'ineffective', dir });
    return { state, effective: false, anchorConsumed: false, events };
  }

  // 受阻反馈(有效潮汐才需要;锚定船不算受阻)
  for (const b of state.boats) {
    if (b.delivered || b.id === anchoredId) continue;
    if (!canMove.get(b.id)) {
      events.push({ type: 'blocked', boatId: b.id, reason: blockedReason.get(b.id)!, dir });
    }
  }

  // --- 5. 有效潮汐:消耗锚、计数 ---
  const anchorConsumed = anchoredId !== null;
  if (anchorConsumed) {
    events.push({ type: 'anchorUsed', boatId: anchoredId! });
  }
  const newState: GameState = {
    boats: newBoats,
    anchorsLeft: state.anchorsLeft - (anchorConsumed ? 1 : 0),
    moves: state.moves + 1
  };

  // 门/浮标状态变化(供画面表现;门状态仍以船位推导为准)
  for (const g of level.gates) {
    const nowOpen = gateOpen(g, newState.boats);
    if (nowOpen !== openAtStart.get(g.id)) {
      events.push({ type: 'gate', gateId: g.id, open: nowOpen });
    }
    for (const pad of g.pads) {
      const key = `${pad.r},${pad.c}`;
      const nowActive = newState.boats.some((b) => !b.delivered && posEq(b.pos, pad));
      if (nowActive !== padActiveAtStart.get(key)) {
        events.push({ type: 'pad', pos: { ...pad }, active: nowActive });
      }
    }
  }

  if (newState.boats.every((b) => b.delivered)) {
    events.push({ type: 'complete', moves: newState.moves });
  }

  return { state: newState, effective: true, anchorConsumed, events };
}

/** 解析参考解步骤:"R" 或 "R@A"(锚 A 后执行 R 潮汐) */
export function parseSolutionStep(step: string): TideInput {
  const m = /^([URDL])(?:@(.+))?$/.exec(step);
  if (!m) throw new Error(`无效的参考解步骤: ${step}`);
  return { dir: m[1] as Direction, pendingAnchor: m[2] ?? null };
}
