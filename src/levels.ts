/**
 * 潮汐邮局 - 首批 8 关固定数据与数据校验。
 *
 * 布局与规则为上层确定的实施输入,未经说明不得修改。
 */
import type { LevelDef, Pos } from './types';
import { gridCols, gridRows, inBounds, isWater, posEq } from './rules';

export const LEVELS: LevelDef[] = [
  {
    id: 'L01',
    title: '第一封信',
    grid: ['#####', '#...#', '#####'],
    boats: [{ id: 'A', start: { r: 1, c: 1 }, dock: { r: 1, c: 3 } }],
    gates: [],
    anchorCharges: 0,
    referenceSolution: ['R', 'R'],
    teaching: '滑动或按方向键,潮水会推所有船走一格。把信送进同样邮戳的码头。'
  },
  {
    id: 'L02',
    title: '绕过礁石',
    grid: ['#####', '#...#', '#.#.#', '#...#', '#####'],
    boats: [{ id: 'A', start: { r: 3, c: 1 }, dock: { r: 1, c: 3 } }],
    gates: [],
    anchorCharges: 0,
    referenceSolution: ['U', 'U', 'R', 'R'],
    teaching: '船每次只走一格,不会滑到底。绕开礁石,别急着一路冲。'
  },
  {
    id: 'L03',
    title: '一起出发',
    grid: ['#####', '#...#', '#...#', '#...#', '#####'],
    boats: [
      { id: 'A', start: { r: 2, c: 1 }, dock: { r: 1, c: 3 } },
      { id: 'B', start: { r: 3, c: 1 }, dock: { r: 2, c: 3 } }
    ],
    gates: [],
    anchorCharges: 0,
    referenceSolution: ['U', 'R', 'R'],
    teaching: '所有船跟着同一股潮水。前船挪开,后船才能跟上;各送各的码头。'
  },
  {
    id: 'L04',
    title: '水闸值班',
    grid: ['#######', '#...#.#', '#.....#', '#...#.#', '#######'],
    boats: [
      { id: 'A', start: { r: 1, c: 2 }, dock: { r: 3, c: 3 } },
      { id: 'B', start: { r: 2, c: 2 }, dock: { r: 1, c: 5 } }
    ],
    gates: [
      {
        id: 'G1',
        a: { r: 2, c: 3 },
        b: { r: 2, c: 4 },
        pads: [{ r: 1, c: 3 }]
      }
    ],
    anchorCharges: 0,
    referenceSolution: ['R', 'R', 'R', 'U', 'D', 'D'],
    teaching: '潮起那一刻有船守着浮标,这一次水闸就开。下一关起学会潮汐锚。'
  },
  {
    id: 'L05',
    title: '一枚潮汐锚',
    grid: ['#######', '#...###', '#######', '#.....#', '#######'],
    boats: [
      { id: 'A', start: { r: 1, c: 2 }, dock: { r: 1, c: 1 } },
      { id: 'B', start: { r: 3, c: 2 }, dock: { r: 3, c: 5 } }
    ],
    gates: [
      {
        id: 'G1',
        a: { r: 3, c: 3 },
        b: { r: 3, c: 4 },
        pads: [{ r: 1, c: 2 }]
      }
    ],
    anchorCharges: 1,
    referenceSolution: ['R@A', 'R', 'R', 'L', 'L'],
    teaching: '点锚、再点一艘船,它会原地留一拍,替你守住浮标。'
  },
  {
    id: 'L06',
    title: '多留一步',
    grid: ['...', '.#.', '.#.', '.#.'],
    boats: [
      { id: 'A', start: { r: 3, c: 2 }, dock: { r: 1, c: 2 } },
      { id: 'B', start: { r: 2, c: 0 }, dock: { r: 0, c: 0 } }
    ],
    gates: [
      {
        id: 'G1',
        a: { r: 1, c: 2 },
        b: { r: 2, c: 2 },
        pads: [{ r: 3, c: 0 }]
      }
    ],
    anchorCharges: 1,
    referenceSolution: ['D', 'U@B', 'U', 'U', 'U'],
    teaching: '先让船压住浮标,再想想把锚留给谁。'
  },
  {
    id: 'L07',
    title: '守住浮标',
    grid: ['#...', '#.##', '....', '..##'],
    boats: [
      { id: 'A', start: { r: 2, c: 3 }, dock: { r: 3, c: 0 } },
      { id: 'B', start: { r: 1, c: 1 }, dock: { r: 3, c: 1 } }
    ],
    gates: [
      {
        id: 'G1',
        a: { r: 2, c: 1 },
        b: { r: 2, c: 2 },
        pads: [{ r: 0, c: 3 }]
      }
    ],
    anchorCharges: 1,
    referenceSolution: ['U', 'R', 'R', 'L@B', 'L', 'L', 'D', 'D', 'D'],
    teaching: '守住浮标,另一艘才能安心穿闸;送完再回来接它。'
  },
  {
    id: 'L08',
    title: '最后一封信',
    grid: ['.#...', '...#.', '...#.', '.....'],
    boats: [
      { id: 'A', start: { r: 0, c: 4 }, dock: { r: 2, c: 0 } },
      { id: 'B', start: { r: 3, c: 4 }, dock: { r: 2, c: 4 } }
    ],
    gates: [
      {
        id: 'G1',
        a: { r: 0, c: 2 },
        b: { r: 1, c: 2 },
        pads: [{ r: 3, c: 3 }]
      }
    ],
    anchorCharges: 1,
    referenceSolution: ['L', 'L@B', 'D', 'R', 'U', 'D', 'L', 'L'],
    teaching: '想想谁先回家、谁在替谁守门。顺序也是线索。'
  }
];

