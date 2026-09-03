# Demo script

Target **2:20**, hard ceiling 3:00. Public YouTube, audio on. Judges watch this before
they open the URL, so the first fifteen seconds have to carry the whole idea without
narration.

## Before you record

- **Close every tab of the deployed site, then open one fresh.** A room that already
  holds a board wins over a new tab's seed, so a stale tab keeps serving the old board.
- **Record at `?pace=2`** — open
  `https://copresence-canvas.vercel.app/?pace=2`. At true speed a note is in flight for
  under half a second and the whole six-note act is over in four, which is long enough
  to see and too short to interrupt. `pace` scales durations and nothing else: same code,
  same refusals, same results. Say "I've slowed the animation down" once, on camera, when
  you first grab a note — it costs three words and removes the only thing a judge could
  wonder about.
- Chrome with `chrome://flags/#enable-webmcp-testing` on. Check the header pill reads
  *WebMCP live · document.modelContext · 11 tools* before you hit record. If it says
  the console instead, that's still honest, but the pill is on camera and judges read it.
- Window ~1600×1000, panel open, zoom 100%.
- **Both windows visible at once.** Do not minimise the second seat — a hidden tab lands
  every animation instantly and throttles its heartbeat, which kills the pacing and can
  make the second seat look absent.
- Practise the grab. You want to be *continuously* dragging a note the entire time the
  agent is working. A still hand kills the shot.

## 0:00 – 0:15 — no narration

Start **Cluster by kind of evidence** (or ask the host: *"group the quotes together and
the metrics together"*).

The instant the teal cursor appears, start dragging a note of your own and don't stop.
Two labelled cursors on screen, both moving different notes, neither waiting. Let it
play silently.

## 0:15 – 0:40 — say what it is

> "That's a planning board — a software project, a week in. Twenty-eight notes.
> An agent is rearranging it and I'm rearranging it, at the same time, and neither of us
> is waiting for the other.
>
> None of this touches a server. Those are note positions in my browser's memory. No
> backend has ever seen them, and there's no API that could reach them."

Flash the **Tools** tab: eleven tools, live schemas, registered on the page.

## 0:40 – 1:20 — the yield. This is the submission.

Run **Build the timeline**, or ask for one. It visits notes in nearest-neighbour order,
so **pick your note before you start** — one near the middle of the group, so the cursor
reaches it a few seconds in rather than immediately.

Take it as the cursor starts moving toward it, and **keep holding it.** Say it as it
happens:

> "I just took a note out of its hands. Watch what it gets back."

Show the result on the ledger — `yielded 1 to you` — and read the model-facing line out
loud:

> "*The human took those notes while you were moving them. They are where the human put
> them. Do not move them back unless asked.*
>
> That last sentence is the point. Without it the agent helpfully undoes me on its next
> call. And a tool running on a server could never do this — my hand on that note existed
> for about a second, in one tab, in memory. It was never persisted. There's nothing for
> a backend to check."

## 1:20 – 2:00 — the room

Cut to both windows side by side.

> "Second tab is a second person, with an agent of their own. No room code, no account,
> no server — peer to peer. Now the destructive one."

Run **Reorganise the entire board**.

> "It doesn't ask me. It asks everybody who's on this board, and any one of them can
> refuse. So can silence."

Let it time out without answering in the other window. Show the result:
`approved: false` — *nobody answered in time, so nothing was moved.*

> "Ten seconds of nothing counts as no."

Then do it again and approve it, and let the board restructure while you talk over it.

## 2:00 – 2:20 — land it

> "Everyone's building agents that can act on a live page. This is one that can be told
> no by a hand on a note — and that only works because the tool is running inside the
> session, next to the thing I'm touching. A server can't be interrupted by a hand, and
> it can't ask a room. This one is in the room."

## If a beat fails on camera

- **No yield** — your hand landed after that note had already been put down. Check the
  URL still has `?pace=2`, and grab the note *while the cursor is travelling to it*, not
  after it arrives. At pace 2 you have roughly a second and a half per note.
- **Consent dialog doesn't appear** — you're alone on the board. Alone, whole-board
  changes just apply. Check the second window is open and visible.
- **Second seat missing from the roster** — it was backgrounded long enough to be dropped.
  Bring it forward and give it a few seconds.
