import { useState } from 'react';
import { useJournalStore } from '../state/journal';
import { useHostStore, type ToolDefinition } from '../agent/webmcp';
import { RECIPES } from '../agent/recipes';

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
 * It says the thing the recording says out loud and no interface ever did: keep
 * dragging while it runs. That instruction is the product. Someone who watches
 * the agent work with their hands in their lap has seen an animation; someone
 * who drags a note through it has seen the point.
 *
 * It leaves the moment the board has a history, and does not come back. An
 * invitation that outstays the thing it was inviting you to is just clutter
 * with a dismiss button.
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
  const [dismissed, setDismissed] = useState(false);
  const [running, setRunning] = useState(false);

  // A board that has already been worked on needs no invitation to start, and a
  // host that is connected has a human who found their own way in.
  if (dismissed || running || changes > 0 || calls > 0 || connected) return null;

  const recipe = RECIPES.find((r) => r.id === OPENING);
  if (!recipe) return null;

  const start = async () => {
    setRunning(true);
    await recipe
      .run(async (name, args) => {
        const tool = tools.find((t) => t.name === name);
        if (!tool) throw new Error(`No such tool: ${name}`);
        return tool.execute(args);
      })
      // The console reports its own failures; this one has already taken itself
      // off screen, and putting it back to show an error would be the worst of
      // both — a first impression that is a stack trace.
      .catch(() => undefined);
  };

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
      <button
        type="button"
        className="invitation-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss the introduction"
      >
        Dismiss
      </button>
    </div>
  );
};
