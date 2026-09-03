# Demo script

Target **2:50**, hard ceiling 3:00. Public YouTube, audio on. Judges watch this before
they open the URL, so the first fifteen seconds have to carry the idea without narration.

The spine is three refusals, in ascending order of how much they cover: **a hand**, then
**reality**, then **the room**. Each one is the page telling the agent no, for a reason no
server could have known.

**Both windows are open and side by side from frame one.** The opening shot is two agents
and a human hand moving notes on the same board at the same time — that is the whole claim,
and it should be visible before a word is said. Nothing later needs to be set up on camera.

## Before you record

- **Close every tab of the deployed site, then open two fresh ones.** A room that already
  holds a board wins over a new tab's seed, so a stale tab keeps serving the old board.
  Open the first, let it settle, then the second.
- **Both at `?pace=2`** — `https://copresence-canvas.vercel.app/?pace=2`. At true speed a
  note is in flight under half a second and a six-note act is over in four, which is long
  enough to see and too short to interrupt. `pace` scales durations and nothing else: same
  code, same refusals, same results. Say "I've slowed the animation down" once, on camera,
  the first time you grab a note.
- **Left window `?demo=a&pace=2`, right window `?demo=b&pace=2`.** The `demo` flag puts a
  small bar at the bottom of each: five buttons in the left one, and the right one follows.
  You press one button per beat and narrate. Nothing else is manual.
- Check the header pill reads *WebMCP live · document.modelContext · 11 tools* in both.
- Check the roster shows exactly two seats, and that neither name has a number after it.
  A number means departed authors are still on the board — close both tabs, wait ninety
  seconds, and reseed.
- **Never minimise or fully cover the second window** — a hidden tab lands every animation
  instantly and throttles its heartbeat, so its agent can look absent.
- Check the roster in the left window shows two seats before you record.
- Practise the grab. You want to be *continuously* dragging while both agents work.
- Have the four chat prompts written down. Fumbling one on camera costs ten seconds you
  do not have.

## Run it from the bar

Every beat drives both seats. The left window posts which beat is starting, both windows
run their half of it, and the hand you see moving notes is taken and released through the
same grip a pointer uses — so the agent can still refuse it, and in two of these beats it
is supposed to.

Record five clips, one per button, and cut them together. Verified end to end on 3 Sep.

---

### A · two agents and a hand — 15s, no narration

Press **A**. The left seat grids the actions while the right seat builds the timeline, and
a hand drags a quote note across the board the whole time. Three cursors, nobody waiting.

Say nothing over this one.

---

### Say what it is — 50s

Open the **Tools** tab and leave it up. Don't read this. Read it twice, then say it your
way — the point is to sound like you're explaining it to one person, not presenting.

> "So — Notion's AI can edit a doc while you're sitting in it. That already works. But
> that's Notion's agent, inside Notion, on their servers.
>
> What I wanted to see was what happens when the agent isn't yours. You turn up with
> ChatGPT, and my page has to work out what it'll let you do.
>
> And what happens when there's two of them. Your agent and my agent, same space, both
> going for the same note. Nothing accounts for that — Notion doesn't have to, there's only
> ever one agent and it's theirs. Everything I hit only shows up once there's more than one
> of you.
>
> It's just sticky notes. React, Yjs between the two windows, no backend — there's nothing
> behind it.
>
> The WebMCP bit's eleven tools on `document.modelContext.registerTool`. Couple of things I
> ran into. There's no way for a tool to ask the user anything yet, so the handler for the
> destructive one just sits there and waits — and it asks everyone on the board, not only
> whoever prompted it.
>
> And when the page says no, that comes back as a return value, not an error. Throw at a
> model and it'll just try again. Tell it what it ran into and who got there first, and it
> usually does something sensible instead.
>
> Anyway — that's what the next minute is."

Running long? Cut *"You turn up with ChatGPT…"* — the paragraph after it makes the same
point harder.

**Do not say "a server couldn't do this."** It could — Notion's server knows who is in the
document, could prompt them, and gets compare-and-swap free from its database. The claim
that survives a judge who works on one of those products is narrower: the agent is not the
vendor's, and a merge rule is not a decision.

### C · take a note out of its hands — 30s

Press **C**. A hand takes one of the notes the agent is about to cluster and keeps moving
it. Result: `yielded 1 to you`, and the act lands the other five.

> "I've slowed the animation down so you can see this. My hand is on that note while the
> agent is working, and watch what it does with it.
>
> There - it yielded that note to me. And look at what it tells the model: *the human took
> those notes while you were moving them, don't move them back unless asked.*
>
> That last bit is the whole thing. Without it, the agent politely undoes me on its next
> turn.
>
> My hand on that note lasted about a second, in one tab, in memory. Nothing on a server
> could have known about it."

---

### D · the board moved underneath it — 40s

Press **D**. The left agent reads the board and keeps the bookmark. A second later the
person in the right seat drags three risk notes away. Four seconds after that, the left
agent writes — citing the board it read.

> "Now the one that actually breaks agents on a shared page. It reads the board, it takes a
> few seconds to decide - and in those seconds somebody else moves the notes it was about
> to rearrange.
>
> Refused. It planned against a board that doesn't exist anymore. It names who got there
> first, it says nothing was moved so their work is intact, and it tells the model to go and
> look again instead of pushing harder.
>
> That's compare-and-swap - except a database gives you that for free, and a page has to
> keep the bookmark itself. That read happened here, in memory, while the other window was
> changing it. No server ever saw either version."

---

### E1 · silence is a refusal — 20s

Press **E1**. Nobody answers. Ten seconds later: *nobody answered in time, so nothing was
moved.*

> "Last one. This moves everything, so it asks first. And it doesn't ask me - it asks
> everyone in the room. Any one of them can say no. Ten seconds of silence counts as no."

---

### E2 · the room says yes — 20s

Press **E2**. Both seats approve and the board restructures. Talk over it.

> "Now I'll say yes."

Let the restructure play out under the next beat. E1 already made the point; E2 only has to
show the gate lets work through.

---

### Land it — 20s

> "So: a shared canvas, no server, and eleven page-side tools that two people and two agents
> can drive at the same time.
>
> Three things outrank the agent here — a hand on a note, the room, and whether the board it
> planned against still exists. Those aren't merge rules. They're decisions.
>
> And none of this needs a server — more to the point, none of it belongs to one. The page
> sets the terms for an agent it didn't ship.
>
> This one's in the room."

---

## If a beat fails on camera

- **No yield on beat C** — the driven hand takes its note before the act begins, so this
  should not happen. If it does, the board has no quote notes left to cluster: reset it.
- **No refusal on beat D** — the two windows are not on the same board. Check the left
  window's roster names the other seat before you press anything; if it lists only one
  seat, reload both.
- **Refusal says "board unverifiable"** — the journal no longer reaches back to the
  bookmark, so the gate failed closed. Honest, but not the shot you want. Reload both seats
  and keep the beat short.
- **Consent dialog doesn't appear** — you're alone. Alone, whole-board changes just apply.
  The right window must be visible, not covered.
- **Second seat missing from the roster** — backgrounded long enough to be dropped. Bring
  it forward and wait a few seconds.
- **Notes teleport instead of travelling** — the tab was backgrounded when the tool fired,
  so the animation was dropped (the result and the refusals are unaffected). Keep both tabs
  genuinely visible side by side.
- **A beat gives up after 45 seconds** — the bar says so and unlocks itself rather than
  staying dead. Reload both windows and run that beat again.
