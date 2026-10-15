/**
 * 潮汐邮局 - 界面与输入。
 *
 * 三种潮向输入(滑动 / 四向按钮 / 键盘方向键与 WASD)
 * 全部汇入同一个 dispatchDir → controller.tide()。
 */
import type { Direction, GameEvent, LevelDef } from './types';
import type { GameController } from './game';
import type { BoardRenderer } from './render';

const SWIPE_THRESHOLD = 24;

/** 滑动方向判定:最小阈值 + 主轴识别,模糊对角线不猜方向 */
export function classifySwipe(dx: number, dy: number, threshold = SWIPE_THRESHOLD): Direction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  if (ax === ay) return null;
  if (ax > ay) {
    if (ay / ax > 0.7) return null; // 模糊对角
    return dx > 0 ? 'R' : 'L';
  }
  if (ax / ay > 0.7) return null;
  return dy > 0 ? 'D' : 'U';
}

export interface UIOptions {
  root: HTMLElement;
  levels: LevelDef[];
  controller: GameController;
  onLevelPicked: (id: string) => void;
  /** 撤回/重来成功后,主程序同步渲染层 */
  onUndoOrRestart: () => void;
  getReducedMotion: () => boolean;
  onToggleMotion: () => void;
}

export interface UI {
  canvas: HTMLCanvasElement;
  setRenderer: (renderer: BoardRenderer) => void;
  refresh: () => void;
  handleEvents: (events: GameEvent[]) => void;
  destroy: () => void;
}

const KEYMAP: Record<string, Direction> = {
  ArrowUp: 'U',
  ArrowRight: 'R',
  ArrowDown: 'D',
  ArrowLeft: 'L',
  w: 'U',
  d: 'R',
  s: 'D',
  a: 'L',
  W: 'U',
  D: 'R',
  S: 'D',
  A: 'L'
};

const BLOCKED_HINT: Record<string, string> = {
  bounds: '到边了,潮水推不动',
  land: '礁石挡路,过不去',
  gate: '水闸关着:潮起时要有船守住浮标',
  dock: '那是别的船的码头',
  boat: '前面的船被挡住了',
  anchored: '锚定的船这一拍不动'
};

const ANCHOR_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5.2" r="2.1"/><path d="M12 7.3v11.2M8.4 10.4h7.2"/><path d="M5.6 14.2a6.4 6.4 0 0 0 12.8 0"/></g></svg>';

