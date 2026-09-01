import { create } from 'zustand';
import { useSceneStore } from '../state/sceneStore';
import { myAgent } from '../state/actors';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---------------------------------------------------------------------------
// Agent cursor state (flow coordinates — rendered inside the viewport transform)
// ---------------------------------------------------------------------------

export type CursorMode = 'idle' | 'travelling' | 'grabbing' | 'thinking' | 'writing';

interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  mode: CursorMode;
  label: string;
  /** short-lived trail points for the motion streak behind the cursor. */
  trail: { x: number; y: number; t: number }[];
  set: (p: Partial<Omit<CursorState, 'set' | 'pushTrail'>>) => void;
  pushTrail: (x: number, y: number) => void;
}

export const useCursorStore = create<CursorState>((set) => ({
  x: 0,
  y: 0,
  visible: false,
  mode: 'idle',
  label: 'Agent',
  trail: [],
  set: (p) => set(p),
  pushTrail: (x, y) =>
    set((s) => {
      const t = performance.now();
      const trail = [...s.trail.filter((p) => t - p.t < 320), { x, y, t }];
      return { trail: trail.slice(-18) };
    }),
}));

// ---------------------------------------------------------------------------
// A single rAF loop drives every concurrent tween, so N moving nodes cost one
// store write per frame instead of N.
// ---------------------------------------------------------------------------

interface NodeTween {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  duration: number;
  /** true when the note reached its target, false when the human took it. */
  resolve: (completed: boolean) => void;
}

const nodeTweens = new Map<string, NodeTween>();
let frameHandle = 0;
let watchdog = 0;
let lastTick = 0;
let cursorFrame: ((now: number) => boolean) | null = null;

const hasWork = (): boolean => nodeTweens.size > 0 || cursorFrame !== null;

const step = (now: number): void => {
  lastTick = now;
  const positions: Record<string, { x: number; y: number }> = {};
  const grip = new Set(useSceneStore.getState().humanGrip);
  const finished: NodeTween[] = [];

  const stolen = new Set<string>();
  for (const tween of nodeTweens.values()) {
    // The human took this note. Yield it immediately and permanently.
    if (grip.has(tween.id)) {
      stolen.add(tween.id);
      finished.push(tween);
      continue;
    }
    const t = clamp01((now - tween.start) / tween.duration);
    const e = easeInOutCubic(t);
    positions[tween.id] = {
      x: tween.fromX + (tween.toX - tween.fromX) * e,
      y: tween.fromY + (tween.toY - tween.fromY) * e,
    };
    if (t >= 1) finished.push(tween);
  }

  if (Object.keys(positions).length > 0) {
    useSceneStore.getState().moveNodes(positions, myAgent());
  }
  for (const tween of finished) {
    nodeTweens.delete(tween.id);
    tween.resolve(!stolen.has(tween.id));
  }

  if (cursorFrame && !cursorFrame(now)) cursorFrame = null;
};

const tick = (now: number): void => {
  step(now);
  frameHandle = hasWork() ? requestAnimationFrame(tick) : 0;
};

/**
 * rAF alone is not enough. A hidden or heavily throttled tab stops firing it,
 * and an agent may well be driving this page while it is not the foreground
 * tab — a tool call that never resolves would strand the whole conversation.
 * This watchdog steps the same clock forward whenever rAF has gone quiet, so
 * every animation always completes and every tool promise always settles.
 */
const ensureWatchdog = (): void => {
  if (watchdog !== 0) return;
  watchdog = window.setInterval(() => {
    if (!hasWork()) {
      window.clearInterval(watchdog);
      watchdog = 0;
      return;
    }
    const now = performance.now();
    if (now - lastTick > 120) {
      step(now);
      if (!hasWork() && frameHandle !== 0) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
    }
  }, 60);
};

const ensureLoop = (): void => {
  lastTick = lastTick || performance.now();
  if (frameHandle === 0) frameHandle = requestAnimationFrame(tick);
  ensureWatchdog();
};

/**
 * Tween one note to a target. Resolves true when it lands, false when the human
 * grabbed it mid-flight and the agent let go.
 */
export const tweenNodeTo = (
  id: string,
  toX: number,
  toY: number,
  duration = 460,
): Promise<boolean> => {
  const node = useSceneStore.getState().getNode(id);
  if (!node) return Promise.resolve(false);

  const existing = nodeTweens.get(id);
  if (existing) {
    nodeTweens.delete(id);
    existing.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    nodeTweens.set(id, {
      id,
      fromX: node.x,
      fromY: node.y,
      toX,
      toY,
      start: performance.now(),
      duration,
      resolve,
    });
    ensureLoop();
  });
};

/** Move the agent cursor to a point at a physical-feeling speed. */
export const moveCursorTo = (
  toX: number,
  toY: number,
  opts: { speed?: number; min?: number; max?: number; mode?: CursorMode } = {},
): Promise<void> => {
  const { speed = 1.7, min = 150, max = 620, mode = 'travelling' } = opts;
  const cursor = useCursorStore.getState();
  const fromX = cursor.visible ? cursor.x : toX - 260;
  const fromY = cursor.visible ? cursor.y : toY - 200;
  const distance = Math.hypot(toX - fromX, toY - fromY);
  const duration = Math.min(max, Math.max(min, distance / speed));
  const start = performance.now();

  cursor.set({ visible: true, mode, x: fromX, y: fromY });

  return new Promise<void>((resolve) => {
    cursorFrame = (now: number) => {
      const t = clamp01((now - start) / duration);
      const e = easeInOutCubic(t);
      const x = fromX + (toX - fromX) * e;
      const y = fromY + (toY - fromY) * e;
      const store = useCursorStore.getState();
      store.set({ x, y });
      store.pushTrail(x, y);
      if (t >= 1) {
        resolve();
        return false;
      }
      return true;
    };
    ensureLoop();
  });
};

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const setCursorMode = (mode: CursorMode): void => {
  useCursorStore.getState().set({ mode });
};

export const hideCursor = (delay = 900): void => {
  setCursorMode('idle');
  setTimeout(() => {
    // Only retire the cursor if nothing else picked it back up.
    if (useCursorStore.getState().mode === 'idle') {
      useCursorStore.getState().set({ visible: false, trail: [] });
    }
  }, delay);
};

/** True while the agent is mid-action — used to show the "agent active" chrome. */
export const isAgentBusy = (): boolean => nodeTweens.size > 0;
