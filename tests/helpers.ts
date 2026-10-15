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
