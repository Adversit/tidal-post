/**
 * 潮汐邮局 - Canvas 2D 纸艺海港渲染与动画。
 *
 * 动画只呈现规则引擎给出的事件,不参与业务判定。
 * 门/浮标画面状态由船的展示位置实时推导,与规则口径一致。
 * 无 Canvas 上下文(如测试环境)时退化为无绘制的计时器模式。
 */
import type { GameEvent, GameState, LevelDef } from './types';
import { DIRS } from './types';
import { gridCols, gridRows, isWater } from './rules';
import type { GameController } from './game';

export const PALETTE = {
  paper: '#F6F0E3',
  paperDeep: '#EFE5CF',
  water: '#9BD5D4',
  waterDeep: '#8AC6C6',
  wave: '#7FBEBE',
  deep: '#3F7F87',
  coral: '#E3826F',
  coralDark: '#C96A57',
  gold: '#D6AA58',
  goldSoft: '#EBCF9A',
  ink: '#244B52',
  tealBoat: '#4E8A96',
  tealBoatDark: '#3A6B75',
  cream: '#FFF9EC',
  rockEdge: '#D8CBA8',
  rockFill: '#F1E8D2'
} as const;

type Stamp = 'circle' | 'star' | 'triangle' | 'diamond';

interface BoatSkin {
  hull: string;
  hullDark: string;
  stamp: Stamp;
}

const SKINS: BoatSkin[] = [
  { hull: PALETTE.coral, hullDark: PALETTE.coralDark, stamp: 'circle' },
  { hull: PALETTE.tealBoat, hullDark: PALETTE.tealBoatDark, stamp: 'star' },
  { hull: PALETTE.gold, hullDark: '#B8892F', stamp: 'triangle' },
  { hull: PALETTE.deep, hullDark: '#2E5F65', stamp: 'diamond' }
];

interface Tween {
  id: string;
  fromR: number;
  fromC: number;
  toR: number;
  toC: number;
  t0: number;
  dur: number;
}
interface Fade {
  id: string;
  t0: number;
  dur: number;
}
interface Ripple {
  r: number;
  c: number;
  dr: number;
  dc: number;
  t0: number;
  ttl: number;
}
interface Flash {
  r: number;
  c: number;
  dr: number;
  dc: number;
  t0: number;
  ttl: number;
}
interface MailFx {
  r: number;
  c: number;
  t0: number;
  ttl: number;
}

const MOVE_MS = 230;
const DELIVER_MS = 260;