export function getLevel(id: string): LevelDef {
  const lv = LEVELS.find((l) => l.id === id);
  if (!lv) throw new Error(`未知关卡: ${id}`);
  return lv;
}

/**
 * 关卡数据校验(AC12)。返回错误列表,空数组表示合法。
 */
export function validateLevel(level: LevelDef): string[] {
  const errors: string[] = [];
  const rows = gridRows(level);
  const cols = gridCols(level);

  if (rows === 0 || cols === 0) {
    errors.push('grid 为空');
    return errors;
  }
  level.grid.forEach((row, i) => {
    if (row.length !== cols) errors.push(`grid 第 ${i} 行长度 ${row.length},与首行 ${cols} 不一致(非矩形)`);
    for (const ch of row) {
      if (ch !== '#' && ch !== '.') errors.push(`grid 第 ${i} 行含非法字符 '${ch}'`);
    }
  });

  const boatIds = new Set<string>();
  const starts: Pos[] = [];
  const docks: Pos[] = [];
  for (const b of level.boats) {
    if (boatIds.has(b.id)) errors.push(`船 id 重复: ${b.id}`);
    boatIds.add(b.id);
    if (!inBounds(level, b.start)) errors.push(`船 ${b.id} 起点越界 [${b.start.r},${b.start.c}]`);
    else if (!isWater(level, b.start)) errors.push(`船 ${b.id} 起点不在水格 [${b.start.r},${b.start.c}]`);
    if (!inBounds(level, b.dock)) errors.push(`船 ${b.id} 码头越界 [${b.dock.r},${b.dock.c}]`);
    else if (!isWater(level, b.dock)) errors.push(`船 ${b.id} 码头不在水格 [${b.dock.r},${b.dock.c}]`);
    if (starts.some((s) => posEq(s, b.start))) errors.push(`起点重叠 [${b.start.r},${b.start.c}]`);
    starts.push(b.start);
    if (docks.some((d) => posEq(d, b.dock))) errors.push(`码头重叠 [${b.dock.r},${b.dock.c}]`);
    docks.push(b.dock);
    if (posEq(b.start, b.dock)) errors.push(`船 ${b.id} 出生在码头`);
  }
  for (const s of starts) {
    if (docks.some((d) => posEq(d, s))) errors.push(`有船出生在码头 [${s.r},${s.c}]`);
  }

  const gateIds = new Set<string>();
  for (const g of level.gates) {
    if (gateIds.has(g.id)) errors.push(`水闸 id 重复: ${g.id}`);
    gateIds.add(g.id);
    for (const [label, p] of [['a', g.a], ['b', g.b]] as const) {
      if (!inBounds(level, p)) errors.push(`水闸 ${g.id} 端点 ${label} 越界 [${p.r},${p.c}]`);
      else if (!isWater(level, p)) errors.push(`水闸 ${g.id} 端点 ${label} 不在水格 [${p.r},${p.c}]`);
    }
    const adjacent = Math.abs(g.a.r - g.b.r) + Math.abs(g.a.c - g.b.c) === 1;
    if (!adjacent) errors.push(`水闸 ${g.id} 两端不正交相邻`);
    if (g.pads.length !== 1) errors.push(`水闸 ${g.id} 浮标数 ${g.pads.length},本批要求恰好 1 个`);
    for (const pad of g.pads) {
      if (!inBounds(level, pad)) errors.push(`水闸 ${g.id} 浮标越界 [${pad.r},${pad.c}]`);
      else if (!isWater(level, pad)) errors.push(`水闸 ${g.id} 浮标不在水格 [${pad.r},${pad.c}]`);
    }
  }

  if (!Number.isInteger(level.anchorCharges) || level.anchorCharges < 0) {
    errors.push(`anchorCharges 非法: ${level.anchorCharges}`);
  }
  for (const step of level.referenceSolution) {
    if (!/^[URDL](@[A-Za-z0-9_-]+)?$/.test(step)) errors.push(`参考解步骤非法: ${step}`);
    const at = step.indexOf('@');
    if (at >= 0) {
      const id = step.slice(at + 1);
      if (!boatIds.has(id)) errors.push(`参考解锚定未知船: ${step}`);
    }
  }
  return errors;
}
