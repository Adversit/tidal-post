// @vitest-environment happy-dom
/**
 * 界面接线冒烟测试(happy-dom,无真实 Canvas):
 * - 三种输入(按钮/键盘/滑动)调用同一规则入口,结果一致;
 * - 动画期间输入锁定与禁用态;
 * - 锚的 UI 流程;通关遮罩;撤回按钮。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { initApp, type AppHandle } from '../src/main';
import { classifySwipe } from '../src/ui';

let handle: AppHandle | null = null;

afterEach(() => {
  handle?.ui.destroy();
  handle?.renderer.stop();
  document.body.innerHTML = '';
  handle = null;
});

function setup(level = 'L01'): AppHandle {
  document.body.innerHTML = '<div id="app"></div>';
  handle = initApp(document.getElementById('app')!, level);
  return handle;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

function key(keyName: string, repeat = false) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: keyName, repeat }));
}

/**
 * 带真实 pointerId 语义的指针事件。
 * 环境缺 PointerEvent 构造器时,用显式赋值模拟,不用缺 pointerId 的 MouseEvent 顶替。
 */
export function ptr(type: string, x: number, y: number, id = 1): PointerEvent {
  if (typeof window.PointerEvent === 'function') {
    return new window.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true });
  }
  const e = new window.Event(type, { bubbles: true });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'clientX', { value: x });
  Object.defineProperty(e, 'clientY', { value: y });
  return e as unknown as PointerEvent;
}

describe('classifySwipe 滑动判定', () => {
  it('阈值以下为点击', () => {
    expect(classifySwipe(10, 0)).toBeNull();
    expect(classifySwipe(0, 0)).toBeNull();
  });
  it('主轴方向识别', () => {
    expect(classifySwipe(40, 5)).toBe('R');
    expect(classifySwipe(-40, 5)).toBe('L');
    expect(classifySwipe(5, 40)).toBe('D');
    expect(classifySwipe(5, -40)).toBe('U');
  });
  it('模糊对角线不猜方向', () => {
    expect(classifySwipe(40, 40)).toBeNull();
    expect(classifySwipe(40, 32)).toBeNull(); // 副轴占比 0.8
  });
});

describe('AC10 输入等价与锁定', () => {
  it('按钮、键盘、滑动产生同样的规则结算', async () => {
    const h = setup('L01');
    const btnR = document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="R"]')!;

    btnR.click(); // 按钮
    expect(h.controller.state.moves).toBe(1);
    await settle(); // 动画结束解锁

    key('ArrowRight'); // 键盘
    expect(h.controller.state.moves).toBe(2);
    await settle();

    expect(h.controller.complete).toBe(true); // 两格后到港
    expect(
      document.querySelector('.overlay-complete')!.classList.contains('hidden')
    ).toBe(false);
  });

  it('键盘长按 repeat 被忽略', () => {
    const h = setup('L01');
    key('ArrowRight', true);
    key('ArrowRight', true);
    expect(h.controller.state.moves).toBe(0);
  });

  it('动画期间方向按钮禁用,结算不重复', async () => {
    const h = setup('L01');
    const btnR = document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="R"]')!;
    btnR.click();
    expect(h.controller.locked).toBe(true);
    expect(btnR.disabled).toBe(true);
    btnR.click(); // 禁用态点击无效
    expect(h.controller.state.moves).toBe(1);
    await settle();
    expect(h.controller.locked).toBe(false);
    expect(btnR.disabled).toBe(false);
  });

  it('棋盘滑动触发一次潮汐', () => {
    const h = setup('L01');
    const canvas = h.ui.canvas;
    canvas.dispatchEvent(ptr('pointerdown', 100, 100, 1));
    canvas.dispatchEvent(ptr('pointerup', 165, 103, 1));
    expect(h.controller.state.moves).toBe(1);
  });
});

describe('锚的 UI 流程(L05)', () => {
  it('点锚 → 点船 → 选潮向,消耗一次', async () => {
    const h = setup('L05');
    const anchorBtn = document.querySelector<HTMLButtonElement>('.btn-anchor')!;
    anchorBtn.click();
    expect(h.controller.anchorSelecting).toBe(true);

    // 点击船 A 的画布位置
    const r = h.renderer;
    const cx = r.originX + (2 + 0.5) * r.cell;
    const cy = r.originY + (1 + 0.5) * r.cell;
    h.ui.canvas.dispatchEvent(ptr('pointerdown', cx, cy, 1));
    h.ui.canvas.dispatchEvent(ptr('pointerup', cx, cy, 1));
    expect(h.controller.pendingAnchor).toBe('A');

    document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="R"]')!.click();
    expect(h.controller.state.anchorsLeft).toBe(0);
    const a = h.controller.state.boats.find((b) => b.id === 'A')!;
    const b = h.controller.state.boats.find((x) => x.id === 'B')!;
    expect(a.pos).toEqual({ r: 1, c: 2 }); // A 锚定未动
    expect(b.pos).toEqual({ r: 3, c: 3 }); // B 正常移动
    await settle();
  });

  it('L01-L04 锚按钮禁用且提示后续解锁', () => {
    setup('L01');
    const anchorBtn = document.querySelector<HTMLButtonElement>('.btn-anchor')!;
    expect(anchorBtn.disabled).toBe(true);
    expect(anchorBtn.querySelector('.badge')!.textContent).toContain('L05');
  });
});

