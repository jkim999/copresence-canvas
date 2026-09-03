import { useState } from 'react';
import { useJournalStore } from '../state/journal';
import { usePeerStore } from '../sync/peers';
import { useHostStore, type ToolDefinition } from '../agent/webmcp';
import { RECIPES } from '../agent/recipes';
import { beatFor, type Standing } from './firstRun';

/**
 * The first ten seconds, for somebody who arrives alone.
 *
 * The whole thesis of this page needs two actors moving at once, and two of the
 * three — your agent, and anyone else — are absent by default. So a visitor who
 * opens the deployed URL sees a still board and a wall of console text, and the
 * demo video is left carrying an argument the artifact could make for itself in
 * one click. Every other surface here was built to explain what is happening;
 * this is the one that makes something happen at all.
 *
 * It runs in three beats, because the argument has three parts and only one of
 * them can be made at a time:
 *
 *  1. Offer the act.
 *  2. WHILE IT RUNS, ask for a hand on a note. This is the product, and it is
 *     true for a few seconds only — someone who watches with their hands in
 *     their lap has seen an animation; someone who drags a note through it has
 *     seen the point. Earlier this instruction was on screen exclusively while
 *     nothing was happening.
 *  3. Then point at the second tab, which is the other half and is otherwise
 *     undiscoverable: there is no room to join, so nothing on this page ever
 *     says that opening the URL again seats a second person with their own
 *     agent. The Share button copies a board, which is a different idea.
 *
 * Then it leaves for good. An invitation that outstays the thing it was
 * inviting you to is just clutter with a dismiss button.
 */

interface Props {
  tools: ToolDefinition[];
}

/** The act that carries the argument: several notes, moving, over seconds. */
const OPENING = 'affinity';

export const Invitation = ({ tools }: Props) => {
  const changes = useJournalStore((s) => s.events.length);
  const connected = useHostStore((s) => s.connected);
  // Any call at all, not just one that changed the board. A read leaves no
  // journal entry but does put the ledger up, which this would then sit on top
  // of — and somebody who has already called something does not need inviting.
  const calls = useHostStore((s) => s.calls.length);
  const peers = usePeerStore((s) => s.peers.length);
  const [step, setStep] = useState<Standing['step']>('idle');
  const [blocked, setBlocked] = useState(false);

  const beat = beatFor({ step, changes, calls, connected, peers });
  if (beat === 'gone') return null;

  const recipe = RECIPES.find((r) => r.id === OPENING);
  if (!recipe) return null;

  const start = async () => {
    setStep('running');
    await recipe
      .run(async (name, args) => {
        const tool = tools.find((t) => t.name === name);
        if (!tool) throw new Error(`No such tool: ${name}`);
        return tool.execute(args);
      })
      // The console reports its own failures; putting an error back on screen
      // here would be the worst of both — a first impression that is a stack
      // trace. Either way the act is over, so the next beat is owed.
      .catch(() => undefined);
    setStep('ran');
  };

  // Same page, second seat. Opening it for them is the honest demonstration
  // that no room, code or invite exists — the URL is the whole mechanism.
  const openSecondSeat = () => {
    // A blocked popup returns null, and taking the card down on that would cost
    // the visitor both the tab and the instruction for opening one themselves.
    if (window.open(window.location.href, '_blank', 'noopener') === null) {
      setBlocked(true);
      return;
    }
    setStep('dismissed');
  };

  const dismiss = (
    <button
      type="button"
      className="invitation-dismiss"
      onClick={() => setStep('dismissed')}
      aria-label="Dismiss the introduction"
    >
      Dismiss
    </button>
  );

  if (beat === 'drag') {
    return (
      // aria-live, because the one instruction that matters arrives while the
      // visitor is watching the notes rather than this corner of the screen.
      <div className="invitation running chrome-surface" aria-live="polite">
        <p className="invitation-lede">
          <strong>Drag a note</strong> — now, while it works. It will let go.
        </p>
        {dismiss}
      </div>
    );
  }

  if (beat === 'second') {
    return (
      <div className="invitation chrome-surface" aria-live="polite">
        <p className="invitation-lede">
          That was one agent. Now open this page a second time — that tab is a
          second person, with an agent of their own.
        </p>
        <button type="button" className="invitation-go" onClick={openSecondSeat}>
          Open a second seat
        </button>
        <p className="invitation-aside">
          {blocked
            ? 'Your browser blocked that window — open this page’s address in a tab of your own instead. That is the entire mechanism.'
            : 'No room, no code, no server. Both boards are already the same board.'}
        </p>
        {dismiss}
      </div>
    );
  }

  return (
    <div className="invitation chrome-surface">
      <p className="invitation-lede">
        An agent and a person edit this board at the same time. Nobody waits a turn.
      </p>
      <button type="button" className="invitation-go" onClick={() => void start()}>
        Watch it happen
      </button>
      <p className="invitation-aside">
        Then <strong>drag a note of your own</strong> while it works — that is the whole idea.
      </p>
      {dismiss}
    </div>
  );
};
