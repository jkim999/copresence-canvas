# Demo script

Target: **under 3:00**, public YouTube, audio on. Judges watch this before they open
the URL, so the first twenty seconds have to carry the whole idea.

## Before you record

- Window at ~1600×1000, panel open, browser zoom 100%.
- Hit **Reset** for a clean board.
- Decide up front: are you recording with a real WebMCP host (ChatGPT's in-app browser
  / Chrome with `chrome://flags/#enable-webmcp-testing`) or with the in-page Agent
  console? Both are legitimate — the console calls the identical handlers — but the
  header pill will say which, and judges will read it. Prefer the real host for at
  least one shot.
- Practise the drag: you want to be *continuously* moving a note with your own cursor
  the entire time the agent's cursor is working. Dead human hands kill the shot.

## Beats

### 0:00 – 0:20 — the simultaneity shot. No narration.

Start the agent on **Cluster by kind of evidence** (or ask the host: *"group the
interview quotes, the metrics and the hypotheses into three clusters"*).

The instant the teal cursor appears, **start dragging a note of your own and don't
stop.** Both labelled cursors — teal **Agent**, terracotta **You** — are on screen at once,
both moving different notes. Let it play silently. That image is the pitch.

### 0:20 – 0:40 — the negative case. Speak it plainly.

> "None of this touches a server. The agent is reading and moving live canvas state
> inside my browser — note positions that no backend has ever seen and no API could
> reach. And it isn't taking turns with me. I never stopped working."

Show the **Tools** tab briefly: eight tools, live JSON Schemas, registered through
`document.modelContext.registerTool`.

### 0:40 – 2:00 — one strong task, start to finish.

Twenty-eight scattered notes from a real-shaped investigation: *why did onboarding
conversion drop?* Interview quotes, metrics, dated events, hypotheses, proposed actions,
all interleaved.

1. **Read** — `get_scene`. Say the number out loud: the whole board is about
   **4 KB of JSON**, roughly a thousand tokens. Not a screenshot.
2. **Timeline** — the agent finds every dated note and lays them out left to right.
   Point out that it is *actually chronological*, not just spatial: the page parses
   `Mar 3`, `Apr 15` out of the note text.
3. **Link** — labelled edges drawn from evidence to the hypothesis it supports.
4. **Provenance** — everything the agent touched is ringed in teal and stamped.
   Toggle it off and on.
5. **Undo agent** — one click, the agent's last move is gone and yours are untouched.
6. **The consent beat** — ask for the whole board. This is the one destructive action,
   so it stops and asks, showing its rationale and the groups it wants to build. Say:
   *"one action asks. Everything else stays fluid — gating all of them would turn this
   back into a chatbot."* Approve it, and let the board restructure.

**The perception beat.** Grab a note and hold it, then run *"Notice what I am doing"*.
The agent calls `get_human_activity`, sees the note in your hand, and writes a comment
onto the board saying it will leave that one alone. Say: *"it isn't just acting while I
work — it can see that I'm working."*

Somewhere in here, grab a note the agent is mid-way through carrying. It lets go
immediately and permanently — and the tool result tells the agent it yielded, so it
doesn't fight you for it.

### 2:00 – 2:45 — why it matters.

> "Research synthesis, affinity mapping, systems design, retros — the work where the
> meaning is in the arrangement, and the arrangement lives only in the browser. Those
> canvases are exactly the surfaces a server-side agent can't touch and a screenshot
> agent can't reason about. WebMCP is what makes a second pair of hands possible there
> — not a second turn."

### Close before 3:00.

Live URL, repo, MIT licence.

## Things to avoid

- **Don't let the human idle.** If you stop dragging while the agent works, the video
  reads as turn-taking and the entire differentiation is gone.
- **Don't narrate the first twenty seconds.** Let the two cursors speak.
- **Don't demo every tool.** One task, done fully, beats eight shown shallowly.
