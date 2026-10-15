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
    canvas.dispatchEvent(
      new window.MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true })
    );
    canvas.dispatchEvent(
      new window.MouseEvent('pointerup', { clientX: 165, clientY: 103, bubbles: true })
    );
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
    h.ui.canvas.dispatchEvent(
      new window.MouseEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true })
    );
    h.ui.canvas.dispatchEvent(
      new window.MouseEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true })
    );
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
