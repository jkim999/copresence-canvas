import { useEffect, useRef, useState } from 'react';
import type { ToolDefinition } from '../agent/webmcp';
import { BEATS, beatById, roleFrom, type BeatId, type Role } from './autopilot';

/**
 * The autopilot's control surface, and the wire between the two seats.
 *
 * One channel, one message: the beat to run. Both tabs hold the same timeline,
 * so the director does not need to describe what the other seat should do —
 * only which beat everyone is in. That keeps the wire trivial and, more
 * usefully, keeps the two halves of a beat written next to each other where a
 * mismatch is visible.
 *
 * Deliberately separate from the board's own channel. This is stagecraft, and
 * it must not be able to corrupt a scene or a presence roster if it goes wrong.
 */

const CHANNEL = 'copresence:demo';

interface Props {
  tools: ToolDefinition[];
}

export const DemoBar = ({ tools }: Props) => {
  const [role, setRole] = useState<Role | null>(null);
  const [running, setRunning] = useState<BeatId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const channelRef = useRef<{ channel: BroadcastChannel; run: (id: BeatId) => Promise<void> } | null>(
    null,
  );

  useEffect(() => {
    setRole(roleFrom(window.location.search));
  }, []);

  useEffect(() => {
    if (role === null) return undefined;

    const call = async (name: string, args: unknown) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`No such tool: ${name}`);
      return tool.execute(args);
    };

    const run = async (id: BeatId): Promise<void> => {
      // One beat at a time. Two overlapping beats would put two hands and two
      // acts on the same notes, and every refusal in the video would be
      // ambiguous about which one it was refusing.
      if (busy.current) return;
      const beat = beatById(id);
      if (!beat) return;
      busy.current = true;
      setRunning(id);
      setError(null);
      try {
        // A beat that never settles would leave the bar disabled for the rest
        // of the session, which on a recording day is worse than a beat that
        // fails loudly. One tab wedged exactly this way in rehearsal.
        const result = await Promise.race([
          role === 'a' ? beat.a({ call }) : beat.b({ call }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`beat "${id}" gave up after 45s`)), 45_000),
          ),
        ]);
        // What the beat came back with, kept where a rehearsal can read it. The
        // two beats that matter are the two that are supposed to be refused,
        // and a refusal is a return value, not an exception.
        (globalThis as { __demo?: unknown }).__demo = { beat: id, result };
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy.current = false;
        setRunning(null);
      }
    };

    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<{ beat?: string }>) => {
      const id = event.data?.beat;
      if (typeof id === 'string') void run(id as BeatId);
    };
    channelRef.current = { channel, run };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [role, tools]);

  if (role === null) return null;

  const start = (id: BeatId): void => {
    const wired = channelRef.current;
    if (!wired) return;
    // Both seats are told, including this one, so a beat begins in the two tabs
    // from the same message rather than from two different clocks.
    wired.channel.postMessage({ beat: id });
    void wired.run(id);
  };

  return (
    <div className={`demo-bar ${role}`}>
      <span className="demo-role">seat {role.toUpperCase()}</span>
      {role === 'a' ? (
        BEATS.map((beat) => (
          <button
            key={beat.id}
            type="button"
            onClick={() => start(beat.id)}
            disabled={running !== null}
            className={running === beat.id ? 'on' : undefined}
          >
            {beat.title}
          </button>
        ))
      ) : (
        <span className="demo-idle">{running ? `running ${running}` : 'following seat A'}</span>
      )}
      {error && <span className="demo-error">{error}</span>}
    </div>
  );
};
