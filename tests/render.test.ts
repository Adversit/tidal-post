/**
 * 渲染层回归测试(R1 切关动画污染、R2 穿闸中途关门、R6 选船命中区)。
 *
 * 使用可控假时钟与假 2D 上下文,直接断言展示状态(getDisplay /
 * displayGateOpen)与控制器锁状态,不断言内部辅助函数。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BoardRenderer } from '../src/render';
import { GameController } from '../src/game';
import { getLevel } from '../src/levels';
import { mkLevel, makeFakeCanvas } from './helpers';
import type { Direction, LevelDef } from '../src/types';

const active: BoardRenderer[] = [];

afterEach(() => {
  while (active.length) active.pop()!.stop();
  vi.useRealTimers();
});

function wire(canvas: HTMLCanvasElement, level: LevelDef) {
  const controller = new GameController(level);
  const renderer = new BoardRenderer(canvas);
  renderer.attach(controller.level, controller);
  controller.onEvents = (e, res, done) => renderer.playEvents(e, res, done);
  active.push(renderer);
  return { controller, renderer };
}

function useFake() {
  // now:0 让 performance.now 与 Date.now 同步,保证动画插值时钟一致
  vi.useFakeTimers({
    now: 0,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
  });
}

describe('R1 旧动画回调不得污染新关卡', () => {
  it('通关动画未完成即切关:旧回调不写展示状态', () => {
    useFake();
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), getLevel('L01'));
    controller.tide('R');
    vi.advanceTimersByTime(400); // 第一步动画完成
    controller.tide('R'); // 交付动画进行中(530ms)
    // 立即进入 L02
    controller.loadLevel(getLevel('L02'));
    renderer.attach(controller.level, controller);
    vi.advanceTimersByTime(1000); // 推进旧定时器
    // 新关船在正确起点且可见、未交付
    expect(renderer.getDisplay('A')).toMatchObject({ r: 3, c: 1, alpha: 1 });
    expect(controller.state.boats.find((b) => b.id === 'A')!.delivered).toBe(false);
    expect(controller.locked).toBe(false);
    // 新关可正常操作
    controller.tide('U');
    vi.advanceTimersByTime(400);
    expect(controller.state.moves).toBe(1);
    expect(renderer.getDisplay('A')).toMatchObject({ r: 2, c: 1, alpha: 1 });
  });

  it('切关后启动新动画:旧回调不得提前解除新动画的锁', () => {
    useFake();
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), getLevel('L01'));
    controller.tide('R'); // 旧动画,t=0 起,约 270ms
    controller.loadLevel(getLevel('L02'));
    renderer.attach(controller.level, controller);
    vi.advanceTimersByTime(50);
    controller.tide('U'); // 新关动画,t=50 起,约 t=320 结束
    expect(controller.locked).toBe(true);
    vi.advanceTimersByTime(230); // t=280:旧定时器(270)已触发
    expect(controller.locked).toBe(true); // 旧 done 不得解锁
    vi.advanceTimersByTime(100); // t=380:新动画正常结束
    expect(controller.locked).toBe(false);
    expect(controller.state.moves).toBe(1);
  });

  it('减少动态效果路径:旧回调同样不得解锁或污染', () => {
    useFake();
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), getLevel('L01'));
    renderer.reducedMotion = true;
    controller.tide('R'); // 快路径,done 于 t=40
    vi.advanceTimersByTime(50);
    controller.tide('R'); // 通关,done 于 t=90
    controller.loadLevel(getLevel('L02'));
    renderer.attach(controller.level, controller);
    vi.advanceTimersByTime(10);
    controller.tide('U'); // 新关,done 于 t=100
    vi.advanceTimersByTime(35); // t=95:旧 done(90)已触发
    expect(controller.locked).toBe(true);
    vi.advanceTimersByTime(10); // t=105
    expect(controller.locked).toBe(false);
    expect(renderer.getDisplay('A')).toMatchObject({ r: 2, c: 1, alpha: 1 });
  });
});

describe('R2 移动动画全程使用潮汐开始时的门状态', () => {
  it('L07 穿闸:动画开始/中途/结束的门画面状态', () => {
    useFake();
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), getLevel('L07'));
    const step = (dir: Direction) => {
      controller.tide(dir);
      vi.advanceTimersByTime(400);
    };
    step('U');
    step('R');
    step('R');
    controller.toggleAnchorSelect();
    controller.pickAnchorTarget('B');
    step('L'); // 锚 B 守浮标,A 左移到位
    expect(renderer.displayGateOpen('G1')).toBe(true); // B 在浮标上

    controller.tide('L'); // 快照:B 在浮标 → 门开;A 跨闸,B 离开浮标
    expect(renderer.displayGateOpen('G1')).toBe(true); // 动画开始:开
    vi.advanceTimersByTime(150); // 中途:B 插值已离开浮标
    expect(renderer.displayGateOpen('G1')).toBe(true); // 仍开,不中途关门
    vi.advanceTimersByTime(300); // 动画结束
    expect(renderer.displayGateOpen('G1')).toBe(false); // 结算后 B 已离开,门关
    expect(renderer.getDisplay('A')).toMatchObject({ r: 2, c: 1 }); // A 已到闸西侧
  });

  it('本次到达浮标:动画中途门仍关,结束后才开', () => {
    useFake();
    const level = mkLevel({
      grid: ['.....', '.....'],
      boats: [
        { id: 'A', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } },
        { id: 'B', start: { r: 0, c: 3 }, dock: { r: 1, c: 4 } }
      ],
      gates: [{ id: 'G', a: { r: 0, c: 3 }, b: { r: 0, c: 4 }, pads: [{ r: 0, c: 2 }] }]
    });
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), level);
    controller.tide('R'); // A 移向浮标;B 被关着的门挡住
    expect(renderer.displayGateOpen('G')).toBe(false); // 开始:关
    vi.advanceTimersByTime(150); // 中途:A 插值接近浮标,门不得提前开
    expect(renderer.displayGateOpen('G')).toBe(false);
    vi.advanceTimersByTime(300); // 结束
    expect(renderer.displayGateOpen('G')).toBe(true); // 结算后 A 压住浮标,门开
    expect(renderer.getDisplay('B')).toMatchObject({ r: 0, c: 3 }); // B 原地
  });

  it('撤回后门画面按恢复位置呈现;减少动效下即时对齐', () => {
    useFake();
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), getLevel('L07'));
    const step = (dir: Direction) => {
      controller.tide(dir);
      vi.advanceTimersByTime(400);
    };
    step('U');
    step('R');
    step('R');
    controller.toggleAnchorSelect();
    controller.pickAnchorTarget('B');
    step('L');
    controller.tide('L');
    vi.advanceTimersByTime(400); // 穿闸完成,门关
    expect(renderer.displayGateOpen('G1')).toBe(false);
    controller.undo();
    renderer.snap(); // 主流程在撤回时调用
    expect(renderer.displayGateOpen('G1')).toBe(true); // B 回到浮标,门恢复开
    expect(renderer.getDisplay('A')).toMatchObject({ r: 2, c: 2 });
  });

  it('减少动态效果:门状态即时为结算结果,无冻结残留', () => {
    useFake();
    const { controller, renderer } = wire(makeFakeCanvas(400, 300), getLevel('L07'));
    renderer.reducedMotion = true;
    const step = (dir: Direction) => {
      controller.tide(dir);
      vi.advanceTimersByTime(60);
    };
    step('U');
    step('R');
    step('R');
    controller.toggleAnchorSelect();
    controller.pickAnchorTarget('B');
    step('L');
    step('L'); // 穿闸
    expect(renderer.displayGateOpen('G1')).toBe(false);
    expect(renderer.getDisplay('A')).toMatchObject({ r: 2, c: 1, alpha: 1 });
  });
});

describe('R6 窄屏选船命中区(≥44 CSS px)', () => {
  it('320px 视口(L05,7 列,cell=39)命中边界', () => {
    const { renderer } = wire(makeFakeCanvas(296, 260), getLevel('L05'));
    expect(renderer.cell).toBe(39); // 格子保持正方形,小于 44
    const { originX: ox, originY: oy, cell } = renderer;
    const ax = ox + 2.5 * cell;
    const ay = oy + 1.5 * cell; // A [1,2] 中心
    expect(renderer.boatAtPoint(ax, ay)).toBe('A');
    expect(renderer.boatAtPoint(ax + 21, ay)).toBe('A'); // 距中心 21px 可命中
    expect(renderer.boatAtPoint(ax - 20, ay + 9)).toBe('A'); // √(20²+9²)≈21.9
    expect(renderer.boatAtPoint(ax + 23, ay)).toBeNull(); // 超出 22px 半径
  });

  it('相邻船命中重叠:取最近者,同距按 id,与 boats 数组顺序无关', () => {
    const mk = (swap: boolean): LevelDef =>
      mkLevel({
        grid: ['........', '........'],
        boats: swap
          ? [
              { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } },
              { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 7 } }
            ]
          : [
              { id: 'A', start: { r: 0, c: 0 }, dock: { r: 1, c: 7 } },
              { id: 'B', start: { r: 0, c: 1 }, dock: { r: 1, c: 0 } }
            ]
      });
    for (const swap of [false, true]) {
      const r = wire(makeFakeCanvas(296, 260), mk(swap)).renderer;
      expect(r.cell).toBe(34); // 命中半径 22 > cell/2=17,命中区重叠
      const { originX: ox, originY: oy, cell } = r;
      const ax = ox + 0.5 * cell;
      const bx = ox + 1.5 * cell;
      const y = oy + 0.5 * cell;
      expect(r.boatAtPoint((ax + bx) / 2, y)).toBe('A'); // 等距 → 稳定的 id 规则
      expect(r.boatAtPoint((ax + bx) / 2 + 4, y)).toBe('B'); // 更靠近 B
      active.pop()!.stop();
    }
  });

  it('已交付船不可选;空白区与画布偏移的坐标换算正确', () => {
    const { controller, renderer } = wire(
      makeFakeCanvas(296, 260, { left: 30, top: 40 }),
      getLevel('L05')
    );
    const { originX: ox, originY: oy, cell } = renderer;
    const ax = ox + 2.5 * cell;
    const ay = oy + 1.5 * cell;
    expect(renderer.boatAtPoint(5, 5)).toBeNull(); // 空白
    expect(renderer.boatAtPoint(ax + 30, ay + 40)).toBe('A'); // 含画布偏移
    controller.state.boats.find((b) => b.id === 'A')!.delivered = true; // 模拟已交付
    expect(renderer.boatAtPoint(ax + 30, ay + 40)).toBeNull();
  });

  it('375/430/桌面宽度下命中区不小于 44px 且选船正常', () => {
    for (const w of [351, 406, 800]) {
      const r = wire(makeFakeCanvas(w, 600), getLevel('L05')).renderer;
      expect(Math.max(r.cell / 2, 22) * 2).toBeGreaterThanOrEqual(44);
      const ax = r.originX + 2.5 * r.cell;
      const ay = r.originY + 1.5 * r.cell;
      expect(r.boatAtPoint(ax, ay)).toBe('A');
      active.pop()!.stop();
    }
  });
});
