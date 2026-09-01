import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type {
  ActorId,
  Annotation,
  LayoutKind,
  Region,
  Scene,
  SceneEdge,
  SceneNode,
} from '../state/types';
import { LAYOUT_KINDS } from '../state/types';
import { LOCAL_HUMAN } from '../state/actors';
import { repairScene } from '../state/repair';
import { PAPER } from './palette';

/**
 * Take the board with you.
 *
 * The Markdown export is for humans and loses the thing the agent actually
 * produced — the geometry. This carries the whole scene, positions included,
 * inside a URL. It is the page's only persistence: nothing is uploaded, and a
 * link is the entire storage layer.
 *
 * Everything arriving here is untrusted: a hash is the easiest thing in the
 * world for someone else to hand you. Decoding therefore validates every field
 * and repairs the cross-entity invariants the store maintains transactionally
 * (no edge to a missing note, no note in two regions, no empty region) rather
 * than trusting a payload to have kept them.
 */

export const SHARE_VERSION = 1;
export const MAX_SHARE_NODES = 300;
export const HASH_KEY = 'b';

const MAX_TEXT = 400;
const MAX_LABEL = 120;
const MAX_COORD = 1e6;
/** A note's colour lands in a style attribute, so nothing but a plain hex. */
const HEX = /^#[0-9a-f]{3,8}$/i;

// --- wire form -------------------------------------------------------------
// Short keys because the payload has to survive as a URL. `editedAt` and
// `selected` are deliberately absent: both are per-session, and a shared board
// should arrive cold rather than mid provenance-fade or holding a selection
// made on someone else's screen.

interface WireNode {
  i: string;
  t: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  c: string;
  k?: SceneNode['kind'];
  b?: ActorId;
}
interface WireEdge {
  i: string;
  s: string;
  d: string;
  l: string;
  b?: ActorId;
}
interface WireAnnotation {
  i: string;
  t: string;
  n?: string | null;
  x: number;
  y: number;
  b?: ActorId;
}
interface WireRegion {
  i: string;
  l: string;
  y: LayoutKind;
  n: string[];
  b?: ActorId;
}

/** Defaults the decoder already supplies, so the encoder can leave them out. */
const DEFAULT_W = 176;
const DEFAULT_H = 84;
/** Drop a key whose value is the decoder's own default. */
const omit = <T>(value: T, fallback: T): T | undefined =>
  value === fallback ? undefined : value;
interface Wire {
  v: number;
  n: WireNode[];
  e: WireEdge[];
  a: WireAnnotation[];
  r: WireRegion[];
}

// --- encode ----------------------------------------------------------------

export const encodeScene = (scene: Scene): string => {
  const wire: Wire = {
    v: SHARE_VERSION,
    n: scene.nodes.map((n) => ({
      i: n.id,
      t: n.text,
      x: Math.round(n.x),
      y: Math.round(n.y),
      w: omit(Math.round(n.w), DEFAULT_W),
      h: omit(Math.round(n.h), DEFAULT_H),
      c: n.color,
      k: omit(n.kind, 'idea'),
      b: omit(n.lastEditedBy, LOCAL_HUMAN),
    })),
    e: scene.edges.map((e) => ({
      i: e.id,
      s: e.from,
      d: e.to,
      l: e.label,
      b: omit(e.lastEditedBy, LOCAL_HUMAN),
    })),
    a: scene.annotations.map((a) => ({
      i: a.id,
      t: a.text,
      n: a.nodeId ?? undefined,
      x: Math.round(a.x),
      y: Math.round(a.y),
      b: omit(a.lastEditedBy, LOCAL_HUMAN),
    })),
    r: scene.regions.map((r) => ({
      i: r.id,
      l: r.label,
      y: r.layout,
      n: [...r.nodeIds],
      b: omit(r.lastEditedBy, LOCAL_HUMAN),
    })),
  };

  return compressToEncodedURIComponent(JSON.stringify(wire));
};

// --- validation ------------------------------------------------------------

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const num = (v: unknown, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(v)));
};

