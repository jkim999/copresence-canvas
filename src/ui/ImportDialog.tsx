import { useEffect, useMemo, useState } from 'react';
import { useSceneStore } from '../state/sceneStore';
import { MAX_NOTES, parseNotes } from '../data/importBoard';

const PLACEHOLDER = `Paste your retro, your interview notes, your backlog —
one thought per line.

- the checkout step confuses people
- "I couldn't tell what the plan included"
- Mar 3 — pricing page redesign
- conversion down 12% since launch`;

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * The demo board proves the idea; this is what makes the page useful on the
 * material the human already has open. Imported notes are coloured by what they
 * look like, so every console recipe works on them unchanged.
 */
export const ImportDialog = ({ open, onClose }: Props) => {
  const [raw, setRaw] = useState('');
  const loadTexts = useSceneStore((s) => s.loadTexts);
  const notes = useMemo(() => parseNotes(raw), [raw]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const load = () => {
    if (notes.length === 0) return;
    loadTexts(notes);
    setRaw('');
    onClose();
  };

  return (
    <div className="scrim chrome-surface" onClick={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="import-title">Put your own notes on the board</h2>
        <p>
          One line becomes one note. The agent's tools work on your material exactly as they do
          on the demo board — nothing leaves your browser.
        </p>
        <textarea
          className="paste"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoFocus
          aria-label="Your notes, one per line"
        />
        <div className="row">
          <span className="tally">
            {notes.length === 0
              ? 'Nothing to place yet'
              : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
            {notes.length >= MAX_NOTES && ` · capped at ${MAX_NOTES}`}
          </span>
          <button className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" onClick={load} disabled={notes.length === 0}>
            Replace the board
          </button>
        </div>
      </div>
    </div>
  );
};
