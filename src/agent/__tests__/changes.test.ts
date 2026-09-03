import { beforeEach, describe, expect, it } from 'vitest';
import { changesSince } from '../changes';
import { JOURNAL_LIMIT, recordFacts, resetJournal } from '../../state/journal';
import { me, myAgent, seatName, takeSeat } from '../../state/actors';
import { setRoomSource } from '../../sync/peers';

const PEER_AGENT = 'a_peer';

beforeEach(() => {
  resetJournal();
  takeSeat();
});

const add = (by: string | null, at = Date.now()) =>
  recordFacts([{ at, by, verb: 'added', ids: ['n1'], detail: 'a note' }]);

describe('changesSince', () => {
  it('says plainly that nothing happened, rather than returning an empty list alone', () => {
    const report = changesSince(0);
    expect(report.changes).toEqual([]);
    expect(report.note).toMatch(/nothing/i);
  });

  it('hands back a cursor to pass to the next call', () => {
    add(myAgent());
    const report = changesSince(0);
    expect(report.cursor).toBe(1);
    expect(changesSince(report.cursor).changes).toEqual([]);
  });

  it('starts a reader with no cursor at the present, not at the beginning of time', () => {
    add(myAgent());
    add(PEER_AGENT);
    const report = changesSince();
    expect(report.changes).toEqual([]);
    expect(report.cursor).toBe(2);
  });

  it('tells its own work apart from a peer’s', () => {
    add(myAgent());
    add(PEER_AGENT);
    const [mine, theirs] = changesSince(0).changes;
    expect(mine.by?.mine).toBe(true);
    expect(theirs.by?.mine).toBe(false);
  });

  it('names the seat, so a refusal naming that seat can be understood', () => {
    add(PEER_AGENT);
    const [change] = changesSince(0).changes;
    expect(typeof change.by?.seat).toBe('string');
    expect(change.by?.seat.length).toBeGreaterThan(0);
  });

  it('does not invent an author for a change the board cannot attribute', () => {
    recordFacts([{ at: Date.now(), by: null, verb: 'removed', ids: ['n1'], detail: 'gone' }]);
    const [change] = changesSince(0).changes;
    expect(change.by).toBeNull();
    expect(change.what).toMatch(/was removed/);
  });

  it('reports age in seconds, because a cursor alone does not say how stale it is', () => {
    add(myAgent(), Date.now() - 30_000);
    expect(changesSince(0).changes[0].secondsAgo).toBeGreaterThanOrEqual(29);
  });

  it('admits when it can no longer answer in full', () => {
    for (let i = 0; i < JOURNAL_LIMIT + 5; i += 1) {
      recordFacts([
        { at: i * 100_000, by: myAgent(), verb: 'added', ids: [`n${i}`], detail: 'x' },
      ]);
    }
    const report = changesSince(0);
    expect(report.complete).toBe(false);
    expect(report.note).toMatch(/get_scene/);
  });

  it('is complete when it really can answer in full', () => {
    add(myAgent());
    expect(changesSince(0).complete).toBe(true);
  });

  it('refuses a cursor from the future rather than pretending it is valid', () => {
    add(myAgent());
    const report = changesSince(9999);
    expect(report.changes).toEqual([]);
    expect(report.cursor).toBe(1);
  });

  it('ignores a cursor that is not a number', () => {
    add(myAgent());
    expect(changesSince(Number.NaN).changes).toEqual([]);
  });

  it('calls this tab’s own human by name too, so provenance is never ambiguous', () => {
    add(me());
    const [change] = changesSince(0).changes;
    expect(change.by?.mine).toBe(true);
    expect(change.by?.kind).toBe('human');
  });
});

describe('one seat, one name', () => {
  /**
   * The bug this exists for was visible only across two live tabs: an agent was
   * seated by the hash of its own id rather than beside its human, so one tab
   * answered to two unrelated names at once — get_board_context called it
   * Indigo while what_changed called its agent Umber. Nothing on the board
   * connected them, so a reader could not tell that the seat proposing a
   * reorganisation was the seat that had just moved eight notes.
   */
  it('names a peer’s agent after the peer, not after its own id', () => {
    const human = 'h_peer';
    const agent = 'a_peer';
    setRoomSource(() => ({
      peers: [
        {
          actor: human,
          name: 'Peer',
          holding: [],
          agent,
          agentHolding: [],
          selected: [],
          cursor: null,
          agentCursor: null,
          doing: null,
        },
      ],
      heardAgoMs: 0,
    }));
    try {
      recordFacts([
        { at: Date.now(), by: human, verb: 'moved', ids: ['n1'], detail: 'x' },
        { at: Date.now(), by: agent, verb: 'added', ids: ['n2'], detail: 'y' },
      ]);
      const [byHuman, byAgent] = changesSince(0).changes;
      expect(byAgent.by?.seat).toBe(byHuman.by?.seat);
      expect(byAgent.what).toBe(`${byHuman.by?.seat}’s agent added a note — “y”`);
    } finally {
      setRoomSource(null);
    }
  });

  it('calls this tab’s own pair you and your agent, never by seat name', () => {
    recordFacts([
      { at: Date.now(), by: me(), verb: 'moved', ids: ['n1'], detail: 'x' },
      { at: Date.now(), by: myAgent(), verb: 'added', ids: ['n2'], detail: 'y' },
    ]);
    const [byMe, byMine] = changesSince(0).changes;
    expect(byMe.what).toMatch(/^You moved/);
    expect(byMine.what).toMatch(/^Your agent added/);
  });
});

describe('an author who has already left', () => {
  /**
   * Work outlives the seat that made it. Seating an agent beside its human was
   * right, but it briefly dropped agents with no human in the room out of the
   * numbering altogether, so two of them whose ids hashed alike both answered
   * to one name — the ambiguity this whole file exists to remove, reintroduced
   * for precisely the author who can no longer be asked.
   */
  it('still tells two departed agents apart when their names collide', () => {
    // Chosen because they genuinely collide: both hash to the same seat name,
    // so this fails unless the numbering actually covers unpaired agents.
    const one = 'a_gone0';
    const two = 'a_gone17';
    expect(seatName(one)).toBe(seatName(two));

    recordFacts([
      { at: Date.now(), by: one, verb: 'added', ids: ['n1'], detail: 'x' },
      { at: Date.now(), by: two, verb: 'moved', ids: ['n2'], detail: 'y' },
    ]);
    const changes = changesSince(0).changes;
    expect(changes[0].by?.seat).not.toBe(changes[1].by?.seat);
  });
});