/** Ids already published in share links are plain 'human' and 'agent'. */
const actor = (v: unknown): ActorId => str(v, 64) ?? LOCAL_HUMAN;

const color = (v: unknown): string => (typeof v === 'string' && HEX.test(v) ? v : PAPER.event);

const layout = (v: unknown): LayoutKind =>
  LAYOUT_KINDS.includes(v as LayoutKind) ? (v as LayoutKind) : 'cluster';

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// --- decode ----------------------------------------------------------------

export const decodeScene = (encoded: string | null | undefined): Scene | null => {
  if (!encoded) return null;

  let wire: Partial<Wire>;
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    wire = parsed as Partial<Wire>;
  } catch {
    // Malformed input is the expected case for a hand-edited URL, not a fault.
    return null;
  }

  if (wire.v !== SHARE_VERSION) return null;

  const nodes: SceneNode[] = [];
  const present = new Set<string>();
  for (const raw of asArray(wire.n)) {
    if (nodes.length >= MAX_SHARE_NODES) break;
    const n = raw as Partial<WireNode>;
    const id = str(n.i, 64);
    const text = str(n.t, MAX_TEXT);
    if (!id || !text || present.has(id)) continue;
    present.add(id);
    nodes.push({
      id,
      text,
      x: num(n.x, 0),
      y: num(n.y, 0),
      w: Math.max(80, num(n.w, 176)),
      h: Math.max(48, num(n.h, 84)),
      color: color(n.c),
      cluster: null,
      kind: n.k === 'summary' ? 'summary' : 'idea',
      lastEditedBy: actor(n.b),
      editedAt: 0,
      selected: false,
    });
  }

  // A board with nothing on it is not a board.
  if (nodes.length === 0) return null;

  const edges: SceneEdge[] = [];
  for (const raw of asArray(wire.e)) {
    const e = raw as Partial<WireEdge>;
    const id = str(e.i, 64);
    const from = str(e.s, 64);
    const to = str(e.d, 64);
    if (!id || !from || !to) continue;
    edges.push({
      id,
      from,
      to,
      label: str(e.l, MAX_LABEL) ?? '',
      lastEditedBy: actor(e.b),
      editedAt: 0,
    });
  }

  const annotations: Annotation[] = [];
  for (const raw of asArray(wire.a)) {
    const a = raw as Partial<WireAnnotation>;
    const id = str(a.i, 64);
    const text = str(a.t, MAX_TEXT);
    if (!id || !text) continue;
    annotations.push({
      id,
      text,
      nodeId: str(a.n, 64),
      x: num(a.x, 0),
      y: num(a.y, 0),
      lastEditedBy: actor(a.b),
      editedAt: 0,
    });
  }

  const regions: Region[] = [];
  for (const raw of asArray(wire.r)) {
    const r = raw as Partial<WireRegion>;
    const id = str(r.i, 64);
    const label = str(r.l, MAX_LABEL);
    if (!id || !label) continue;
    regions.push({
      id,
      label,
      layout: layout(r.y),
      nodeIds: asArray(r.n)
        .map((v) => str(v, 64))
        .filter((v): v is string => v !== null),
      lastEditedBy: actor(r.b),
      editedAt: 0,
    });
  }

  // Validation above only proves each field is the right shape. The invariants
  // that span entities are re-established the same way a merge's are.
  return repairScene({ nodes, edges, annotations, regions });
};

// --- location hash ---------------------------------------------------------

export const hashForScene = (scene: Scene): string => `#${HASH_KEY}=${encodeScene(scene)}`;

export const sceneFromHash = (hash: string | null | undefined): Scene | null => {
  if (!hash) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const prefix = `${HASH_KEY}=`;
  if (!body.startsWith(prefix)) return null;
  return decodeScene(body.slice(prefix.length));
};

/** Absolute URL for this board, keeping whatever else the current URL carries. */
export const shareUrlFor = (scene: Scene, href: string): string =>
  `${href.split('#')[0]}${hashForScene(scene)}`;
