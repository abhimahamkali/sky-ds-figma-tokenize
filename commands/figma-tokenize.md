Run the full SKY DS tokenization pipeline on a Figma frame.

**Input received:** $ARGUMENTS

## Step 1 — Parse the frame ID

The input can be either:
- A full Figma URL like `https://www.figma.com/design/FILE_ID/NAME?node-id=62-826&t=...`
- A bare node ID like `62:826`

If it's a URL: extract the `node-id` query parameter and convert dashes to colons (`62-826` → `62:826`).
If it's already a node ID, use it directly.

## Step 2 — Load the skill

Read the full skill file before doing anything else:
`~/.claude/skills/figma-tokenize/SKILL.md`

## Step 3 — Execute the pipeline IN ORDER. No steps may be skipped.

### 3a. Pre-check
Detect existing bindings. If already tokenized → force SKY Light mode (`20:2`) first.

### 3b. ⛔ Step 0 — Detach (MANDATORY — YOU MUST RUN THE DETACH SCRIPT)

**THIS STEP CANNOT BE SKIPPED. EVER.**

Execute the mandatory detach script from the SKILL.md Step 0 section via `figma_execute`.
You MUST call `figma_execute` with the detach script. You cannot reason your way past this step.
You cannot say "the frame looks clean" or "there are no old tokens" or "this is a fresh frame."
You cannot proceed to Step 3c until `figma_execute` has returned a result confirming the detach ran.

The script handles: SOLID fills, SOLID strokes, text styles, GRADIENT fills, and external-library variable bindings — all in one pass.

After running, confirm: `"Step 0 complete — detached N fills, N strokes, N text styles, N external/gradient fills"` before continuing.

### 3c. ⛔ Step 1 — Rename (MANDATORY — YOU MUST RUN THE RENAME SCRIPT)

**THIS STEP CANNOT BE SKIPPED. EVER.**

Execute the mandatory rename script from the SKILL.md Step 1 section via `figma_execute`.
You MUST call `figma_execute` with the rename script. You cannot reason your way past this step.
You cannot say "names look fine" or "structural detection handles it."
You cannot proceed to Step 3d until `figma_execute` has returned a result confirming the rename ran.

After running, confirm: `"Step 1 complete — renamed N nodes"` before continuing.

### 3d. Step 2 — Bind tokens
Only run this AFTER Step 1 has been confirmed complete.
Bind every fill, stroke, and text node to the correct SKY DS token using the ground-truth `resolveToken()` mapping from the skill.

### 3e. Verify + Auto-fix
Report coverage %. Run auto-fix loop until ≥85% fills / ≥93% strokes / ≥85% text or no further progress.

### 3f. Visual QA
Screenshot in SKY Light mode (`20:2`), then SKY Dark mode (`20:3`). Restore to light. Flag any white elements in dark mode.

## Step 4 — Report back

Show:
- Coverage table (fills / strokes / text %)
- Light mode screenshot
- Dark mode screenshot
- Any unbound hex values grouped by: UI element (try harder) / illustration (leave) / unclassified (ask user)