export function buildUI(opts: UIOptions): UI {
  const { root, levels, controller } = opts;
  let renderer: BoardRenderer | null = null;
  const disposers: Array<() => void> = [];
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  root.innerHTML = `
  <div class="game-shell">
    <header class="topbar">
      <button type="button" class="chip btn-levels" aria-label="选择关卡">选关</button>
      <h1 class="level-title"></h1>
      <span class="chip chip-count" aria-label="已投递数量"></span>
      <button type="button" class="chip btn-motion" aria-label="切换动态效果"></button>
    </header>
    <main class="board-wrap"><canvas class="board" aria-label="潮汐棋盘"></canvas></main>
    <div class="hint" role="status" aria-live="polite"></div>
    <footer class="controls">
      <div class="tool-cluster">
        <button type="button" class="btn btn-anchor" aria-label="潮汐锚">
          ${ANCHOR_SVG}<span class="btn-label">锚</span><span class="badge"></span>
        </button>
        <button type="button" class="btn btn-undo" aria-label="撤回一步">撤回</button>
        <button type="button" class="btn btn-restart" aria-label="重来本关">重来</button>
      </div>
      <div class="dpad">
        <button type="button" class="btn dpad-btn dpad-u" data-dir="U" aria-label="向上潮汐">↑</button>
        <button type="button" class="btn dpad-btn dpad-l" data-dir="L" aria-label="向左潮汐">←</button>
        <button type="button" class="btn dpad-btn dpad-r" data-dir="R" aria-label="向右潮汐">→</button>
        <button type="button" class="btn dpad-btn dpad-d" data-dir="D" aria-label="向下潮汐">↓</button>
      </div>
    </footer>
    <div class="overlay overlay-levels hidden" role="dialog" aria-label="选择关卡">
      <div class="panel">
        <h2>选择关卡</h2>
        <div class="level-grid"></div>
        <button type="button" class="btn btn-close-levels">返回</button>
      </div>
    </div>
    <div class="overlay overlay-complete hidden" role="dialog" aria-label="投递完成">
      <div class="panel">
        <h2>投递完成</h2>
        <p class="complete-text"></p>
        <div class="complete-actions">
          <button type="button" class="btn btn-next">下一关</button>
          <button type="button" class="btn btn-complete-undo">撤回</button>
          <button type="button" class="btn btn-complete-restart">重来</button>
          <button type="button" class="btn btn-complete-levels">选关</button>
        </div>
      </div>
    </div>
  </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`UI 元素缺失: ${sel}`);
    return el;
  };

  const canvas = $<HTMLCanvasElement>('.board');
  const titleEl = $('.level-title');
  const countEl = $('.chip-count');
  const hintEl = $('.hint');
  const anchorBtn = $<HTMLButtonElement>('.btn-anchor');
  const anchorBadge = $('.badge');
  const undoBtn = $<HTMLButtonElement>('.btn-undo');
  const restartBtn = $<HTMLButtonElement>('.btn-restart');
  const motionBtn = $<HTMLButtonElement>('.btn-motion');
  const dpadBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.dpad-btn'));
  const levelsOverlay = $('.overlay-levels');
  const completeOverlay = $('.overlay-complete');
  const levelGrid = $('.level-grid');
  const completeText = $('.complete-text');
  const nextBtn = $<HTMLButtonElement>('.btn-next');

  // 关卡选择按钮
  for (const lv of levels) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn level-item';
    b.dataset.level = lv.id;
    b.textContent = `${lv.id} · ${lv.title}`;
    levelGrid.appendChild(b);
  }

  /** 唯一潮向出口 */
  const dispatchDir = (dir: Direction) => {
    controller.tide(dir);
  };

  const showHint = (text: string, revertMs = 0) => {
    hintEl.textContent = text;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    if (revertMs > 0) {
      hintTimer = setTimeout(() => {
        hintTimer = null;
        hintEl.textContent = baseHint();
      }, revertMs);
    }
  };

  const baseHint = (): string => {
    if (controller.anchorSelecting) {
      return controller.pendingAnchor
        ? `已下锚给 ${controller.pendingAnchor},选一个潮向`
        : '点一艘船,把潮汐锚交给它(再点一次取消)';
    }
    return controller.level.teaching;
  };

  // ---------- 输入:四向按钮 ----------
  for (const btn of dpadBtns) {
    const dir = btn.dataset.dir as Direction;
    const handler = () => dispatchDir(dir);
    btn.addEventListener('click', handler);
    disposers.push(() => btn.removeEventListener('click', handler));
  }

  // ---------- 输入:键盘 ----------
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return; // 长按不堆积
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (e.key === 'Escape') {
      closeOverlays();
      controller.clearPendingAnchor();
      return;
    }
    const dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      dispatchDir(dir);
    }
  };
  window.addEventListener('keydown', onKey);
  disposers.push(() => window.removeEventListener('keydown', onKey));

  // ---------- 输入:棋盘滑动 / 点船下锚 ----------
  let swipePointer: { id: number; x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (swipePointer) return; // 不处理多指
    swipePointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!swipePointer || e.pointerId !== swipePointer.id) return;
    const dx = e.clientX - swipePointer.x;
    const dy = e.clientY - swipePointer.y;
    swipePointer = null;
    const dir = classifySwipe(dx, dy);
    if (dir) {
      dispatchDir(dir);
      return;
    }
    // 视为点击:锚选船模式下点船
    if (controller.anchorSelecting && renderer) {
      const id = renderer.boatAtPoint(e.clientX, e.clientY);
      if (id) controller.pickAnchorTarget(id);
    }
  };
  const onPointerCancel = () => {
    swipePointer = null;
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  disposers.push(() => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
  });

  // ---------- 工具按钮 ----------
  const onAnchor = () => controller.toggleAnchorSelect();
  anchorBtn.addEventListener('click', onAnchor);
  disposers.push(() => anchorBtn.removeEventListener('click', onAnchor));

  const onUndo = () => {
    if (controller.undo()) opts.onUndoOrRestart();
  };
  undoBtn.addEventListener('click', onUndo);
  disposers.push(() => undoBtn.removeEventListener('click', onUndo));

  const onRestart = () => {
    if (controller.restart()) opts.onUndoOrRestart();
  };
  restartBtn.addEventListener('click', onRestart);
  disposers.push(() => restartBtn.removeEventListener('click', onRestart));

  const onMotion = () => opts.onToggleMotion();
  motionBtn.addEventListener('click', onMotion);
  disposers.push(() => motionBtn.removeEventListener('click', onMotion));

  // ---------- 遮罩层 ----------
  const openLevels = () => levelsOverlay.classList.remove('hidden');
  const closeOverlays = () => {
    levelsOverlay.classList.add('hidden');
  };
  const onOpenLevels = () => openLevels();
  $('.btn-levels').addEventListener('click', onOpenLevels);
  const onCloseLevels = () => closeOverlays();
  $('.btn-close-levels').addEventListener('click', onCloseLevels);
  const onPickLevel = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.level-item');
    if (!t?.dataset.level) return;
    closeOverlays();
    completeOverlay.classList.add('hidden');
    opts.onLevelPicked(t.dataset.level);
  };
  levelGrid.addEventListener('click', onPickLevel);

  const onNext = () => {
    const idx = levels.findIndex((l) => l.id === controller.level.id);
    const next = levels[idx + 1];
    if (!next) return;
    completeOverlay.classList.add('hidden');
    opts.onLevelPicked(next.id);
  };
  nextBtn.addEventListener('click', onNext);
  const onCompleteUndo = () => {
    if (controller.undo()) opts.onUndoOrRestart();
  };
  $('.btn-complete-undo').addEventListener('click', onCompleteUndo);
  const onCompleteRestart = () => {
    if (controller.restart()) opts.onUndoOrRestart();
  };
  $('.btn-complete-restart').addEventListener('click', onCompleteRestart);
  const onCompleteLevels = () => {
    completeOverlay.classList.add('hidden');
    openLevels();
  };
  $('.btn-complete-levels').addEventListener('click', onCompleteLevels);
  disposers.push(() => {
    $('.btn-levels').removeEventListener('click', onOpenLevels);
    $('.btn-close-levels').removeEventListener('click', onCloseLevels);
    levelGrid.removeEventListener('click', onPickLevel);
    nextBtn.removeEventListener('click', onNext);
    $('.btn-complete-undo').removeEventListener('click', onCompleteUndo);
    $('.btn-complete-restart').removeEventListener('click', onCompleteRestart);
    $('.btn-complete-levels').removeEventListener('click', onCompleteLevels);
  });

  // ---------- 刷新 ----------
  let lastLevelId = '';
  const refresh = () => {
    const lv = controller.level;
    titleEl.textContent = `${lv.id} · ${lv.title}`;
    countEl.textContent = `已投递 ${controller.deliveredCount()}/${lv.boats.length}`;
    motionBtn.textContent = opts.getReducedMotion() ? '动效:关' : '动效:开';

    // 切换关卡:重置提示为本关教学
    if (lv.id !== lastLevelId) {
      lastLevelId = lv.id;
      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }
      hintEl.textContent = baseHint();
    }

    // 锚按钮状态
    const locked = controller.locked;
    if (lv.anchorCharges === 0) {
      anchorBtn.disabled = true;
      anchorBtn.classList.remove('selecting');
      anchorBadge.textContent = 'L05 解锁';
    } else {
      anchorBtn.disabled = locked || controller.state.anchorsLeft === 0;
      anchorBtn.classList.toggle('selecting', controller.anchorSelecting);
      anchorBadge.textContent = `×${controller.state.anchorsLeft}`;
    }
    undoBtn.disabled = locked || controller.history.length === 0;
    restartBtn.disabled = locked;
    for (const b of dpadBtns) b.disabled = locked;

    if (!hintTimer || hintEl.textContent === '' || hintEl.textContent === controller.level.teaching) {
      hintEl.textContent = baseHint();
    } else if (controller.anchorSelecting || controller.pendingAnchor) {
      hintEl.textContent = baseHint();
    }

    // 完成遮罩
    if (controller.complete) {
      completeText.textContent = `${lv.id} · ${lv.title},${controller.state.moves} 次潮汐全部送达。`;
      const idx = levels.findIndex((l) => l.id === lv.id);
      nextBtn.disabled = idx < 0 || idx + 1 >= levels.length;
      completeOverlay.classList.remove('hidden');
    } else {
      completeOverlay.classList.add('hidden');
    }
  };

  const handleEvents = (events: GameEvent[]) => {
    let msg: string | null = null;
    if (events.some((e) => e.type === 'complete')) msg = '全部信件送达!';
    else if (events.some((e) => e.type === 'delivered')) msg = '投递成功!';
    else if (events.some((e) => e.type === 'ineffective')) msg = '这个方向暂时走不动';
    else if (events.some((e) => e.type === 'anchorUsed')) msg = '潮汐锚生效,它这一拍留下';
    else {
      const blocked = events.find((e) => e.type === 'blocked');
      if (blocked && blocked.type === 'blocked') msg = BLOCKED_HINT[blocked.reason] ?? '走不动';
    }
    if (msg) showHint(msg, 2600);
  };

  return {
    canvas,
    setRenderer: (r) => {
      renderer = r;
    },
    refresh,
    handleEvents,
    destroy: () => {
      disposers.forEach((d) => d());
      if (hintTimer) clearTimeout(hintTimer);
      root.innerHTML = '';
    }
  };
}
