import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../sceneStore';
import { LOCAL_HUMAN, agentId, humanId, kindOf } from '../actors';
import { toMarkdown } from '../../data/exportMarkdown';
import { decodeScene, encodeScene } from '../../data/shareLink';
import type { Scene } from '../types';

/**
 * The identity refactor only pays for itself if provenance works for actors
 * that are not the local pair. Every check here uses a minted participant id,
 * because the whole app used to compare against the literals 'human'/'agent'
 * and would still pass if it silently kept doing so.
 */

const BO = agentId();
const ALEX = humanId();

const reset = () => useSceneStore.getState().resetScene();
const store = () => useSceneStore.getState();

describe('a second agent on the board', () => {
  beforeEach(reset);

  it('is recognised as an agent by the provenance rule', () => {
    expect(kindOf(BO)).toBe('agent');
    expect(kindOf(ALEX)).toBe('human');
    expect(BO).not.toBe('agent');
  });

  it('can have its work undone by "undo the agent"', () => {
    const target = store().scene.nodes[0];
    store().snapshot('Bo arranges the board', BO);
    store().moveNodes({ [target.id]: { x: 4000, y: 4000 } }, BO);

    const undone = store().undoLastAgentAction();

    expect(undone?.by).toBe(BO);
    expect(store().getNode(target.id)!.x).toBe(target.x);
  });

  it('does not have a second person\'s edits undone by "undo the agent"', () => {
    const target = store().scene.nodes[0];
    store().snapshot('Alex moves a note', ALEX);
    store().moveNodes({ [target.id]: { x: 4000, y: 4000 } }, ALEX);

    expect(store().undoLastAgentAction()).toBeNull();
    expect(store().getNode(target.id)!.x).toBe(4000);
  });

  it('is attributed in the Markdown export', () => {
    const target = store().scene.nodes[0];
    store().moveNodes({ [target.id]: { x: 10, y: 10 } }, BO);

    const line = toMarkdown(store().scene)
      .split('\n')
      .find((l) => l.includes(target.text));

    expect(line).toContain('_(agent)_');
  });

  it('does not put an agent stamp on a second person\'s note', () => {
    const target = store().scene.nodes[1];
    store().moveNodes({ [target.id]: { x: 10, y: 10 } }, ALEX);

    const line = toMarkdown(store().scene)
      .split('\n')
      .find((l) => l.includes(target.text));

    expect(line).not.toContain('_(agent)_');
  });

  it('still cannot take a note out of a hand that is holding it', () => {
    const held = store().scene.nodes[0];
    store().setHumanGrip([held.id]);

    store().moveNodes({ [held.id]: { x: 9999, y: 9999 } }, BO);

    expect(store().getNode(held.id)!.x).toBe(held.x);
    store().setHumanGrip([]);
  });
});

describe('a shared link carrying more than the local pair', () => {
  it('round-trips participant ids rather than flattening them to human/agent', () => {
    const scene: Scene = {
      nodes: [
        { id: 'n_0', text: 'Bo moved this', x: 0, y: 0, w: 176, h: 84, color: '#faf1e8',
          cluster: null, kind: 'idea', lastEditedBy: BO, editedAt: 0, selected: false },
        { id: 'n_1', text: 'Alex wrote this', x: 10, y: 10, w: 176, h: 84, color: '#faf1e8',
          cluster: null, kind: 'idea', lastEditedBy: ALEX, editedAt: 0, selected: false },
      ],
      edges: [],
      annotations: [],
      regions: [],
    };

    const out = decodeScene(encodeScene(scene))!;

    expect(out.nodes[0].lastEditedBy).toBe(BO);
    expect(out.nodes[1].lastEditedBy).toBe(ALEX);
  });

  it('still reads a link published before participants existed', () => {
    // Every share link already in the wild carries these two literal ids.
    const legacy: Scene = {
      nodes: [
        { id: 'n_0', text: 'agent work', x: 0, y: 0, w: 176, h: 84, color: '#faf1e8',
          cluster: null, kind: 'idea', lastEditedBy: 'agent', editedAt: 0, selected: false },
        { id: 'n_1', text: 'human work', x: 0, y: 0, w: 176, h: 84, color: '#faf1e8',
          cluster: null, kind: 'idea', lastEditedBy: LOCAL_HUMAN, editedAt: 0, selected: false },
      ],
      edges: [],
      annotations: [],
      regions: [],
    };

    const out = decodeScene(encodeScene(legacy))!;

    expect(out.nodes[0].lastEditedBy).toBe('agent');
    expect(kindOf(out.nodes[0].lastEditedBy)).toBe('agent');
    expect(kindOf(out.nodes[1].lastEditedBy)).toBe('human');
  });
});