/** 确定性伪随机(0..1),保证水波等装饰逐帧稳定 */
function hash01(r: number, c: number, salt: number): number {
  let h = (r * 73856093) ^ (c * 19349663) ^ (salt * 83492791);
  h = Math.abs(h);
  return (h % 1000) / 1000;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

const raf: (cb: (ts: number) => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(Date.now()), 16);

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private level!: LevelDef;
  private controller!: GameController;
  reducedMotion = false;

  /** 展示位置(格坐标,动画期间可为小数) */
  private display = new Map<string, { r: number; c: number; alpha: number; scale: number }>();
  private tweens: Tween[] = [];
  private fades: Fade[] = [];
  private ripples: Ripple[] = [];
  private flashes: Flash[] = [];
  private mails: MailFx[] = [];
  /**
   * 动画期间冻结的浮标画面状态(键 "r,c")。
   * 移动动画使用潮汐开始时的占用快照,结束才切换到结算后状态。
   */
  private frozenPads: Map<string, boolean> | null = null;
  /** 动画代次:切关/重挂载时递增,使旧关卡的延迟回调失效 */
  private animGen = 0;

  /** 布局(css px) */
  cell = 48;
  originX = 0;
  originY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  attach(level: LevelDef, controller: GameController): void {
    this.level = level;
    this.controller = controller;
    this.animGen++; // 旧关卡未完成的动画回调全部失效
    this.ripples = [];
    this.flashes = [];
    this.mails = [];
    this.frozenPads = null;
    this.resize();
    this.snap();
    this.startLoop();
  }

  /** 供主程序在窗口变化时调用 */
  resize(): void {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio || 1 : 1;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rows = gridRows(this.level);
    const cols = gridCols(this.level);
    const margin = 10;
    this.cell = Math.max(
      16,
      Math.floor(Math.min((w - margin * 2) / cols, (h - margin * 2) / rows))
    );
    this.originX = Math.round((w - this.cell * cols) / 2);
    this.originY = Math.round((h - this.cell * rows) / 2);
    this.drawFrame(performanceSafeNow());
  }

  /** 展示状态直接对齐到给定规则状态(撤回/重来/切关) */
  snapTo(state: GameState): void {
    this.tweens = [];
    this.fades = [];
    this.frozenPads = null;
    this.display.clear();
    for (const b of state.boats) {
      this.display.set(b.id, {
        r: b.pos.r,
        c: b.pos.c,
        alpha: b.delivered ? 0 : 1,
        scale: b.delivered ? 0.35 : 1
      });
    }
  }

  snap(): void {
    this.snapTo(this.controller.state);
  }

  /** 播放一次规则结算产生的事件;结束(或兜底超时)后调用 done */
  playEvents(events: GameEvent[], result: TideResultLike, done: () => void): void {
    if (events.length === 0) {
      done();
      return;
    }
    const gen = this.animGen;
    if (this.reducedMotion || !this.ctx) {
      this.snapTo(result.state);
      setTimeout(() => {
        if (gen !== this.animGen) return; // 已切关:旧回调不得再解新锁
        done();
      }, this.reducedMotion ? 40 : 0);
      return;
    }
    const now = performanceSafeNow();
    // 冻结本次潮汐开始时的浮标/门画面状态;动画结束才切换到结算后状态
    this.frozenPads = this.currentPadStates();
    let hasDelivery = false;
    let hasMove = false;
    for (const e of events) {
      if (e.type === 'move') {
        hasMove = true;
        const d = this.display.get(e.boatId);
        this.tweens.push({
          id: e.boatId,
          fromR: d?.r ?? e.from.r,
          fromC: d?.c ?? e.from.c,
          toR: e.to.r,
          toC: e.to.c,
          t0: now,
          dur: MOVE_MS
        });
        this.ripples.push({
          r: e.from.r,
          c: e.from.c,
          dr: e.to.r - e.from.r,
          dc: e.to.c - e.from.c,
          t0: now,
          ttl: 460
        });
      } else if (e.type === 'delivered') {
        hasDelivery = true;
        this.fades.push({ id: e.boatId, t0: now + MOVE_MS, dur: DELIVER_MS });
        this.mails.push({ r: e.dock.r, c: e.dock.c, t0: now + MOVE_MS, ttl: DELIVER_MS + 260 });
      } else if (e.type === 'blocked') {
        const boat = result.state.boats.find((b) => b.id === e.boatId);
        if (boat) {
          this.flashes.push({
            r: boat.pos.r,
            c: boat.pos.c,
            dr: DIRS[e.dir].r,
            dc: DIRS[e.dir].c,
            t0: now,
            ttl: 320
          });
        }
      }
    }
    const total = (hasMove ? MOVE_MS : 0) + (hasDelivery ? DELIVER_MS : 0) + 40;
    setTimeout(() => {
      if (gen !== this.animGen) return; // 已切关:旧回调不得写入展示状态或解锁
      this.frozenPads = null;
      this.snapTo(result.state);
      done();
    }, total);
  }

  /** 当前展示位置下的浮标占用快照(动画开始那一刻调用) */
  private currentPadStates(): Map<string, boolean> {
    const m = new Map<string, boolean>();
    for (const g of this.level.gates) {
      for (const pad of g.pads) {
        m.set(`${pad.r},${pad.c}`, this.padActiveLive(pad.r, pad.c));
      }
    }
    return m;
  }

  /** 画面用门状态(供测试断言真实绘制口径) */
  displayGateOpen(gateId: string): boolean {
    const g = this.level.gates.find((x) => x.id === gateId);
    if (!g) return false;
    return g.pads.some((p) => this.padActiveForDisplay(p.r, p.c));
  }

  /** 测试/调试:读取船的展示状态副本 */
  getDisplay(boatId: string): { r: number; c: number; alpha: number; scale: number } | undefined {
    const d = this.display.get(boatId);
    return d ? { ...d } : undefined;
  }

  /** 选船命中半径:至少 22px,保证 44x44 CSS px 触控区 */
  private hitRadius(): number {
    return Math.max(this.cell / 2, 22);
  }

  /**
   * 画布点击 → 船 id(锚选目标)。
   * 命中区至少 44x44;重叠时取距船中心最近者,同距按 id 字典序(与 boats 顺序无关)。
   */
  boatAtPoint(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const radius = this.hitRadius();
    let best: { id: string; d: number } | null = null;
    for (const b of this.controller.state.boats) {
      if (b.delivered) continue;
      const d = this.display.get(b.id);
      if (!d || d.alpha < 0.5) continue;
      const cx = this.originX + (d.c + 0.5) * this.cell;
      const cy = this.originY + (d.r + 0.5) * this.cell;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= radius && (!best || dist < best.d || (dist === best.d && b.id < best.id))) {
        best = { id: b.id, d: dist };
      }
    }
    return best ? best.id : null;
  }

  private loopStarted = false;
  private running = false;
  private startLoop(): void {
    if (this.loopStarted) return;
    this.loopStarted = true;
    this.running = true;
    const tick = (ts: number) => {
      if (!this.running) return;
      this.updateDisplay(ts);
      this.drawFrame(ts);
      raf(tick);
    };
    raf(tick);
  }

  /** 停止渲染循环(测试/销毁用) */
  stop(): void {
    this.running = false;
  }

  private updateDisplay(ts: number): void {
    for (const tw of this.tweens) {
      const d = this.display.get(tw.id);
      if (!d) continue;
      const t = Math.min(1, (ts - tw.t0) / tw.dur);
      const k = easeInOut(Math.max(0, t));
      d.r = tw.fromR + (tw.toR - tw.fromR) * k;
      d.c = tw.fromC + (tw.toC - tw.fromC) * k;
    }
    this.tweens = this.tweens.filter((tw) => ts < tw.t0 + tw.dur);
    for (const f of this.fades) {
      const d = this.display.get(f.id);
      if (!d) continue;
      const t = Math.max(0, Math.min(1, (ts - f.t0) / f.dur));
      d.alpha = 1 - t;
      d.scale = 1 - 0.65 * t;
    }
    this.fades = this.fades.filter((f) => ts < f.t0 + f.dur);
    this.ripples = this.ripples.filter((r) => ts < r.t0 + r.ttl);
    this.flashes = this.flashes.filter((f) => ts < f.t0 + f.ttl);
    this.mails = this.mails.filter((m) => ts < m.t0 + m.ttl);
  }

  // ------------------------------------------------------------ 绘制

  private drawFrame(ts: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width / (devicePixelRatioSafe() || 1);
    const h = this.canvas.height / (devicePixelRatioSafe() || 1);
    ctx.clearRect(0, 0, w, h);

    this.drawPanel(ctx);
    this.drawWater(ctx);
    this.drawRipples(ctx, ts);
    this.drawLand(ctx);
    this.drawPads(ctx);
    this.drawGates(ctx);
    this.drawDocks(ctx);
    this.drawMails(ctx, ts);
    this.drawBoats(ctx);
    this.drawFlashes(ctx, ts);
  }

  private drawPanel(ctx: CanvasRenderingContext2D): void {
    const rows = gridRows(this.level);
    const cols = gridCols(this.level);
    const rim = Math.max(8, this.cell * 0.2);
    const x = this.originX - rim;
    const y = this.originY - rim;
    const w = this.cell * cols + rim * 2;
    const h = this.cell * rows + rim * 2;
    ctx.save();
    ctx.fillStyle = PALETTE.deep;
    roundRect(ctx, x, y, w, h, rim * 1.2);
    ctx.fill();
    // 纸艺边框高光
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, rim);
    ctx.stroke();
    ctx.restore();
  }

  private drawWater(ctx: CanvasRenderingContext2D): void {
    const rows = gridRows(this.level);
    const cols = gridCols(this.level);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isWater(this.level, { r, c })) continue;
        const x = this.originX + c * this.cell;
        const y = this.originY + r * this.cell;
        const g = ctx.createLinearGradient(x, y, x, y + this.cell);
        g.addColorStop(0, PALETTE.water);
        g.addColorStop(1, PALETTE.waterDeep);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, this.cell, this.cell);
        // 稳定的水波纹理
        const h1 = hash01(r, c, 7);
        if (h1 > 0.35) {
          const wx = x + this.cell * (0.25 + 0.5 * hash01(r, c, 11));
          const wy = y + this.cell * (0.3 + 0.4 * hash01(r, c, 13));
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = Math.max(1.2, this.cell * 0.025);
          ctx.beginPath();
          ctx.arc(wx, wy, this.cell * 0.12, Math.PI * 1.05, Math.PI * 1.95);
          ctx.stroke();
        }
      }
    }
    // 淡化网格缝线
    ctx.strokeStyle = 'rgba(63,127,135,0.10)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(this.originX, this.originY + r * this.cell);
      ctx.lineTo(this.originX + cols * this.cell, this.originY + r * this.cell);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(this.originX + c * this.cell, this.originY);
      ctx.lineTo(this.originX + c * this.cell, this.originY + rows * this.cell);
      ctx.stroke();
    }
  }

  private drawLand(ctx: CanvasRenderingContext2D): void {
    const rows = gridRows(this.level);
    const cols = gridCols(this.level);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isWater(this.level, { r, c })) continue;
        const x = this.originX + c * this.cell;
        const y = this.originY + r * this.cell;
        const inset = this.cell * 0.07;
        ctx.save();
        ctx.shadowColor = 'rgba(36,75,82,0.25)';
        ctx.shadowBlur = this.cell * 0.06;
        ctx.shadowOffsetY = this.cell * 0.04;
        ctx.fillStyle = PALETTE.rockFill;
        roundRect(ctx, x + inset, y + inset, this.cell - inset * 2, this.cell - inset * 2, this.cell * 0.24);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = PALETTE.rockEdge;
        ctx.lineWidth = Math.max(1, this.cell * 0.02);
        roundRect(ctx, x + inset, y + inset, this.cell - inset * 2, this.cell - inset * 2, this.cell * 0.24);
        ctx.stroke();
        // 卵石点缀(稳定)
        const n = hash01(r, c, 3) > 0.5 ? 2 : 1;
        ctx.fillStyle = 'rgba(216,203,168,0.9)';
        for (let i = 0; i < n; i++) {
          const px = x + this.cell * (0.3 + 0.4 * hash01(r, c, 17 + i));
          const py = y + this.cell * (0.3 + 0.4 * hash01(r, c, 23 + i));
          ctx.beginPath();
          ctx.arc(px, py, this.cell * 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** 浮标实时占用:由展示位置推导 */
  private padActiveLive(padR: number, padC: number): boolean {
    for (const b of this.controller.state.boats) {
      if (b.delivered) continue;
      const d = this.display.get(b.id);
      if (!d || d.alpha < 0.5) continue;
      if (Math.abs(d.r - padR) < 0.45 && Math.abs(d.c - padC) < 0.45) return true;
    }
    return false;
  }

  /** 画面用浮标状态:动画期间使用潮汐开始时的冻结快照 */
  private padActiveForDisplay(padR: number, padC: number): boolean {
    const frozen = this.frozenPads?.get(`${padR},${padC}`);
    if (frozen !== undefined) return frozen;
    return this.padActiveLive(padR, padC);
  }

  private drawPads(ctx: CanvasRenderingContext2D): void {
    const seen = new Set<string>();
    for (const g of this.level.gates) {
      for (const pad of g.pads) {
        const key = `${pad.r},${pad.c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cx = this.originX + (pad.c + 0.5) * this.cell;
        const cy = this.originY + (pad.r + 0.5) * this.cell;
        const active = this.padActiveForDisplay(pad.r, pad.c);
        const base = this.cell * (active ? 0.26 : 0.29);
        if (active) {
          ctx.save();
          ctx.fillStyle = 'rgba(214,170,88,0.45)';
          ctx.beginPath();
          ctx.arc(cx, cy, this.cell * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        // 浮标主体:白圈 + 机关徽记(与水闸一致的水波纹)
        ctx.save();
        ctx.fillStyle = PALETTE.cream;
        ctx.strokeStyle = active ? PALETTE.gold : PALETTE.deep;
        ctx.lineWidth = Math.max(2, this.cell * 0.035);
        ctx.beginPath();
        ctx.arc(cx, cy, base, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.drawEmblem(ctx, cx, cy, base * 0.62, active ? PALETTE.gold : PALETTE.deep);
        ctx.restore();
      }
    }
  }

  /** 机关徽记:三道水波纹,浮标与水闸共用 */
  private drawEmblem(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    color: string
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, size * 0.22);
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const yy = cy + i * size * 0.52;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.8, yy);
      ctx.quadraticCurveTo(cx - size * 0.4, yy - size * 0.42, cx, yy);
      ctx.quadraticCurveTo(cx + size * 0.4, yy + size * 0.42, cx + size * 0.8, yy);
      ctx.stroke();
    }
  }

  private drawGates(ctx: CanvasRenderingContext2D): void {
    for (const g of this.level.gates) {
      const open = g.pads.some((p) => this.padActiveForDisplay(p.r, p.c));
      const horizontal = g.a.r === g.b.r; // 同一行 => 门在竖直边上
      // 共享边的中点与方向
      const edgeC = horizontal ? Math.max(g.a.c, g.b.c) : g.a.c + 0.5;
      const edgeR = horizontal ? g.a.r + 0.5 : Math.max(g.a.r, g.b.r);
      const ex = this.originX + edgeC * this.cell;
      const ey = this.originY + edgeR * this.cell;
      const half = this.cell * 0.34;
      ctx.save();
      ctx.lineCap = 'round';
      if (open) {
        // 打开:两端短桩 + 半透明中段
        ctx.strokeStyle = 'rgba(63,127,135,0.55)';
        ctx.lineWidth = Math.max(3, this.cell * 0.07);
        gateSegment(ctx, ex, ey, half, -1, horizontal);
        gateSegment(ctx, ex, ey, half, 1, horizontal);
        ctx.strokeStyle = 'rgba(155,213,212,0.6)';
        ctx.lineWidth = Math.max(2, this.cell * 0.045);
        gateBeam(ctx, ex, ey, half * 0.55, horizontal);
      } else {
        // 关闭:实体横杆 + 徽记
        ctx.strokeStyle = PALETTE.deep;
        ctx.lineWidth = Math.max(3.5, this.cell * 0.08);
        gateBeam(ctx, ex, ey, half, horizontal);
        this.drawEmblem(ctx, ex, ey, this.cell * 0.1, PALETTE.cream);
      }
      // 门桩
      ctx.fillStyle = open ? PALETTE.gold : PALETTE.deep;
      const postR = Math.max(2.5, this.cell * 0.055);
      if (horizontal) {
        ctx.beginPath();
        ctx.arc(ex, ey - half - postR * 0.6, postR, 0, Math.PI * 2);
        ctx.arc(ex, ey + half + postR * 0.6, postR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(ex - half - postR * 0.6, ey, postR, 0, Math.PI * 2);
        ctx.arc(ex + half + postR * 0.6, ey, postR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawDocks(ctx: CanvasRenderingContext2D): void {
    this.level.boats.forEach((def, i) => {
      const skin = SKINS[i % SKINS.length];
      const cx = this.originX + (def.dock.c + 0.5) * this.cell;
      const cy = this.originY + (def.dock.r + 0.5) * this.cell;
      // 码头:纸木平台 + 邮戳徽章 + 小灯
      const bw = this.cell * 0.66;
      ctx.save();
      ctx.fillStyle = PALETTE.paperDeep;
      ctx.strokeStyle = PALETTE.rockEdge;
      ctx.lineWidth = Math.max(1.2, this.cell * 0.022);
      roundRect(ctx, cx - bw / 2, cy - bw / 2, bw, bw, this.cell * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(216,203,168,0.9)';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2 + this.cell * 0.06, cy + (k * bw) / 3.2);
        ctx.lineTo(cx + bw / 2 - this.cell * 0.06, cy + (k * bw) / 3.2);
        ctx.stroke();
      }
      // 邮戳徽章
      ctx.fillStyle = PALETTE.cream;
      ctx.strokeStyle = skin.hull;
      ctx.lineWidth = Math.max(1.6, this.cell * 0.028);
      ctx.beginPath();
      ctx.arc(cx, cy, this.cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.drawStamp(ctx, cx, cy, this.cell * 0.11, skin);
      ctx.restore();

      // 小灯:交付完成后点亮(以展示层消失为准,保证动画因果)
      const boat = this.controller.state.boats.find((b) => b.id === def.id);
      const disp = boat ? this.display.get(boat.id) : undefined;
      const lit = !!boat && boat.delivered && (disp?.alpha ?? 0) < 0.05;
      const lx = cx + bw / 2 + this.cell * 0.1;
      const ly = cy - bw / 2 - this.cell * 0.1;
      ctx.save();
      if (lit) {
        ctx.fillStyle = 'rgba(214,170,88,0.5)';
        ctx.beginPath();
        ctx.arc(lx, ly, this.cell * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = lit ? PALETTE.gold : '#C9BD9F';
      ctx.strokeStyle = PALETTE.deep;
      ctx.lineWidth = Math.max(1, this.cell * 0.02);
      ctx.beginPath();
      ctx.arc(lx, ly, this.cell * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  private drawStamp(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    skin: BoatSkin
  ): void {
    ctx.fillStyle = skin.hull;
    ctx.strokeStyle = skin.hullDark;
    ctx.lineWidth = Math.max(1, size * 0.16);
    ctx.beginPath();
    if (skin.stamp === 'circle') {
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
    } else if (skin.stamp === 'star') {
      starPath(ctx, cx, cy, size * 1.25, size * 0.55, 5);
    } else if (skin.stamp === 'triangle') {
      ctx.moveTo(cx, cy - size * 1.15);
      ctx.lineTo(cx + size, cy + size * 0.8);
      ctx.lineTo(cx - size, cy + size * 0.8);
      ctx.closePath();
    } else {
      ctx.moveTo(cx, cy - size * 1.15);
      ctx.lineTo(cx + size, cy);
      ctx.lineTo(cx, cy + size * 1.15);
      ctx.lineTo(cx - size, cy);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  private drawBoats(ctx: CanvasRenderingContext2D): void {
    this.controller.state.boats.forEach((boat) => {
      const d = this.display.get(boat.id);
      if (!d || d.alpha <= 0.01) return;
      const idx = this.level.boats.findIndex((b) => b.id === boat.id);
      const skin = SKINS[(idx < 0 ? 0 : idx) % SKINS.length];
      const cx = this.originX + (d.c + 0.5) * this.cell;
      const cy = this.originY + (d.r + 0.5) * this.cell;
      const s = this.cell * d.scale;
      ctx.save();
      ctx.globalAlpha = d.alpha;
      // 投影
      ctx.fillStyle = 'rgba(36,75,82,0.22)';
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.05, cy + s * 0.14, s * 0.3, s * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      // 折纸船体:上下两个明暗面
      const tipX = s * 0.34;
      const sideY = s * 0.17;
      const midX = s * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx - tipX, cy);
      ctx.lineTo(cx - midX, cy - sideY);
      ctx.lineTo(cx + midX, cy - sideY);
      ctx.lineTo(cx + tipX, cy);
      ctx.closePath();
      ctx.fillStyle = skin.hull;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - tipX, cy);
      ctx.lineTo(cx - midX, cy + sideY);
      ctx.lineTo(cx + midX, cy + sideY);
      ctx.lineTo(cx + tipX, cy);
      ctx.closePath();
      ctx.fillStyle = skin.hullDark;
      ctx.fill();
      // 帆(纸折三角)
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.3);
      ctx.lineTo(cx - s * 0.12, cy - s * 0.02);
      ctx.lineTo(cx + s * 0.12, cy - s * 0.02);
      ctx.closePath();
      ctx.fillStyle = PALETTE.cream;
      ctx.fill();
      ctx.strokeStyle = 'rgba(36,75,82,0.25)';
      ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.stroke();
      // 邮戳
      this.drawStamp(ctx, cx, cy - s * 0.1, s * 0.06, skin);
      ctx.restore();

      // 待用锚标识
      if (this.controller.pendingAnchor === boat.id) {
        this.drawAnchorMark(ctx, cx, cy, this.cell);
      }
    });
  }

  private drawAnchorMark(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    cell: number
  ): void {
    ctx.save();
    // 选中轮廓
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = Math.max(2, cell * 0.035);
    ctx.setLineDash([cell * 0.09, cell * 0.07]);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // 锚图形
    const ax = cx + cell * 0.3;
    const ay = cy - cell * 0.34;
    const u = cell * 0.075;
    ctx.strokeStyle = PALETTE.deep;
    ctx.fillStyle = PALETTE.deep;
    ctx.lineWidth = Math.max(1.6, u * 0.34);
    ctx.lineCap = 'round';
    ctx.beginPath(); // 顶环
    ctx.arc(ax, ay - u * 0.9, u * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath(); // 杆 + 横杆
    ctx.moveTo(ax, ay - u * 0.35);
    ctx.lineTo(ax, ay + u * 1.1);
    ctx.moveTo(ax - u * 0.7, ay + u * 0.1);
    ctx.lineTo(ax + u * 0.7, ay + u * 0.1);
    ctx.stroke();
    ctx.beginPath(); // 锚爪
    ctx.arc(ax, ay + u * 0.5, u * 0.95, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, ts: number): void {
    for (const rp of this.ripples) {
      const t = (ts - rp.t0) / rp.ttl;
      if (t < 0 || t > 1) continue;
      const cx = this.originX + (rp.c + 0.5 + rp.dc * t * 0.6) * this.cell;
      const cy = this.originY + (rp.r + 0.5 + rp.dr * t * 0.6) * this.cell;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.strokeStyle = PALETTE.cream;
      ctx.lineWidth = Math.max(1.2, this.cell * 0.025);
      ctx.beginPath();
      ctx.arc(cx, cy, this.cell * (0.12 + 0.34 * t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawFlashes(ctx: CanvasRenderingContext2D, ts: number): void {
    for (const f of this.flashes) {
      const t = (ts - f.t0) / f.ttl;
      if (t < 0 || t > 1) continue;
      // 在受阻方向的船沿画一小段撞击线
      const bx = this.originX + (f.c + 0.5) * this.cell;
      const by = this.originY + (f.r + 0.5) * this.cell;
      const ex = bx + f.dc * this.cell * (0.42 + 0.08 * Math.sin(t * Math.PI));
      const ey = by + f.dr * this.cell * (0.42 + 0.08 * Math.sin(t * Math.PI));
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = Math.max(2, this.cell * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (f.dr === 0) {
        ctx.moveTo(ex, ey - this.cell * 0.18);
        ctx.lineTo(ex, ey + this.cell * 0.18);
      } else {
        ctx.moveTo(ex - this.cell * 0.18, ey);
        ctx.lineTo(ex + this.cell * 0.18, ey);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawMails(ctx: CanvasRenderingContext2D, ts: number): void {
    for (const m of this.mails) {
      const t = (ts - m.t0) / m.ttl;
      if (t < 0 || t > 1) continue;
      const cx = this.originX + (m.c + 0.5) * this.cell;
      const cy = this.originY + (m.r + 0.5) * this.cell;
      const pop = t < 0.4 ? t / 0.4 : 1;
      const w = this.cell * 0.3 * pop;
      const h = this.cell * 0.2 * pop;
      const yOff = -this.cell * 0.22 * easeInOut(Math.min(1, t * 1.2));
      ctx.save();
      ctx.globalAlpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      ctx.translate(cx, cy + yOff);
      ctx.fillStyle = PALETTE.cream;
      ctx.strokeStyle = PALETTE.coral;
      ctx.lineWidth = Math.max(1.4, this.cell * 0.022);
      roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.18);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(0, h * 0.12);
      ctx.lineTo(w / 2, -h / 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** playEvents 仅需 TideResult 的 state 字段,定义结构子集便于测试替身 */
export interface TideResultLike {
  state: GameState;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number
): void {
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 水平相邻两格 => 门画在竖直边上;反之画在水平边上 */
function gateBeam(
  ctx: CanvasRenderingContext2D,
  ex: number,
  ey: number,
  half: number,
  horizontalCells: boolean
): void {
  ctx.beginPath();
  if (horizontalCells) {
    ctx.moveTo(ex, ey - half);
    ctx.lineTo(ex, ey + half);
  } else {
    ctx.moveTo(ex - half, ey);
    ctx.lineTo(ex + half, ey);
  }
  ctx.stroke();
}

function gateSegment(
  ctx: CanvasRenderingContext2D,
  ex: number,
  ey: number,
  half: number,
  side: -1 | 1,
  horizontalCells: boolean
): void {
  ctx.beginPath();
  if (horizontalCells) {
    ctx.moveTo(ex, ey + side * half);
    ctx.lineTo(ex, ey + side * half * 0.55);
  } else {
    ctx.moveTo(ex + side * half, ey);
    ctx.lineTo(ex + side * half * 0.55, ey);
  }
  ctx.stroke();
}

function performanceSafeNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function devicePixelRatioSafe(): number {
  return typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
}