describe('撤回与界面状态', () => {
  it('撤回按钮恢复上一有效潮汐前状态', async () => {
    const h = setup('L03');
    document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="U"]')!.click();
    expect(h.controller.state.moves).toBe(1);
    await settle();
    const undoBtn = document.querySelector<HTMLButtonElement>('.btn-undo')!;
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    expect(h.controller.state.moves).toBe(0);
    const a = h.controller.state.boats.find((b) => b.id === 'A')!;
    expect(a.pos).toEqual({ r: 2, c: 1 });
  });

  it('通关后撤回入口可用并关闭完成遮罩', async () => {
    const h = setup('L01');
    const btnR = document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="R"]')!;
    btnR.click();
    await settle();
    btnR.click();
    await settle();
    expect(h.controller.complete).toBe(true);
    document.querySelector<HTMLButtonElement>('.btn-complete-undo')!.click();
    expect(h.controller.complete).toBe(false);
    expect(document.querySelector('.overlay-complete')!.classList.contains('hidden')).toBe(true);
  });
});

describe('R1 无 Canvas 路径的切关集成', () => {
  it('通关后立即进入下一关:新关状态与展示正确', async () => {
    const h = setup('L01');
    const btnR = document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="R"]')!;
    btnR.click();
    await settle();
    btnR.click(); // 通关
    expect(h.controller.complete).toBe(true);
    document.querySelector<HTMLButtonElement>('.btn-next')!.click(); // 不等动画回调即切关
    await settle(); // 旧回调到达
    expect(h.controller.level.id).toBe('L02');
    expect(h.controller.state.moves).toBe(0);
    expect(h.controller.deliveredCount()).toBe(0);
    expect(h.renderer.getDisplay('A')).toMatchObject({ r: 3, c: 1, alpha: 1 }); // 船在起点且可见
    document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="U"]')!.click();
    expect(h.controller.state.moves).toBe(1); // 新关可正常操作
  });
});

describe('R3 弹层键盘输入隔离', () => {
  it('选关弹层期间方向键与 WASD 均不影响游戏,待用锚不丢失', () => {
    const h = setup('L05');
    h.controller.toggleAnchorSelect();
    h.controller.pickAnchorTarget('A');
    document.querySelector<HTMLButtonElement>('.btn-levels')!.click(); // 打开选关
    key('ArrowRight');
    key('d');
    key('a');
    key('ArrowLeft');
    key('w');
    key('s');
    expect(h.controller.state.moves).toBe(0);
    expect(h.controller.history.length).toBe(0);
    expect(h.controller.state.anchorsLeft).toBe(1);
    expect(h.controller.pendingAnchor).toBe('A');
    document.querySelector<HTMLButtonElement>('.btn-close-levels')!.click(); // 关闭后恢复
    key('ArrowRight');
    expect(h.controller.state.moves).toBe(1);
    expect(h.controller.state.anchorsLeft).toBe(0); // 锚被正常消耗
  });

  it('完成弹层与选关弹层切换期间输入仍隔离,且无状态冲突', async () => {
    const h = setup('L01');
    const btnR = document.querySelector<HTMLButtonElement>('.dpad-btn[data-dir="R"]')!;
    btnR.click();
    await settle();
    btnR.click();
    await settle();
    expect(h.controller.complete).toBe(true);
    key('ArrowLeft'); // 完成弹层打开中
    expect(h.controller.state.moves).toBe(2);
    document.querySelector<HTMLButtonElement>('.btn-complete-levels')!.click(); // 切到选关
    expect(document.querySelector('.overlay-levels')!.classList.contains('hidden')).toBe(false);
    key('ArrowRight');
    expect(h.controller.state.moves).toBe(2);
    document.querySelector<HTMLButtonElement>('.btn-close-levels')!.click(); // 返回 → 完成弹层恢复
    expect(document.querySelector('.overlay-complete')!.classList.contains('hidden')).toBe(false);
    document.querySelector<HTMLButtonElement>('.btn-complete-undo')!.click(); // 撤回仍可用
    expect(h.controller.complete).toBe(false);
  });
});

