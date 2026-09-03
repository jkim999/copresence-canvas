# Demo script — ChatGPT-browser version

The upgrade over `DEMO.md`: a real model drives the left seat, so the staleness beat stops
being staged. Nothing in this file has been run yet. `DEMO.md` is the verified fallback —
keep it, and do not delete a good take to attempt this.

Left tab: yours, driven from the ChatGPT chat. Right tab: second seat, driven by its panel
buttons. The chat attaches to one page at a time, so the right seat has to be button-driven
or the two agents can never move at once. Both go through the same registered handlers —
`webmcp.ts:227` hands the console the identical instrumented objects it hands
`registerTool` — so say that once on camera and it stops being a question.

## Pre-flight — do this before recording anything

Five checks, in order. Each one can kill a different beat.

1. **Pill.** Header reads *WebMCP live · document.modelContext · 11 tools* in both tabs.
2. **Tools fire from chat.** Prompt `Read the board and tell me what's on it.` A `get_scene`
   row must appear in the ledger. If not, nothing else in this file works.
3. **The cursor travels.** Prompt a write and watch. If notes *teleport*, the tab was
   `hidden` when the tool fired (`motion.ts:180` drops the animation; results and refusals
   are unaffected). Keep both tabs genuinely visible; if they still teleport, fall back.
4. **Two seats.** Roster shows exactly two, neither with a number after the name.
5. **`basedOn` gets cited.** The critical one — see below.

### The `basedOn` risk

`basedOn` is **optional** by design (`tools.ts:114`): a host that never heard of it keeps
working, and omitting it skips the staleness check. `get_scene`'s note tells the model to
cite it, but nothing forces it. **If the model omits it, Clip D silently succeeds instead of
refusing** — the worst failure mode in this script, because it looks like the feature isn't
there.

Rehearse Clip D once before recording and check the ledger row for the write carries
`basedOn`. If it doesn't, put it in the prompt: *"…and cite the asOf you just read."*
That is not cheating — the point on camera is that the page refuses, not that the model
guessed.

## The clips

Record six, not one take. Prompts are in `code`; quotes are spoken.

### Clip A - 15s - no narration

1. Right tab: press **Build the timeline**.
2. Straight away, left tab, into the chat: `Lay the actions out as a grid so nothing
   overlaps.`
3. When the second teal cursor appears, grab a quote note and drag until both acts finish.

The panel act is already travelling while the model decides, which is what buys the
overlap. **Retry if** only one teal cursor is visible.

### Clip B - 30s - what it is, and how it's built

Open the **Tools** tab, leave it up.

> "Okay - two people, two agents, one board.
>
> That teal cursor over there has somebody else's name on it. That's not a recording.
> That's the other person's agent, working on their screen, showing up on mine - while I'm
> dragging a note myself.
>
> Here's the whole thing. An infinite sticky-note canvas - React, Yjs for the peer-to-peer
> sync, no backend at all. On top of that, eleven tools registered on the page through
> `document.modelContext.registerTool`. Reads, writes, and one that asks permission.
>
> The schemas are the boring half. The interesting half is what comes back - three of these
> tools can refuse, and the refusal is the return value. The model gets told what stopped
> it and what to do instead, in the same JSON as a success. That's the bit you can only do
> from inside the page, and it's what the rest of this is."

### Clip C - 30s - a hand

Pick your note before you prompt: one mid-cluster, so the cursor reaches it a few seconds
in.

1. Chat: `Cluster the evidence by kind - quotes, metrics and risks in three groups.`
2. Grab your note *while the cursor is still travelling toward it*, and hold.

> "I've slowed the animation down so you can see this. Watch - I'm going to take a note
> right out of its hands."

Point at `yielded 1 to you`.

> "There. It yielded that note to me. And look at what it tells the model: *the human took
> those notes while you were moving them, don't move them back unless asked.*
>
> That last bit is the whole thing. Without it, the agent politely undoes me on its next
> turn.
>
> My hand on that note lasted about a second, in one tab, in memory. Nothing on a server
> could have known about it."

**Retry if** the ledger doesn't say `yielded` - you grabbed after that note was down.

### Clip D - 40s - reality

The payoff of doing this in chat. Read, interfere, write - in that order, as two separate
prompts. If the model reads and writes in one answer, nothing can happen in between and the
gate cannot fire.

1. Chat: `Read the board and list the risks for me.`

   > "Now the one that actually breaks agents on a shared page. First it reads the board."

2. **While it is still answering**, switch to the right tab and drag three `R1:`/`R2:` risk
   notes somewhere else.

   > "And while it's thinking, somebody else moves the exact notes it just read."

3. Chat: `Now group those risks together into one cluster.`

   > "Refused.
   >
   > It planned against a board that doesn't exist anymore. It names who got there first,
   > it says nothing was moved so their work is intact, and it tells the model to go and
   > look again instead of pushing harder.
   >
   > That's compare-and-swap - except a database gives you that for free, and a page has to
   > keep the bookmark itself. That read happened here, in memory, while the other tab was
   > changing it. No server ever saw either version."

**Retry if** the write succeeds instead of refusing: either the model omitted `basedOn`
(add the citation to the prompt) or you moved notes it hadn't named (use the risk notes).

**Bonus, if it happens:** a good model will call `what_changed` on its own after the
refusal and try again correctly. If it does, keep it - that is the loop closing on camera.

### Clip E - 35s - the room

1. Chat: `Reorganise the entire board.` Do not touch the right tab.

   > "Last one. This moves everything, so it asks first. And it doesn't ask me - it asks
   > everyone in the room. Any one of them can say no."

2. Let it time out - ten seconds, unaffected by `pace`.

   > "Nobody answered. Ten seconds of silence counts as no."

3. Prompt it again, approve in the right tab, talk over the restructure.

   > "Asking *the user* is a confirm dialog. That's solved.
   >
   > Asking whoever's actually in the room right now, where one person is enough to stop
   > the whole thing - that only works if the tools live where the room does."

**Retry if** no dialog appears in the right tab - it was dropped from the roster. Click it,
wait for two seats, start again.

### Clip F - 20s - land it

> "So: a shared canvas, no server, and eleven page-side tools that two people and two
> agents can drive at the same time.
>
> Three things outrank the agent here - a hand on a note, the room, and whether the board
> it planned against still exists. A server can't know any of those. It can't be
> interrupted by a hand, it can't ask a room, and it can't tell you the ground moved under
> a read it never saw.
>
> This one's in the room."

## Setup

Same as `DEMO.md`: close every tab, wait ~90s for ghosts, open two fresh at `?pace=2`,
side by side, never covered, never duplicated (Chrome copies `sessionStorage` and both
tabs become one seat, which kills the grip).

`pace=2` still matters for Clip C only - it scales tween durations and nothing else. The
consent timeout is a flat `NO_ANSWER_MS = 10_000` and does not stretch.
