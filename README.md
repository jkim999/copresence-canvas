# Co-Presence Canvas

**An infinite canvas where you and an AI agent edit the same live scene at the same time.**

The agent appears as a second, labelled cursor. It travels to a note, picks it up,
and carries it somewhere better — while you keep dragging notes of your own. You are
never asked to wait your turn.

Built for the [WebMCP Challenge](https://webmcp.devpost.com/). Everything the agent
touches lives in the page's own memory. **There is no server holding this state, and
no API that could reach it.**

---

## The idea

Almost every "AI in an app" experience today is a chatbox that drives the product one
turn at a time: you ask, you wait, it acts, you look. The human is idle for half the
interaction, and the agent is blind between turns.

WebMCP makes a different shape possible. Because tool handlers run *inside the page*,
against live client-side state, the agent doesn't have to take a turn at all. It can
act **concurrently** with you, on the same objects, in the same coordinate space.

Co-Presence Canvas is built to make that difference visible in five seconds:

> You are dragging a sticky note. At the same moment, a teal cursor labelled
> **Agent** walks across the board, picks up six other notes one by one, and lays them
> out into a chronological timeline. Neither of you stops for the other.

That is the whole product thesis. The collaboration *is* the feature.

## Why this needs WebMCP specifically

A canvas is the sharpest possible case for in-browser tools, because a canvas is
almost entirely **client-side state that no server models**:

| | Server-side API | WebMCP (this) |
|---|---|---|
| Where node positions live | nowhere — they're ephemeral UI state | the page, readable directly |
| How the agent "sees" | screenshot → vision model → guesswork | `get_scene` → 4 KB of structured JSON |
| What the agent can do | request a save, wait for a round-trip | mutate the live scene at 60 fps |
| Human during agent action | blocked, or fighting a stale write | still dragging, uninterrupted |
| Cost of one board read | a full-page screenshot | ~1,100 tokens for 28 notes |

The board in this repo serialises to **4,388 bytes** for 28 notes, edges, regions and
annotations. That is the token-efficiency story, and it is why the agent is reliable:
it addresses notes by id, never by pixel.

## Design principles

These were decided up front and every part of the code answers to them.

1. **Simultaneity over turn-taking.** Human input is never blocked. Exactly one
   action — the destructive whole-board restructure — pauses for consent.
2. **The agent is a physical actor.** It has a body. It *travels* to each note before
   moving it, and the note it just grabbed is still in flight while the cursor walks to
   the next one. Nothing teleports. The travel animation is the story, not decoration.
3. **Tools take ids and intent, never pixels.** The agent decides *what* belongs
   together and *what shape* the group should take. The page computes *where*. This is
   what keeps a language model reliable at a geometry task.
4. **`get_scene` returns JSON, not a screenshot.**
5. **Every mutation records `lastEditedBy`.** Provenance tinting and one-click
   "undo the agent" fall straight out of it.

### The human's grip is sacred

The one invariant that makes concurrent editing safe, in `sceneStore.moveNodes`:

```ts
// Never fight the human: a node under their cursor is theirs.
if (!p || grip.has(n.id)) return n;
```

If you grab a note the agent is mid-way through carrying, the agent's tween for that
note is cancelled on the next frame and it lets go permanently. No jitter, no tug of
war, no lost work.

## The tools

Nine tools are registered on the page. Open the **Tools** tab in the app to read each
one's live JSON Schema.

| Tool | Kind | What it does |
|---|---|---|
| `get_scene` | read | Every note with its id and text, plus edges, regions, annotations and bounds, as structured JSON. |
| `arrange_region` | write | **The headline tool.** Reposition a set of notes into `cluster`, `timeline_horizontal`, `grid` or `hierarchy`. Takes ids + a layout + an optional label. |
| `find_and_link` | write | Draw labelled edges between notes the agent judges related, given a stated criterion. |
| `annotate_scene` | write | Pin a floating comment to a note or to the board — thinking in space without moving anything. |
| `summarize_cluster` | write | Collapse a group into one summary note in place; edges to the outside world are rewired to it. |
| `add_notes` | write | Contribute new material, not just rearrange existing notes. |
| `reorganize_board` | **gated** | Restructure everything at once. Asks the human first, and takes no for an answer. |
| `get_human_activity` | read | What the human has been doing alongside you: notes they recently added, edited or moved, and the notes they are **holding right now**. |
| `undo_last_agent_action` | write | The agent reverts its own last change. |

Two details in the tool contract are worth calling out, because they are where
co-presence stops being a demo and starts being a protocol:

- **`yieldedToHuman`** — if you grab a note the agent is carrying, it lets go, and the
  tool result names that note back to the model with *"the human took those notes while
  you were moving them… do not move them back unless asked."* The agent finds out it was
  interrupted, and by whom.
- **Perception, not just action.** `get_human_activity` lets the agent ask what you are
  doing *right now* — which notes you are physically holding, which you just touched —
  so it can work around you instead of over you. Acting concurrently is half of
  co-presence; noticing the other party is the other half.
- **`nudgedAside`** — a group laid out in place can land on notes that weren't part of
  it. The agent sweeps those just clear (never one you're holding) and reports which,
  so the board is never left overlapping and the model knows what else it disturbed.

**One body, one action.** A host may fire two write tools concurrently. Both would drive
the same cursor, and one call's animation promise would be dropped and never settle —
hanging that tool call forever. Actions therefore queue through `withAgentBody`, while
`get_scene` never queues: the agent can always look at the board, even mid-move.

### The call ledger

Motion alone cannot prove that a model decided anything — a scripted animation looks
identical from the outside. So the agent's calls sit **on the board** while the work is
still happening, with the arguments it actually chose:

```
get_scene()                                       → 28 notes · 4.3 KB · no screenshot
arrange_region(nodeIds: [n_12, n_13, n_14, +3],
               layout: "timeline_horizontal")     → moved 6 · timeline_horizontal
```

This is also where `yieldedToHuman` becomes visible rather than theoretical: grab a note
mid-carry and the ledger reports `yielded 1 to you` on the very call you interrupted.

**On honesty:** with a WebMCP host connected, a model chooses those ids and issues those
calls itself. With no host present, the console's recipes substitute keyword heuristics
for the model's judgement and then call the identical handlers — same code path, same
ledger, no private back door. The header pill always says which of the two you are
looking at.

### Bring your own board, and take it with you

The demo board proves the idea on a research-synthesis case; the three doors in and out
are what make it useful on your own material.

- **Your notes** — paste a retro, an interview transcript, a backlog. One line becomes
  one note; list marks, checkboxes and markdown headings are stripped, duplicates are
  dropped. Each note is coloured by what it looks like (quote, metric, dated event,
  hypothesis, action) so every console recipe works on material it has never seen.
- **Copy** — the organised board leaves as Markdown: groups as headings in the order the
  eye reads them left to right, connections as prose, agent comments as block quotes, and
  anything the agent wrote still attributed. This is the board for a person to read.
- **Share** — a link that carries the board *itself*. Markdown keeps the conclusions and
  throws away the geometry, which is the part the agent actually produced; this keeps
  every position, group, edge and annotation. A fully organised 28-note board is a
  2,267-character URL.

Nothing is uploaded, and there is nowhere to upload it to. The URL **is** the save file:
the whole scene is compressed into the fragment, which never leaves the browser, and
opening the link rebuilds the board before the first frame is drawn.

Because a hash is the easiest thing in the world to hand someone, `decodeScene` treats
every field as hostile: colours must be plain hex (a note's colour reaches a style
attribute), text and coordinates are clamped, and the invariants the store keeps inside
single transactions — no edge to a missing note, no note in two regions, no empty region —
are rebuilt rather than trusted.

### The one confirmation beat

WebMCP has no standardised elicitation call today, so the page owns the gate. The tool
handler simply awaits a promise that a modal resolves:

```ts
const approved = await useConfirmStore.getState().request({ ... });
if (!approved) {
  return { approved: false, message: 'The human declined. Do not retry without new reasoning.' };
}
```

The agent's own tool promise does not settle until you decide. Every *other* action
stays ungated, because gating them all would quietly turn the product back into
turn-taking.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # geometry, chronology and the grip invariant
npm run build    # production build to dist/
```

`npm test` (69 tests) covers the parts where a silent regression would be invisible on
screen: chronology inference, every layout's centring and totality, overlap relaxation,
nearest-neighbour visiting, the grip invariant itself asserted at the store level (the
agent must not move a held note, and must be able to move it again the moment the human
lets go), import parsing, Markdown export, the ledger's call formatting, and the share link's
round trip and its refusal of a payload it cannot trust. One test
pins the seeded demo board to its exact historical coordinates, so the board in the
screenshots and the video cannot drift.

### Trying it with a real agent

Open the deployed URL in **ChatGPT's in-app browser**, or in Chrome with
`chrome://flags/#enable-webmcp-testing` enabled. The header pill turns green and names
the transport when a host is detected. Then just ask:

- *"Read the board and lay the dated notes out as a timeline."*
- *"Group the interview quotes together and tell me what they have in common."*
- *"Link each piece of evidence to the hypothesis it supports."*
- *"Reorganise the whole board by kind."* — this one will ask you first.

**Drag notes around while it works.** That is the demo.

### Trying it without a WebMCP host

The **Agent console** in the right-hand panel drives the *same registered handlers* a
host calls — it reads `get_scene`, picks note ids out of the text exactly as a model
would, then invokes the tool. It is not a private back door into the store; there is
one code path. Handlers are also on `window.__copresence.call` for poking at from
devtools:

```js
await window.__copresence.call.get_scene({})
await window.__copresence.call.arrange_region({
  nodeIds: ['n_12', 'n_13', 'n_14'],
  layout: 'timeline_horizontal',
  label: 'What happened, in order',
})
```

## How it's put together

```
src/
  state/        scene store — the single source of truth both actors mutate
  agent/
    webmcp.ts   host detection + registration + call instrumentation
    tools.ts    the nine tool definitions and their JSON Schemas
    actions.ts  choreography: cursor travel, carry, gather, gate
    layout.ts   geometry for the four layouts, chronology inference, overlap relaxation
    motion.ts   one rAF loop driving every concurrent tween, plus the watchdog
    recipes.ts  scripted agent behaviours for the in-page console
    callFormat.ts  renders a call compactly enough to sit on the board
  canvas/       React Flow wiring, sticky notes, agent cursor, regions, annotations
  data/         the seed board, note palette, import parsing, Markdown and link export
  ui/           top bar, side panel, the call ledger, the consent and import dialogs
```

Two functions carry the product:

**`applyLayout(nodes, layout, edges)`** — geometry for all four modes. `cluster` packs
into concentric rings around the group's own centroid; `timeline_horizontal` *infers
chronology from the note text* (`chronoKey` parses `Mar 3`, `2026-04-15`, `Q2`,
`step 3`) and falls back to spatial order; `grid` wraps into an aspect-balanced matrix;
`hierarchy` does a BFS over any edges inside the selection and layers by depth. Every
layout is centred on the group's existing centroid, so the board reorganises *in place*
rather than teleporting across the world. `relaxOverlaps` then pushes apart anything
still colliding, so the agent never leaves two notes stacked.

**`animateAgentCursorThrough(nodeIds, { targets })`** — visits notes in
nearest-neighbour order, and deliberately **overlaps travel with carry**: the note it
just grabbed is still tweening to its destination while the cursor walks to the next
one. Awaiting each move in turn would look like a batch job; overlapping them looks
like someone working.

### Two bugs worth knowing about

Both were found by running the thing, and both would have sunk the demo:

- **React Flow feedback loop.** In a fully controlled setup, React Flow echoes position
  changes back on every render. Writing those into the store feeds itself and pins the
  main thread. Position changes are now only accepted when `change.dragging` is true.
- **`requestAnimationFrame` stops in a hidden tab.** An agent may well be driving this
  page while it isn't the foreground tab — and a tool call whose animation never
  finishes is a promise that never settles, which strands the whole conversation. The
  motion loop now has a `setInterval` watchdog that steps the same clock forward
  whenever rAF has gone quiet, so every animation completes and every tool call always
  returns.

## Where this actually matters

Anywhere the meaningful state is spatial and lives only in the browser:

- **Research synthesis and affinity mapping** — the demo board is an onboarding-drop
  investigation, which is exactly the artefact a researcher has open at 6pm with 40
  notes and no structure.
- **Systems and incident design** — dependency graphs, blast-radius diagrams.
- **Retros and planning** — an agent that clusters 60 sticky notes *while the room is
  still adding them*, instead of after.
- **Anything a screenshot-driven agent handles badly**, which is every canvas.

## Stack

React 19 · Vite · TypeScript (strict) · [React Flow](https://reactflow.dev) · Zustand ·
lz-string · WebMCP. No backend, no database, no network calls at runtime.

## Licence

MIT — see [LICENSE](./LICENSE).
