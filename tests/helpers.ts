import type { LevelDef } from '../src/types';

/** 构造独立小案例关卡(不依赖正式 8 关数据) */
export function mkLevel(
  partial: Partial<LevelDef> & Pick<LevelDef, 'grid' | 'boats'>
): LevelDef {
  return {
    id: 'T',
    title: 'test',
    gates: [],
    anchorCharges: 0,
    referenceSolution: [],
    teaching: '',
    ...partial
  };
}

/**
 * 假画布 + 假 2D 上下文(node 测试环境无真实 Canvas):
 * 所有绘图方法为空操作,仅保留尺寸/定位语义,
 * 使渲染层动画与命中逻辑可在可控时钟下测试。
 */
export function makeFakeCanvas(
  width: number,
  height: number,
  rectPos: { left: number; top: number } = { left: 0, top: 0 }
): HTMLCanvasElement {
  const gradient = { addColorStop: () => {} };
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (t, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => gradient;
      }
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    }
  });
  const listeners = new Map<string, Set<EventListener>>();
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: rectPos.left,
      top: rectPos.top,
      right: rectPos.left + width,
      bottom: rectPos.top + height,
      width,
      height,
      x: rectPos.left,
      y: rectPos.top,
      toJSON: () => ({})
    }),
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn);
    },
    setPointerCapture: () => {},
    releasePointerCapture: () => {}
  };
  return canvas as unknown as HTMLCanvasElement;
}
