Run the full SKY DS tokenization pipeline on a Figma frame.

**Input received:** $ARGUMENTS

## Step 1 — Parse the frame ID

The input can be either:
- A full Figma URL like `https://www.figma.com/design/FILE_ID/NAME?node-id=62-826&t=...`
- A bare node ID like `62:826`

If it's a URL: extract the `node-id` query parameter and convert dashes to colons (`62-826` → `62:826`).
If it's already a node ID, use it directly.

## Step 2 — Run the figma-tokenize skill

With the extracted node ID, execute the complete tokenization workflow defined in the figma-tokenize skill:

1. **Pre-check** — detect existing bindings, enforce SKY Light mode if re-tokenizing
2. **Step 0** — detach all existing variable bindings and text styles (including gradient fills from external libraries)
3. **Step 1** — rename layers semantically so context detection works correctly
4. **Step 2** — bind every fill, stroke, and text node to the correct SKY DS token using the ground-truth `resolveToken()` mapping
5. **Verify** — report coverage %, run auto-fix loop until ≥85% fills / ≥85% strokes or no further progress
6. **Visual QA** — screenshot the frame in SKY Light mode, then SKY Dark mode; flag any white elements in dark mode

## Step 3 — Report back

After completion, show:
- Coverage table (fills / strokes / text % for the frame)
- Light mode screenshot
- Dark mode screenshot
- Any unbound hex values with classification (UI element vs illustration vs unclassified)
