/**
 * 潮汐邮局 - 入口:组装控制器、渲染器与界面。
 */
import './style.css';
import { GameController } from './game';
import { BoardRenderer } from './render';
import { buildUI, type UI } from './ui';
import { getLevel, LEVELS } from './levels';

export interface AppHandle {
  controller: GameController;
  renderer: BoardRenderer;
  ui: UI;
}

export function initApp(root: HTMLElement, firstLevelId = 'L01'): AppHandle {
  const controller = new GameController(getLevel(firstLevelId));

  let reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 先建 UI(产出 canvas),再建渲染器
  let rendererRef: BoardRenderer | null = null;
  const ui = buildUI({
    root,
    levels: LEVELS,
    controller,
    onLevelPicked: (id) => {
      controller.loadLevel(getLevel(id));
      rendererRef?.attach(controller.level, controller);
      ui.refresh();
    },
    onUndoOrRestart: () => {
      rendererRef?.snap();
    },
    getReducedMotion: () => reducedMotion,
    onToggleMotion: () => {
      reducedMotion = !reducedMotion;
      if (rendererRef) rendererRef.reducedMotion = reducedMotion;
      ui.refresh();
    }
  });

  const renderer = new BoardRenderer(ui.canvas);
  rendererRef = renderer;
  renderer.reducedMotion = reducedMotion;
  renderer.attach(controller.level, controller);
  ui.setRenderer(renderer);

  // 规则事件 → 渲染动画;动画结束 done() 解锁输入
  controller.onEvents = (events, result, done) => {
    renderer.playEvents(events, result, () => {
      done();
      ui.refresh();
    });
    ui.handleEvents(events);
  };
  controller.onChange = () => ui.refresh();

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(onResize);
    ro.observe(ui.canvas);
  }

  ui.refresh();
  return { controller, renderer, ui };
}

// 浏览器环境自动挂载;测试环境(#app 不存在或后建)手动调用 initApp
if (typeof document !== 'undefined') {
  const el = document.getElementById('app');
  if (el) initApp(el);
}
