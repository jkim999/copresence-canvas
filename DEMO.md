# Demo script

Target **2:40**, hard ceiling 3:00. Public YouTube, audio on. Judges watch this before
they open the URL, so the first fifteen seconds have to carry the idea without narration.

The spine is three refusals, in ascending order of how much they cover: **a hand**, then
**reality**, then **the room**. Each one is the page telling the agent no, for a reason no
server could have known.

## Before you record

- **Close every tab of the deployed site, then open one fresh.** A room that already holds
  a board wins over a new tab's seed, so a stale tab keeps serving the old board.
- **Record at `?pace=2`** — `https://copresence-canvas.vercel.app/?pace=2`. At true speed a
  note is in flight under half a second and a six-note act is over in four, which is long
  enough to see and too short to interrupt. `pace` scales durations and nothing else: same
  code, same refusals, same results. Say "I've slowed the animation down" once, on camera,
  the first time you grab a note.
- Chrome with `chrome://flags/#enable-webmcp-testing` on. Check the header pill reads
  *WebMCP live · document.modelContext · 11 tools* before you hit record.
- Window ~1600×1000, panel open, zoom 100%.
- **Two windows, both visible from 1:05 on.** Never minimise the second seat — a hidden tab
  lands every animation instantly and throttles its heartbeat, so it can look absent.
- Practise the grab. You want to be *continuously* dragging while the agent works.
- Every panel button now runs on this board — a test asserts it. `Link evidence to risks`
  and `Build the fix tree` used to throw; their keyword tables described the board this
  demo replaced.

## 0:00 – 0:15 — no narration

Start **Cluster by kind of evidence**. The instant the teal cursor appears, start dragging
a note of your own and don't stop. Two labelled cursors, both moving notes, neither
waiting. Let it play silently.

## 0:15 – 0:35 — say what it is

> "A planning board — software project, a week in, twenty-eight notes. An agent is
> rearranging it and I'm rearranging it at the same time, and neither of us is waiting.
>
> None of this touches a server. Those are positions in my browser's memory. No backend
> has seen them and there's no API that could reach them."

Flash the **Tools** tab: eleven tools, live schemas, registered on the page.

## 0:35 – 1:05 — refusal one: a hand

Run **Build the timeline**. It visits notes in nearest-neighbour order, so **pick your note
before you start** — one in the middle of the group, so the cursor reaches it a few seconds
in rather than immediately. Take it as the cursor moves toward it and keep holding.

> "I just took a note out of its hands. Watch what it gets back."

Ledger reads `yielded 1 to you`. Read the model-facing line aloud:

> "*The human took those notes while you were moving them. Do not move them back unless
> asked.* That last sentence is the point — without it the agent helpfully undoes me on its
> next call.
>
> A tool on a server could never do this. My hand on that note existed for about a second,
> in one tab, in memory. It was never persisted. There is nothing for a backend to check."

**Then double-click a note and start typing, and run it again.** The note you're typing in
doesn't move either.

> "Typing counts as a hand too. It didn't used to — it would carry the note out from under
> the cursor, and my next keystroke would overwrite whatever had arrived."

## 1:05 – 1:50 — refusal two: reality

Second window, side by side. This beat is the least flashy and the most general; it's
three button presses and they have to be in this order.

> "Second tab is a second person with an agent of their own. No room code, no account, no
> server — peer to peer, same board."

1. **Window one: press "Read the board."** Ledger shows `get_scene`. That's the agent
   looking, and the bookmark it keeps.
2. **Window two: run "Build the timeline"** — or drag the risk notes yourself. Either way
   seat two moves notes seat one just read.
3. **Window one: press "Act on what I read a moment ago."**

> "Here's what actually breaks agents on a shared page. It read the board, it took a few
> seconds to decide — and in those seconds somebody else moved the notes it was about to
> rearrange. It's writing to a board that no longer exists."

The ledger now reads the whole story in three lines, and the last one is
`refused · 5 notes changed underneath`. Read the result:

> "*Refused: you planned this against a board that has since changed. Olive's agent moved
> 5 of the notes you named. Nothing was changed, so their work is intact. Call
> what_changed, then decide again.*
>
> Nothing moved. It named who got there first, and it told the model to look again rather
> than push harder. That's compare-and-swap — except a backend gets it free from its
> database, and a page has to keep the bookmark itself. The read happened *here*, against a
> scene in memory that the other tab is mutating. No server holds that version, because
> there is no server.
>
> And the grip needs my hand to land inside about half a second. This one fires every time
> the model thinks for longer than the room takes to change — which is always."

**Why that button exists:** every other recipe reads and writes in one press, so nothing
can happen in between and the gate can never fire. This one keeps the two halves apart,
which is what a model does across a turn. With a real model driving, you don't need it —
the thinking time is real.

## 1:50 – 2:25 — refusal three: the room

Run **Reorganise the entire board**.

> "It doesn't ask me. It asks everybody on this board, and any one of them can refuse. So
> can silence."

Let it time out unanswered in the other window: `approved: false` — *nobody answered in
time, so nothing was moved.*

> "Ten seconds of nothing counts as no."

Run it again and approve, and let the board restructure while you talk over it.

> "Consent to *the user* is a confirm dialog, and that's solved. Consent to whoever is
> actually in the room right now, where one person is enough to stop it — that only has an
> answer if the tools live where the room does."

## 2:25 – 2:40 — land it

> "Everyone's building agents that can act on a live page. Three things outrank this one: a
> hand on a note, the room, and whether the board it planned against still exists. None of
> those are things a server could have known. A server can't be interrupted by a hand, it
> can't ask a room, and it can't tell you the ground moved under a read it never saw.
>
> This one is in the room."

## If a beat fails on camera

- **No yield** — your hand landed after that note was already down. Check the URL still has
  `?pace=2`, and grab while the cursor is *travelling*, not after it arrives. At pace 2 you
  have roughly a second and a half per note.
- **No refusal on the staleness beat** — the order is everything. Window one must read
  *first*, then seat two moves *those* notes, then window one acts. If the ledger's last
  two rows aren't the peer's move followed by your refusal, start the beat again.
- **Refusal says "board unverifiable"** — the journal no longer reaches back to the
  bookmark, so the gate failed closed. Honest, but not the shot you want. Reload both seats
  and keep the beat short.
- **Consent dialog doesn't appear** — you're alone. Alone, whole-board changes just apply.
  Check the second window is open and visible.
- **Second seat missing from the roster** — backgrounded long enough to be dropped. Bring
  it forward and wait a few seconds.