describe('R4 被拒绝的斜滑不当作点击', () => {
  it('模糊斜滑不选择、不更换、不取消锚目标;真点击行为不变', () => {
    const h = setup('L05');
    document.querySelector<HTMLButtonElement>('.btn-anchor')!.click();
    const r = h.renderer;
    const ax = r.originX + (2 + 0.5) * r.cell;
    const ay = r.originY + (1 + 0.5) * r.cell;

    // 未选目标:模糊斜滑结束在 A 上(dx40, dy32)
    h.ui.canvas.dispatchEvent(ptr('pointerdown', ax - 40, ay - 32, 1));
    h.ui.canvas.dispatchEvent(ptr('pointerup', ax, ay, 1));
    expect(h.controller.pendingAnchor).toBeNull();

    // 已有目标 B:斜滑到 A 不更换
    h.controller.pickAnchorTarget('B');
    h.ui.canvas.dispatchEvent(ptr('pointerdown', ax - 40, ay - 32, 1));
    h.ui.canvas.dispatchEvent(ptr('pointerup', ax, ay, 1));
    expect(h.controller.pendingAnchor).toBe('B');

    // 真正点击 A:更换为 A;再点取消
    h.ui.canvas.dispatchEvent(ptr('pointerdown', ax, ay, 1));
    h.ui.canvas.dispatchEvent(ptr('pointerup', ax, ay, 1));
    expect(h.controller.pendingAnchor).toBe('A');
    h.ui.canvas.dispatchEvent(ptr('pointerdown', ax, ay, 1));
    h.ui.canvas.dispatchEvent(ptr('pointerup', ax, ay, 1));
    expect(h.controller.pendingAnchor).toBeNull();

    // 有效四向滑动仍走统一入口结算
    h.ui.canvas.dispatchEvent(ptr('pointerdown', 100, 100, 1));
    h.ui.canvas.dispatchEvent(ptr('pointerup', 160, 102, 1));
    expect(h.controller.state.moves).toBe(1);
  });
});

describe('R5 指针手势清理', () => {
  it('棋盘内按下、棋盘外松开后,普通单击不产生额外移动', () => {
    const h = setup('L03');
    const canvas = h.ui.canvas;
    canvas.dispatchEvent(ptr('pointerdown', 100, 100, 7));
    // 捕获不可用的环境下,外部松开经 window 兜底送达
    window.dispatchEvent(ptr('pointerup', 400, 400, 7));
    expect(h.controller.state.moves).toBe(0);
    // 若旧起点残留:(200,103)-(100,100) 会被误判为有效右滑
    canvas.dispatchEvent(ptr('pointerdown', 200, 103, 7));
    canvas.dispatchEvent(ptr('pointerup', 203, 105, 7)); // 小位移点击
    expect(h.controller.state.moves).toBe(0); // 不得用旧起点误算滑动
  });

  it('pointercancel 与 lostpointercapture 后重新操作正常', async () => {
    const h = setup('L03');
    const canvas = h.ui.canvas;
    canvas.dispatchEvent(ptr('pointerdown', 100, 100, 3));
    canvas.dispatchEvent(ptr('pointercancel', 100, 100, 3));
    canvas.dispatchEvent(ptr('pointerdown', 200, 200, 3));
    canvas.dispatchEvent(ptr('pointerup', 260, 202, 3)); // 有效右滑
    expect(h.controller.state.moves).toBe(1);
    await settle(); // 动画解锁后再验证下一段手势

    canvas.dispatchEvent(ptr('pointerdown', 100, 100, 4));
    canvas.dispatchEvent(ptr('lostpointercapture', 100, 100, 4));
    // 若旧起点残留:(303,105)-(100,100) 会被误判为有效右滑
    canvas.dispatchEvent(ptr('pointerdown', 300, 103, 4));
    canvas.dispatchEvent(ptr('pointerup', 303, 105, 4)); // 点击,不移动
    expect(h.controller.state.moves).toBe(1);
  });

  it('非当前 pointerId 的事件不结束、不提交当前手势', () => {
    const h = setup('L03');
    const canvas = h.ui.canvas;
    canvas.dispatchEvent(ptr('pointerdown', 100, 100, 1));
    canvas.dispatchEvent(ptr('pointerup', 500, 100, 2)); // 其他指针
    expect(h.controller.state.moves).toBe(0);
    canvas.dispatchEvent(ptr('pointerup', 160, 102, 1)); // 本指针结束才提交
    expect(h.controller.state.moves).toBe(1);
  });
});
