import { beforeEach, describe, expect, it } from 'vitest';
import { buildTools } from '../tools';
import { useSceneStore } from '../../state/sceneStore';
import { LOCAL_AGENT, LOCAL_HUMAN, agentId, humanId } from '../../state/actors';

/**
 * What the agent is told about the people it shares the board with. Agents take
 * grip now, so "somebody is holding this" and "a *person* is holding this" have
 * stopped being the same sentence — and only the second one should stop a tool.
 */

const ALEX = humanId();
const OTHER_AGENT = agentId();

const activity = buildTools().find((t) => t.name === 'get_human_activity')!;
const store = () => useSceneStore.getState();
const node = (i = 0) => store().scene.nodes[i];

interface Activity {
  holdingRightNow: { id: string }[];
  heldByOtherAgents: { id: string }[];
  note: string;
}

const ask = async (): Promise<Activity> => (await activity.execute({})) as Activity;

describe('what the agent is told about hands on the board', () => {
  beforeEach(() => {
    store().resetScene();
    store().clearGrip();
  });

  it('reports a note a person is holding', async () => {
    store().setGrip([node().id], ALEX);

    const seen = await ask();

    expect(seen.holdingRightNow.map((h) => h.id)).toEqual([node().id]);
    expect(seen.note).toContain('holding');
  });

  it('does not call another agent a person', async () => {
    // The whole tool exists so the agent works around people. Reporting a
    // machine's grip as a human's makes it defer to nobody.
    store().setGrip([node().id], OTHER_AGENT);

    const seen = await ask();

    expect(seen.holdingRightNow).toEqual([]);
    expect(seen.heldByOtherAgents.map((h) => h.id)).toEqual([node().id]);
  });

  it('does not report the asking agent back to itself', async () => {
    store().setGrip([node().id], LOCAL_AGENT);

    const seen = await ask();

    expect(seen.holdingRightNow).toEqual([]);
    expect(seen.heldByOtherAgents).toEqual([]);
  });

  it('keeps the two apart when both are holding something', async () => {
    store().setGrip([node(0).id], LOCAL_HUMAN);
    store().setGrip([node(1).id], OTHER_AGENT);

    const seen = await ask();

    expect(seen.holdingRightNow.map((h) => h.id)).toEqual([node(0).id]);
    expect(seen.heldByOtherAgents.map((h) => h.id)).toEqual([node(1).id]);
  });
});
