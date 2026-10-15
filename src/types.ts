/**
 * 潮汐邮局 - 核心类型定义
 * 规则编号对应 PRD 中的 TIDE-RULES-1。
 */

export type Direction = 'U' | 'R' | 'D' | 'L';

/** 从 0 开始的 [row, col] 坐标 */
export interface Pos {
  r: number;
  c: number;
}

export interface BoatDef {
  id: string;
  start: Pos;
  dock: Pos;
}

/** 水闸位于两个正交相邻水格 a、b 之间的边上 */
export interface GateDef {
  id: string;
  a: Pos;
  b: Pos;
  /** 本批数据中恰好一个浮标 */
  pads: Pos[];
}

export interface LevelDef {
  id: string;
  title: string;
  /** 每行等长字符串,'#' 陆地 / '.' 水 */
  grid: string[];
  boats: BoatDef[];
  gates: GateDef[];
  anchorCharges: number;
  /** 仅用于测试回放,不展示给玩家;格式如 "R" 或 "R@A"(锚 A 后向右) */
  referenceSolution: string[];
  /** 短句教学提示 */
  teaching: string;
}

export interface BoatState {
  id: string;
  pos: Pos;
  /** 已交付:从棋盘移除,不再移动/压浮标/可被锚 */
  delivered: boolean;
}

/**
 * 规则状态。门状态不单独存储,始终由船位推导(见 rules.ts)。
 */
export interface GameState {
  boats: BoatState[];
  anchorsLeft: number;
  /** 有效潮汐计数 */
  moves: number;
}

export type BlockReason =
  | 'bounds' // 越界
  | 'land' // 陆地/礁石
  | 'gate' // 关闭的水闸
  | 'dock' // 他人码头
  | 'boat' // 前船受阻,跟随失败
  | 'anchored'; // 前船被锚定,无法腾出

export type GameEvent =
  | { type: 'move'; boatId: string; from: Pos; to: Pos; dir: Direction }
  | { type: 'blocked'; boatId: string; reason: BlockReason; dir: Direction }
  | { type: 'delivered'; boatId: string; dock: Pos }
  | { type: 'gate'; gateId: string; open: boolean }
  | { type: 'pad'; pos: Pos; active: boolean }
  | { type: 'anchorUsed'; boatId: string }
  | { type: 'ineffective'; dir: Direction }
  | { type: 'complete'; moves: number };

export interface TideInput {
  dir: Direction;
  /** 待用锚目标(船 id);null 表示本次不用锚 */
  pendingAnchor: string | null;
}

export interface TideResult {
  /** 新状态;无效潮汐时为原状态(未修改) */
  state: GameState;
  /** 有效潮汐 = 至少一艘船移动或交付 */
  effective: boolean;
  /** 本次是否消耗了一次锚 */
  anchorConsumed: boolean;
  events: GameEvent[];
}

export const DIRS: Record<Direction, Pos> = {
  U: { r: -1, c: 0 },
  R: { r: 0, c: 1 },
  D: { r: 1, c: 0 },
  L: { r: 0, c: -1 }
};

export const ALL_DIRECTIONS: readonly Direction[] = ['U', 'R', 'D', 'L'];
