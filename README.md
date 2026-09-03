# Co-Presence Canvas

**One board. A person and an agent working on it at the same time. Three things outrank the agent: a hand, the room, and reality.**

Live: **https://copresence-canvas.vercel.app/** — open it in Chrome with
`chrome://flags/#enable-webmcp-testing` on, or in ChatGPT's in-app browser.
Built for the [WebMCP Challenge](https://webmcp.devpost.com/).

---

## What it is

An infinite canvas of sticky notes — the demo board is a software project mid-planning,
a week in. Your agent gets eleven tools on it: read the board, group notes, draw links,
annotate, restructure the whole thing. It shows up as a second labelled cursor, walks to
each note, picks it up and carries it somewhere better.

You never wait your turn. Drag notes of your own the entire time it's working. That part
is easy and lots of things do it.

The part that isn't:

**If you grab a note the agent is carrying, it lets go.** Permanently, for that note, and
the tool result tells the model which notes it lost and who took them — in a sentence
written for a model to read: *the human took those notes while you were moving them, do
not move them back unless asked.* Without that last bit an agent just helpfully undoes
you on its next turn.

**Anything that rewrites the whole board goes to the room.** Not to "the user" — to every
seat currently on the board. Any one of them can refuse, and saying nothing for ten
seconds counts as refusing. There's no server arbitrating that. There's no server at all.

**And a write can be refused because the board it was planned against is gone.** Reads hand
back a bookmark. A write can cite the one it was planned from, and if anybody else touched
the notes it names in between, the page declines the call, changes nothing, and tells the
model who moved what and to go and look again. This is the dull one and probably the
important one: the grip needs a hand to land inside about 440ms, but the seconds a model
spends deciding are always there, and on a board with other people on it that's long
enough for the plan's premise to stop being true. It's compare-and-swap, except a backend
gets that free from its database and a page has to keep the bookmark itself.

That's the thesis. An agent that can act on a live page is table stakes now. An agent that
can be *outranked* is the thing WebMCP actually unlocks, and every one of those three
refusals is unavailable anywhere else: a grip lives about 300ms in one tab and never
reaches a database, the room is whoever happens to be here this second, and the read that
a write is premised on happened in *this* page against a scene held in memory. No backend
tool can see any of it, and browser automation can't express it — automation *is* the
user, so there's nobody to subordinate.

## Multiplayer, and why it's here

Open the URL twice. That's two seats, same board, peer-to-peer over Yjs, no room codes
and no accounts. Each seat is one human plus one agent.

This isn't a bonus feature, it's what makes the consent rule mean anything. "Ask the user
before doing something destructive" is a solved, boring problem. "Ask *the four people and
three agents currently on this board*, and proceed only if nobody objects" is a different
problem, and it's the one that shows up the moment agents are real participants in shared
software.

## The tools

Eleven, registered through `document.modelContext.registerTool` with real JSON Schemas —
the Tools tab in the app shows each one live.

| | |
|---|---|
| `get_scene` | The whole board as JSON. 28 notes, edges, regions and annotations comes to about 4 KB. |
| `what_changed` | Cursor-based diff since you last looked. |
| `get_board_context` | Who's here, what they're doing, what consent would cost you. |
| `get_human_activity` | What the humans just touched, and what they're holding *right now*. |
| `arrange_region` | The headline one. Ids + a layout (`cluster`, `timeline_horizontal`, `grid`, `hierarchy`) + a label. |
| `find_and_link` | Labelled edges between notes, given a stated criterion. |
| `annotate_scene` | Pin a comment to a note or the board. Thinking in space without moving anything. |
| `summarize_cluster` | Collapse a group into one note, rewiring its outside edges. |
| `add_notes` | Contribute material, not just rearrange it. |
| `reorganize_board` | Restructure everything. Goes to the room. Takes no for an answer. |
| `undo_last_agent_action` | The agent reverts its own last change. |

Anything that writes takes an optional `basedOn` — the `asOf` from the read it was planned
from. Cite it and the page will refuse the call rather than let it land on a board that
moved underneath. Omit it and you write blind, exactly as before; the gate is a guarantee
offered, not a toll charged, so a host that's never heard of it keeps working.

Tools take **ids and intent, never pixels**. The model decides what belongs together and
what shape the group should be; the page computes where things go. That division is why a
language model is reliable at a geometry task it would otherwise be terrible at.

`get_scene` never queues, so the agent can always look, even mid-move. Everything that
writes queues through one body — a host will happily fire two write tools at once, and two
calls driving one cursor means one animation promise never settles and that tool call hangs
forever.

## The parts that took the longest

**Yielding is told to both sides.** For a long time `yieldedToHuman` went only to the model
— the human felt a note stop moving and got told nothing. The board now logs it, naming who
took it, captured at the instant of the yield. Read grip a frame later and you find an
opened hand.

**Stopping is cooperative.** The stop button doesn't kill mid-flight tweens, it checks
between notes, so the board is always left in an arrangement somebody chose. The tool result
says `stoppedByHuman` and which notes it never reached, because a short result an agent has
to infer from is exactly how it decides to helpfully retry.

**One journal, two audiences.** Changes are derived by diffing the scene store, not by each
action reporting itself — so nothing can forget to write an entry, and a peer's change is
recorded from what actually arrived rather than what they claimed. `what_changed` and the
History panel render the same facts.

**Intent never goes in the CRDT.** What a seat is *about* to do rides on presence, so a tab
that dies mid-act stops heartbeating and its promise about the future dies with it.
Selection too — what you have selected is a fact about you, not about the board.

**A caret is a hand.** Notes were held while being dragged and not while being typed in,
so an agent would carry a note away mid-sentence — the textarea rides along and keeps
focus, so you end up typing into a box sliding across the board — and the blur that
followed wrote your stale draft over whatever had arrived. Both hands now claim through
one union, because the store's grip is one claim per actor and wiring the caret straight
into it would have made drag and edit drop each other.

**Refusals aren't journalled.** The record is derived strictly by diffing the scene, and a
refusal is the case where the scene didn't move. It shows up in the ledger beside the call
it refused, which is where this board already shows agent activity that left no mark.

**A seat is a tab, and a reload is that seat coming back.** It lives in `sessionStorage`.
Before that, every load minted a fresh identity and the old one sat in the room for 90
seconds — so someone who'd reloaded twice couldn't reorganise their own board. Earlier
versions of themselves were vetoing it.

## Bring your own board

- **Your notes** — paste a retro, a transcript, a backlog. One line, one note. List marks
  and headings stripped, duplicates dropped, each note coloured by what it looks like
  (quote, metric, dated event, hypothesis, action) so everything works on material it's
  never seen.
- **Copy** — leaves as Markdown, groups as headings in the order your eye reads them,
  agent comments still attributed.
- **Share** — a link carrying the board itself, geometry included, compressed into the
  fragment. A fully organised 28-note board is a 2.3 KB URL. Nothing is uploaded; there's
  nowhere to upload it to. Import treats every field in that hash as hostile.

**Slowing it down.** Add `?pace=2` to the URL and every duration in the choreography
stretches by that factor — up to 4x. It's there because the yield is only witnessable
while a note is in flight, and at true speed that's about 440ms, which is easier to watch
than to interrupt. It scales pacing only: what the agent may do, what the page refuses and
what either side is told are identical at any pace.

## Running it

```
npm install
npm run dev      # http://localhost:5173
npm run test     # 406 tests
npm run build
```

Tests cover the places where a regression would be invisible on screen: chronology
inference, every layout's centring and totality, overlap relaxation, the grip invariant at
the store level, presence and seat identity, the consent gate, share-link round trips and
its refusal of payloads it can't trust. One test pins the demo board to its exact
coordinates so the board in the video can't drift. The staleness gate is tested through the
registered tool rather than the rule alone — that the write is refused *before* anything
moves, that the board is byte-identical afterwards, and that a peer's note is still where
the peer left it.

**Without a WebMCP host** the Agent console in the side panel drives the identical
registered handlers — it substitutes keyword heuristics for the model's judgement, then
calls the same code path. No private back door into the store. The header pill always says
which of the two you're looking at.

## Layout

```
src/
  state/     scene store, seat identity, the journal, the consent gate
  sync/      Yjs doc, presence, peers — no server
  agent/     registration, the eleven tools, choreography, geometry, motion
  canvas/    React Flow wiring, notes, cursors, regions
  data/      seed board, palette, import, Markdown and link export
  ui/        top bar, panel, ledger, history, dialogs
```

React 19 · Vite · TypeScript strict · React Flow · Zustand · Yjs · lz-string. No backend,
no database, no runtime network calls.

MIT — see [LICENSE](./LICENSE).
