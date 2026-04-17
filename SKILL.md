---
name: figma-tokenize
description: >
  End-to-end workflow for tokenizing Figma frames and components with the SKY Design System color and typography tokens.
  Use this skill EVERY TIME the user asks to: tokenize a frame, apply design tokens, bind variables to components,
  detach tokens, rebind tokens, apply color/text tokens to a Figma page/frame/component, or run the "tokenization workflow".
  Also triggers on: "apply tokens", "bind variables", "detach tokens", "remove tokens", "tokenize this",
  "apply color tokens", "apply text styles", "token binding", "SKY DS tokens".
  Uses mcp__figma-console__figma_execute exclusively (Figma Desktop plugin, NOT Chrome/REST API).
---

# SKY Design System — Tokenization Workflow

This skill implements the 3-step tokenization workflow for HDFC Securities' SKY Design System.
All operations use `mcp__figma-console__figma_execute` with the Figma Plugin API.

## Architecture Overview

The SKY DS token system has three layers:

```
Primitives (SKY Colors — 47 variables)
  └── Semantic (Color Tokens — 75 variables, 2 modes: SKY Light / SKY Dark)
        └── Scale (Radius & Spacing — 23, Typography Tokens — 19)
```

The unified **Color Tokens** collection (`VariableCollectionId:20:1661`) has two modes:
- SKY Light (`20:2`)
- SKY Dark (`20:3`)

---

## USER DIRECTIVE — WHAT "TOKENIZE" MEANS

When the user says "tokenize" (any frame, any state), **always** execute the full pipeline:
Pre-check → Step 0 → Step 1 → Step 2 → Verify → Auto-fix gaps.

- **Never pause to ask** whether to re-tokenize, duplicate, or skip. The user has standing approval for option 2 (full re-tokenize).
- **Pre-check's role** is not gating — it's to decide whether Rule 3 (force light mode before detach) must fire. If the frame is already tokenized, force light mode first, then proceed with Step 0.
- **After Step 2, always verify** and run a targeted fix pass on any fills/strokes/text that didn't bind. Loop until coverage is ≥85% fills / ≥95% strokes or no further progress is possible.
- **Clone fallback (Rule 4)** is still the only recovery path for a frame corrupted by a past dark-mode detach. Use it if the user explicitly says the frame is broken.

### ⛔ STEP 1 IS MANDATORY — NEVER SKIP IT

Step 1 (semantic rename) **must always run**, even if existing names look reasonable. Do NOT reason "structural detection handles it" and skip. Here is why this reasoning is always wrong:

- `getContext()` in Step 2 reads **parent-chain names** to decide which token to bind
- A `#FFFFFF` fill on a card background → `card/bg` ONLY if an ancestor is named `Card/...`
- Without the rename pass, that same node defaults to `background/primary` — visually identical in light mode but **wrong in dark mode** (card bg stays white)
- Skipping Step 1 silently degrades every context-dependent binding. Coverage % will look fine; dark mode will break.

**What "run Step 1" means in practice:** Scan all direct children and 2 levels deep. For any node whose name is generic (`Frame 123`, `Rectangle`, `Group`, `Auto layout`, `Content`, `Header`, `Item`) — rename it to the correct semantic convention (`Card/...`, `Button/...`, `Tag/...`, `Nav/...`, `Input/...`). Nodes that already have correct semantic names (e.g. `Sky Navigation`, `Home Nav`, `Button/Buy`) do NOT need renaming — just confirm and move on. The pass takes one `figma_execute` call. There is no valid reason to skip it.

## CRITICAL PRE-CHECK (run BEFORE Step 0 — no exceptions)

**Why this exists:** Re-tokenizing an already-tokenized frame while the canvas is in dark mode corrupts the binding pass. Detach captures the resolved *dark-mode hex* (e.g. `#0F0F0F`, `#647483`, `#339E3D`), which doesn't match the light-mode source hexes the mapping function expects. Result: nav bars render bright cyan, buttons get wrong fills, cards break. Recovered once via full frame deletion + clone — do not repeat this.

### Rule 1 — Detect existing bindings first

```javascript
const frame = await figma.getNodeByIdAsync("TARGET_ID");
const allNodes = frame.findAll(() => true);
allNodes.push(frame);

let boundFills = 0, totalFills = 0;
let boundStrokes = 0, totalStrokes = 0;
let boundText = 0, totalText = 0;

for (const n of allNodes) {
  if (n.fills?.length > 0 && n.fills[0]?.type === "SOLID" && n.fills[0]?.visible !== false) {
    totalFills++;
    if (n.fills[0]?.boundVariables?.color) boundFills++;
  }
  if (n.strokes?.length > 0 && n.strokes[0]?.type === "SOLID") {
    totalStrokes++;
    if (n.strokes[0]?.boundVariables?.color) boundStrokes++;
  }
  if (n.type === "TEXT") {
    totalText++;
    if (n.textStyleId) boundText++;
  }
}

const fillRate = totalFills ? boundFills / totalFills : 0;
const isAlreadyTokenized = fillRate > 0.5 || boundText > 5;
```

### Rule 2 — If `isAlreadyTokenized` is true, enforce light mode and continue

Per user directive (see top): always proceed with full re-tokenize (option 2). Do NOT pause to ask.
The only thing that changes when `isAlreadyTokenized` is true: **Rule 3 must fire before Step 0**.

### Rule 3 — If re-tokenizing, force LIGHT mode first

```javascript
// Check current mode on the target frame
const collection = await figma.variables.getVariableCollectionByIdAsync("VariableCollectionId:20:1661");
// Light mode ID: "20:2", Dark mode ID: "20:3"
const currentMode = frame.resolvedVariableModes?.["VariableCollectionId:20:1661"];
if (currentMode !== "20:2") {
  // Must set frame's explicitVariableModes to light before detaching
  frame.setExplicitVariableModeForCollection(collection, "20:2");
}
```

Detaching in dark mode captures dark-mode resolved hexes. The `resolveToken()` map keys are light-mode hexes, so dark-mode values won't match and nodes will be left unbound or mis-bound. **Always detach while the frame is resolving to SKY Light (`20:2`).**

### Rule 4 — The clone fallback (when duplication is the right answer)

If a correct twin frame exists (e.g. `Stocks/Dark mode` is good and `Stocks` is broken), delete the broken frame and clone the good one rather than attempting to re-map:

```javascript
const broken = await figma.getNodeByIdAsync("BROKEN_ID");
const correct = await figma.getNodeByIdAsync("CORRECT_ID");
const { x, y, name } = broken;
broken.remove();
const clone = correct.clone();
clone.name = name;
clone.x = x;
clone.y = y;
// Bindings on the clone are preserved; it will render correctly in both modes.
```

This is the **only** reliable recovery path once a frame has been corrupted by a dark-mode re-tokenize. Don't try to patch with index-based copies, hex remaps, or name-matching — all four of those were tried and all four failed.

### Pre-check decision tree

```
Is frame already tokenized (fillRate > 50% OR textStyles > 5)?
├── NO  → proceed to Step 0 normally
└── YES → enforce Rule 3 (light mode), then Step 0 (no pausing)
         (Clone fallback via Rule 4 only if user says frame is broken.)
```

### Auto-fix pass (run AFTER Step 2, always)

```
Verify → if fillRate < 85% or strokeRate < 95% or textRate < 85%:
  1. Re-scan unbound nodes, log their hex + context
  2. Extend resolveToken() with any new mappings needed
  3. Re-run binding pass on unbound nodes only
  4. Re-verify; stop when targets met OR no progress from previous pass
```

### Visual regression checks (MANDATORY — binding % ≠ visual correctness)

Observed failure mode: a frame can be 100% token-bound and still look broken in dark mode if tokens resolve to values that disappear against their parent (e.g. `card/border` = `#FFFFFF @ 10%` on a `#141414` card = invisible).

**Required after every tokenize run:**

1. **Pre-screenshot** the target frame BEFORE Step 0 (`figma_capture_screenshot`). Save it.
2. **Post-screenshot** the frame AFTER Step 2 + auto-fix. Do both modes — switch the frame between `20:2` (light) and `20:3` (dark) and capture each.
3. **Stroke-contrast audit**: for every bound stroke, resolve its hex *in the current mode*, resolve its parent fill's hex *in the same mode*, and compute WCAG contrast. Flag if < 1.5 (practically invisible). Report flagged nodes by name + token so the user can decide: upgrade the token, or switch to a stronger stroke token (e.g. `border/default` instead of `card/border`).
4. **Don't silently classify unbound hexes as "swatch/illustration".** If a hex is unbound at the end, classify it by *parent chain context*:
   - Inside a `Nav/`, `Button/`, `Card/`, `Tag/`, `Input/` → it's a real UI element, try harder (manual mapping).
   - Inside `Icon/`, `Vector`, `Illustration`, `Chart/` → legitimately off-palette, leave raw.
   - Neither → surface to user as "unclassified" and ask.
5. **Report format** at the end:
   - Coverage %
   - Low-contrast stroke list (token, mode, contrast ratio)
   - Unbound hex list grouped by "UI" vs "illustration" vs "unclassified"
   - Side-by-side pre/post screenshots per mode

---

## Step 0: Detach All Existing Tokens

> ⛔ **NEVER SKIP THIS STEP. THIS IS NOT OPTIONAL. EVER.**
>
> Do NOT say:
> - "the frame looks clean already"
> - "there are no old tokens to remove"
> - "I'll skip detach since this is a fresh frame"
> - "Step 0 is not needed here"
>
> **You MUST execute the detach script below via `figma_execute` before Step 1 or Step 2. No exceptions.**
>
> Overwriting bindings without detaching first leaves orphaned references and mixed states — some nodes keep stale tokens, some get new ones. The frame will appear correct in light mode but silently break in dark mode. **Always detach first. Every single time.**

### Mandatory execution — run this script exactly as written

Copy this script, replace `TARGET_NODE_ID`, and execute via `figma_execute`.

```javascript
// STEP 0 — Mandatory detach pass. Removes ALL variable bindings and text styles.
// Replace TARGET_NODE_ID with the actual frame ID.
const frame = await figma.getNodeByIdAsync("TARGET_NODE_ID");
if (!frame) return { error: "Frame not found" };

const allNodes = frame.findAll(() => true);
allNodes.push(frame); // findAll skips the root — always add it manually

let detachedFills = 0, detachedStrokes = 0, detachedText = 0, detachedExternal = 0;

for (const n of allNodes) {
  // ── Detach SOLID fills ──────────────────────────────────────────────────
  if (n.fills?.length > 0) {
    const newFills = n.fills.map(f => {
      if (f.type === "SOLID") {
        detachedFills++;
        return {
          type: "SOLID",
          color: { r: f.color.r, g: f.color.g, b: f.color.b },
          opacity: f.opacity !== undefined ? f.opacity : 1,
          visible: f.visible !== undefined ? f.visible : true
        };
      }
      return f; // non-SOLID fills handled in the external-library pass below
    });
    n.fills = newFills;
  }

  // ── Detach SOLID strokes ────────────────────────────────────────────────
  if (n.strokes?.length > 0) {
    const newStrokes = n.strokes.map(s => {
      if (s.type === "SOLID") {
        detachedStrokes++;
        return {
          type: "SOLID",
          color: { r: s.color.r, g: s.color.g, b: s.color.b },
          opacity: s.opacity !== undefined ? s.opacity : 1,
          visible: s.visible !== undefined ? s.visible : true
        };
      }
      return s;
    });
    n.strokes = newStrokes;
  }

  // ── Detach text styles ──────────────────────────────────────────────────
  if (n.type === "TEXT" && n.textStyleId) {
    await n.setTextStyleIdAsync("");
    detachedText++;
  }
}

// ── Second pass: detach GRADIENT fills and external-library SOLID fills ──
// JSON cloning does NOT remove binding metadata — must rebuild paint objects.
// GRADIENT_LINEAR/GRADIENT_RADIAL fills from external libraries survive the
// SOLID-only loop above and resolve to #FFFFFF in dark mode (breaking cards).
const bgPrimary = await figma.variables.getVariableByIdAsync("VariableID:20:1662");
const cardBg    = await figma.variables.getVariableByIdAsync("VariableID:20:1727");

for (const n of allNodes) {
  if (!n.fills || !Array.isArray(n.fills)) continue;
  const newFills = [...n.fills];
  let changed = false;
  for (let i = 0; i < newFills.length; i++) {
    const f = newFills[i];
    if (f.visible === false) continue;
    const isExtGradient = f.type === "GRADIENT_LINEAR" || f.type === "GRADIENT_RADIAL";
    const isExtSolid = f.type === "SOLID" && f.boundVariables?.color?.id &&
                       !f.boundVariables.color.id.startsWith("VariableID:20:");
    if (isExtGradient || isExtSolid) {
      // Replace with appropriate SKY DS token: card_bg for containers, bg_primary for pages
      const token = (n.width > 200 && n.height > 200) ? cardBg : bgPrimary;
      newFills[i] = figma.variables.setBoundVariableForPaint(
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } }, "color", token
      );
      detachedExternal++;
      changed = true;
    }
  }
  if (changed) n.fills = newFills;
}

return {
  message: `Step 0 complete — detached ${detachedFills} fills, ${detachedStrokes} strokes, ${detachedText} text styles, ${detachedExternal} external/gradient fills`,
  detachedFills, detachedStrokes, detachedText, detachedExternal
};
```

### After running, confirm in the response

After `figma_execute` returns, report the result line: `"Step 0 complete — detached N fills, N strokes, N text styles, N external/gradient fills"`. Only then proceed to Step 1.

### Why JSON cloning fails
`JSON.parse(JSON.stringify(paint))` does NOT remove binding metadata — the `boundVariables` reference survives serialization. You must construct a brand-new paint object from scratch (as the script above does) to sever the variable link.

---

## Step 1: Rename Layers Semantically

> ⛔ **NEVER SKIP THIS STEP. THIS IS NOT OPTIONAL. EVER.**
>
> Do NOT say:
> - "existing names look fine"
> - "structural detection handles most cases"
> - "I'll proceed without renaming"
> - "the frame already has good names"
>
> **You MUST execute the rename script below via `figma_execute` before Step 2. No exceptions.**
>
> Step 2's `getContext()` reads parent-chain names. Without correct names, every `#FFFFFF` fill defaults to `background/primary` instead of `card/bg` or `nav/bg` — visually identical in light mode, **completely broken in dark mode**. This is a silent failure: coverage % will look fine, but the frame will have white cards in dark mode.

### Mandatory execution — run this script exactly as written

Copy this script, replace `TARGET_NODE_ID`, and execute via `figma_execute`. **You must call `figma_execute` with this code. You cannot skip it by reasoning about the layer names.**

```javascript
// STEP 1 — Mandatory semantic rename pass
// Replace TARGET_NODE_ID with the actual frame ID
const frame = await figma.getNodeByIdAsync("TARGET_NODE_ID");
const allNodes = frame.findAll(() => true);

let renamed = 0;

function getParentChain(n) {
  const names = [n.name];
  let p = n.parent;
  for (let i = 0; i < 5 && p; i++) { names.push(p.name); p = p.parent; }
  return names.join("|").toLowerCase();
}

function rgbToHex(c) {
  return [c.r,c.g,c.b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

for (const n of allNodes) {
  // Skip nodes inside instances — internal sub-nodes are locked to component definition
  let parentIsInstance = false;
  let p = n.parent;
  for (let i = 0; i < 4 && p; i++) {
    if (p.type === "INSTANCE") { parentIsInstance = true; break; }
    p = p.parent;
  }
  if (parentIsInstance) continue;
  if (n.type === "INSTANCE") continue;

  const isGeneric = /^(Frame|Rectangle|Group|Auto layout|Layer)\s*\d+$/.test(n.name);
  if (!isGeneric) continue; // already has a semantic name — leave it

  const chain = getParentChain(n);
  const fills = n.fills || [];
  const solidFill = fills.find(f => f.type === "SOLID" && f.visible !== false);
  const hex = solidFill ? rgbToHex(solidFill.color) : null;
  const w = n.width, h = n.height;
  const cr = typeof n.cornerRadius === 'number' ? n.cornerRadius : 0;
  let newName = null;

  // ── PRIORITY 1: STRUCTURAL signals (size + radius + color) ──
  // These fire FIRST, regardless of parent chain. A button inside a card is still a button.
  // ⚠️ April 2026 fix: previously parent chain ran first, causing buttons inside cards
  // to be named Card/Section instead of Button/Container — breaking token assignment.

  if (h <= 28 && cr >= 4 && w <= 120) {
    newName = "Tag/Container";                              // Small pill = always a tag
  } else if (h >= 36 && h <= 56 && cr >= 6 && w <= 340) {
    newName = "Button/Container";                           // Medium rounded = always a button
  } else if (hex === "042ff2" || hex === "042ff1") {
    newName = h <= 28 ? "Tag/Primary" : "Button/Primary";  // Brand blue = button or tag by size
  } else if (h >= 40 && h <= 60 && w >= 200 && cr >= 8 && (chain.includes("input") || chain.includes("search") || chain.includes("enter"))) {
    newName = "Input/Container";                            // Input field

  // ── PRIORITY 2: PARENT CHAIN signals (only for nodes that didn't match structurally) ──
  } else if (chain.includes("card") || chain.includes("expert") || chain.includes("pick")) {
    newName = w > 80 && h > 60 ? "Card/Content" : h < 25 ? "Card/Label Row" : "Card/Section";
  } else if (chain.includes("watchlist") || chain.includes("stock")) {
    newName = w > 300 ? "Card/Stock Item" : h < 20 ? "Stock/Label" : "Stock/Row";
  } else if (chain.includes("nav") || chain.includes("navigation") || chain.includes("bottom")) {
    newName = "Nav/Item";
  } else if (chain.includes("button") || chain.includes("buy") || chain.includes("cta")) {
    newName = "Button/Container";
  } else if (chain.includes("tag") || chain.includes("intraday") || chain.includes("btst")) {
    newName = "Tag/Container";
  } else if (chain.includes("input") || chain.includes("search")) {
    newName = "Input/Container";
  } else if (chain.includes("banner") || chain.includes("notification") || chain.includes("holiday")) {
    newName = "Banner/Container";
  } else if (chain.includes("market") || chain.includes("mover") || chain.includes("gainer") || chain.includes("loser")) {
    newName = "Card/Market Item";
  } else if (chain.includes("header") || chain.includes("topbar")) {
    newName = "Header/Container";

  // ── PRIORITY 3: FILL COLOR + SIZE fallback ──
  } else if (hex === "ffffff" && w > 300 && h > 200) {
    newName = "Card/Main";
  } else if (hex === "eaeeff" || hex === "e5f3ff") {
    newName = "Background/Surface";
  } else if (hex === "f2f4fc") {
    newName = "Background/Secondary";
  } else if (h <= 44 && w <= 44) {
    newName = "Icon/Container";
  } else if (w > 350 && h < 60) {
    newName = "Row/Container";
  }

  if (newName) { n.name = newName; renamed++; }
}

return { renamed, totalScanned: allNodes.length, message: `Step 1 complete — renamed ${renamed} generic nodes` };
```

### After running, confirm in the response

After the `figma_execute` call returns, report: `"Step 1 complete — renamed N nodes"`. Only then proceed to Step 2.

### Naming conventions reference

| Category | Pattern | Examples |
|---|---|---|
| Cards | `Card/{Type}` | `Card/Expert Pick`, `Card/Index/NIFTY`, `Card/News` |
| Card internals | `Card/{SubPart}` | `Card/Stock Info`, `Card/Stock Name`, `Card/Returns` |
| Buttons | `Button/{Action}` | `Button/Buy`, `Button/CTA`, `Button/Ghost` |
| Tags | `Tag/{Type}` | `Tag/Intraday`, `Tag/BTST`, `Tag/Stock Ticker` |
| Navigation | `Nav/{Item}` or `Bottom Navigation` | `Home Nav`, `Watchlist Nav` |
| Sections | `{Name} Section` | `Expert Picks Section`, `News Section` |
| Icons/vectors | Keep original or prefix with `Icon/` | `Icon/Search`, `Icon/Bell` |
| Inputs | `Input/{Type}` | `Input/Text`, `Input/Numeric`, `Input/Search` |

---

## Step 2: Apply Color and Typography Tokens

> **ORDER IS MANDATORY: Step 0 → Step 1 → Step 2.**
> Step 2's context detection reads parent-chain names. Running Step 2 before Step 1 silently degrades every ambiguous binding (e.g. `#FFFFFF` defaults to `background/primary` instead of `card/bg` or `nav/bg`).

### Token Variable Reference

Ground-truth token map derived from `38:4071` (approved reference screen in SKY DS).

#### Background & Surface tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| background/primary | 20:1662 | #FFFFFF | #0A0A0A |
| background/secondary | 20:1663 | #F2F4FC | #141414 |
| background/surface | 20:1664 | #EAEEFF | #1A1A1A |
| background/card *(generic, non-UI)* | 20:1665 | #FFFFFF | #141414 |
| background/input | 20:1668 | #F2F4FC | #1A1A1A |
| background/tag | 20:1670 | #F2F4FC | #262626 |

#### Card tokens *(use these for all Card/* frames — NOT background/card)*
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| **card/bg** | **20:1727** | **#FFFFFF** | **#141414** |
| **card/border** | **20:1728** | **#DADFF6** | **#FFFFFF@10%** |

#### Text tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| text/primary | 20:1671 | #020531 | #FFFFFF |
| text/secondary | 20:1672 | #676983 | #FFFFFF@85% |
| text/disabled | 20:1674 | #DCE0EF | #FFFFFF@30% |
| text/inverse | 20:1675 | #FFFFFF | #020531 |
| text/link | 20:1676 | #042FF2 | #FFFFFF |
| text/success | 20:1678 | #068913 | #57D49C |
| text/error | 20:1679 | #DE2020 | #DB7D7D |

#### Icon tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| icon/primary | 20:1690 | #020531 | #FFFFFF |
| icon/secondary | 20:1691 | #676983 | #647483 |
| icon/brand | 20:1692 | #042FF2 | #042FF2 |
| icon/inverse | 20:1693 | #FFFFFF | #020531 |

#### Border & Divider tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| border/default | 20:1682 | #DADFF6 | #647483 |
| border/subtle | 20:1683 | #DDDDDD | #333333 |
| border/strong | 20:1684 | #042FF2 | #042FF2 |
| border/error | 20:1685 | #DE2020 | #DB7D7D |
| divider/subtle | 20:1689 | #DCE0EF | #FFFFFF@20% |
| input/border | 20:1732 | #DADFF6 | #647483 |

#### Button tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| button/primary/bg | 20:1697 | #042FF2 | #042FF2 |
| button/primary/text | 20:1698 | #FFFFFF | #FFFFFF |
| button/secondary/bg | 20:1701 | #EAEEFF | #272727 |
| button/secondary/text | 20:1702 | #042FF2 | #FFFFFF |
| button/disabled/bg | 20:1704 | #DCE0EF | #272727 |

#### Brand & Status tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| brand/primary | 20:1718 | #042FF2 | #042FF2 |
| status/success | 20:1708 | #068913 | #57D49C |
| status/success/bg | 20:1710 | #E8F5EA | #0D2B10 |
| status/error | 20:1711 | #DE2020 | #DB7D7D |
| status/error/bg | 20:1713 | #FAE1E1 | #2B0D0D |
| status/warning | 20:1714 | #FB9140 | #FAA300 |

#### Navigation tokens
| Token | Variable ID | Light hex | Dark hex |
|---|---|---|---|
| nav/bg | 20:1722 | #FFFFFF | #0A0A0A |
| nav/active/text | 20:1723 | #042FF2 | #042FF2 |
| nav/border | 20:1726 | #DADFF6 | #1F1F1F |

---

### Context Detection — Self-First, Then Name-Chain

> ⚠️ **CRITICAL FIX (April 2026):** The previous version checked parent chain BEFORE the node's own
> identity. This caused **buttons inside cards** to be tagged as "card" and receive card tokens
> (e.g., `card/border` on a Buy button stroke). The fix: check the **node's own name and structural
> signals first**, then fall back to parent chain only for nodes that don't match anything themselves.
>
> **The rule:** A node IS what IT is, not what its PARENT is. A Button inside a Card is a button.
> A Tag inside a Card is a tag. Only use parent chain for nodes with no self-identity.

```javascript
function getContext(node) {
  const w = Math.round(node.width);
  const h = Math.round(node.height);
  const cr = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
  const ownName = (node.name || "").toLowerCase();

  // --- 0. SELF-NAME check (highest priority — the node's own name wins) ---
  // If Step 1 already renamed this node, trust that name over everything else.
  if (ownName.startsWith("button/") || ownName.startsWith("btn/")) return "button";
  if (ownName.startsWith("tag/")) return "tag";
  if (ownName.startsWith("input/")) return "input";
  if (ownName.startsWith("card/")) return "card";
  if (ownName.startsWith("nav/")) return "nav";
  if (ownName.startsWith("banner/")) return "banner";

  // --- 1. STRUCTURAL signals (check before parent chain) ---

  // Tag / pill: small, high corner radius
  if (h <= 28 && cr >= 4 && w <= 120) return "tag";

  // Button: medium height, rounded, not full-width
  // ⚠️ This MUST fire even inside a card parent — a 116×38 rounded frame is a button.
  if (h >= 36 && h <= 56 && cr >= 6 && w <= 340) return "button";

  // Input: medium height, large width, rounded, with subtle fill or stroke
  if (h >= 40 && h <= 60 && w >= 200 && cr >= 8) {
    const chain = getNameChain(node);
    if (chain.includes("input") || chain.includes("search") || chain.includes("enter")) return "input";
  }

  // Card: white-ish fill, rounded, medium-large
  if (node.fills?.[0]?.type === 'SOLID' && w >= 120 && h >= 80) {
    const f = node.fills[0];
    const isLight = f.color.r > 0.9 && f.color.g > 0.9 && f.color.b > 0.9;
    if (isLight && cr >= 8) return "card";
  }

  // Nav bar: full-width, short, at bottom
  if (w >= 320 && h >= 50 && h <= 100) {
    const chain = getNameChain(node);
    if (chain.includes("navigation") || chain.includes("nav/bottom") || chain.includes("bottom nav")) return "nav";
  }

  // --- 2. PARENT-CHAIN signals (fallback for nodes with no self-identity) ---
  const chain = getNameChain(node);

  if (chain.includes("button/") || chain.includes("btn/")) return "button";
  if (chain.includes("tag/")) return "tag";
  if (chain.includes("card/")) return "card";
  if (chain.includes("tab/active")) return "tab_active";
  if (chain.includes("tab/inactive") || chain.includes("tab/")) return "tab_inactive";
  if (chain.includes("bottom navigation") || chain.includes("nav/bottom") || chain.includes("sky nanvigation")) return "nav";
  if (chain.includes("input/")) return "input";
  if (chain.includes("banner/") || chain.includes("announcement")) return "banner";
  if (chain.includes("avatar")) return "avatar";
  if (chain.includes("status bar")) return "statusbar";

  return "default";
}

function getNameChain(node) {
  const parts = [node.name];
  let p = node.parent;
  for (let i = 0; i < 6 && p; i++) { parts.push(p.name); p = p.parent; }
  return parts.join("|").toLowerCase();
}
```

---

### Hex-to-Token Mapping (Ground Truth)

Every mapping below is verified against the approved reference screen `38:4071`.

> ⚠️ **SEMANTIC CORRECTNESS RULE (April 2026 fix)**
>
> **NEVER cross-apply tokens from a different semantic category.** Specifically:
> - Card context → ALWAYS use `card/border` for strokes, `card/bg` for fills — even if `border/default` has "better" dark-mode contrast
> - Button context → ALWAYS use `btn_*` tokens — even if the button is inside a card
> - Nav context → ALWAYS use `nav_*` tokens
> - Input context → ALWAYS use `input_*` tokens
>
> If a semantically correct token produces poor contrast in dark mode, that is a **DS-level issue**
> to flag in the Step 2.5 audit — NOT a reason to swap in a token from a different category.
> The tokenization layer must reflect what the element IS, not work around DS gaps.

```javascript
function resolveToken(hex, nodeType, context, isStroke, tokens) {
  const isText = nodeType === 'TEXT';
  const isVector = nodeType === 'VECTOR' || nodeType === 'BOOLEAN_OPERATION';
  const isFrame = nodeType === 'FRAME' || nodeType === 'RECTANGLE' || nodeType === 'ELLIPSE';

  // ── #FFFFFF ──────────────────────────────────────────────────────────────
  if (hex === "ffffff") {
    if (isStroke) {
      // Semantic correctness: use the token that matches the ELEMENT'S identity
      if (context === "card") return tokens.card_border;       // Card stroke → card/border
      if (context === "button") return tokens.border_default;  // Button stroke → border/default
      if (context === "input") return tokens.input_border;     // Input stroke → input/border
      if (context === "nav") return tokens.nav_border;         // Nav stroke → nav/border
      if (isFrame && nodeType !== 'ELLIPSE') return tokens.card_border; // generic frame fallback
      return null; // VECTOR/ELLIPSE strokes → leave null (icon halos, avatar rings)
    }
    if (isText) return tokens.text_inverse;        // white text = on dark bg
    if (isVector) return tokens.icon_inverse;       // white icon = on dark bg
    // ⚠️ CRITICAL: NEVER apply btn_pri_text to FRAME/RECT nodes — btn_pri_text (#fff both modes)
    // causes frames to stay white in dark mode. Only TEXT/VECTOR nodes should use btn_pri_text.
    if (context === "card") return tokens.card_bg;  // Card/* fill → #141414 dark
    if (context === "nav") return tokens.nav_bg;    // Bottom Navigation fill
    if (context === "tab_active") return null;      // active tab is blue, not white
    if (context === "tab_inactive") return tokens.bg_primary; // inactive tab bg
    if (context === "avatar" || context === "banner") return tokens.bg_primary;
    // Default for all FRAME/RECT/ELLIPSE white fills: bg_primary (→ dark in dark mode)
    return tokens.bg_primary;
  }

  // ── #020531 / #000000 / #10121F ──────────────────────────────────────────
  if (["020531","000000","10121f","0a0a0a"].includes(hex)) {
    if (isText) return tokens.text_primary;
    if (isVector) return tokens.icon_primary;
    return tokens.text_primary;
  }

  // ── #042FF2 (brand blue) ──────────────────────────────────────────────────
  if (["042ff2","042ff1","0430f2"].includes(hex)) {
    if (isStroke) {
      if (context === "button") return tokens.border_strong;  // icon button outline
      if (context === "nav") return tokens.icon_brand;        // nav icon stroke
      return tokens.border_strong;
    }
    if (isText) {
      if (context === "nav") return tokens.nav_active_text;   // active nav label
      if (context === "button") return tokens.btn_sec_text;   // secondary button text
      return tokens.text_link;                                // "View All", link text
    }
    if (isVector) return tokens.icon_brand;                   // blue icon
    if (isFrame) {
      // Small tag/pill → brand/primary; button/tab → button/primary/bg
      if (context === "tag") return tokens.brand_primary;     // Tag/Intraday
      return tokens.btn_pri_bg;                               // Tab/Active, Button/primary
    }
    return tokens.brand_primary;
  }

  // ── #676983 (secondary gray) ──────────────────────────────────────────────
  if (["676983","626572","647483"].includes(hex)) {
    if (isText) return tokens.text_secondary;
    if (isVector) return tokens.icon_secondary;
    return tokens.icon_secondary;
  }

  // ── #068913 (success green) ───────────────────────────────────────────────
  if (["068913","038737","068a14"].includes(hex)) {
    if (isText) return tokens.text_success;
    if (isStroke) return tokens.status_success;
    if (isFrame) return tokens.status_success;   // Tag/BTST green fill
    return tokens.text_success;
  }

  // ── #DE2020 (error red) ───────────────────────────────────────────────────
  if (["de2020","d92020","e02020"].includes(hex)) {
    if (isText) return tokens.text_error;
    if (isStroke) return tokens.border_error;
    if (isFrame) return tokens.status_error;     // Tag/Expiry red fill
    return tokens.text_error;
  }

  // ── #EAEEFF / #E5F3FF (surface blue-tint) ────────────────────────────────
  if (["eaeeff","eaefff","e5f3ff"].includes(hex)) {
    if (isStroke) return tokens.bg_surface;               // notification/banner border → surface
    if (context === "button") return tokens.btn_sec_bg;   // Button/Buy fill
    return tokens.bg_surface;                             // icon button bg, notification bg
  }

  // ── #FFF2D7 (warning amber tint) ─────────────────────────────────────────
  // No matching SKY DS token — leave unbound (illustration/custom warning shade)
  if (hex === "fff2d7") return null;

  // ── #F2F4FC / #F8F8FA (light gray backgrounds) ───────────────────────────
  if (["f2f4fc","f8f8fa","f2f4fb"].includes(hex)) {
    if (context === "tag") return tokens.bg_tag;           // Tag/Expiry gray fill
    if (context === "input") return tokens.input_bg;
    return tokens.bg_secondary;                            // pagination track, icon bg
  }

  // ── #DADFF6 (default border) ──────────────────────────────────────────────
  if (["dadff6","d6d7dc","dadff5"].includes(hex)) {
    if (isStroke) {
      if (context === "card") return tokens.card_border;   // Card/* stroke
      if (context === "nav") return tokens.nav_border;     // nav top border
      return tokens.border_default;                        // Tab/Inactive, general borders
    }
    return tokens.border_default;
  }

  // ── #DDDDDD (subtle border) ───────────────────────────────────────────────
  if (["dddddd","dcdcdc","d9d9d9"].includes(hex)) {
    if (isStroke) return tokens.border_subtle;
    return tokens.border_subtle;
  }

  // ── #DCE0EF (divider / disabled) ─────────────────────────────────────────
  if (["dce0ef","dce1ef"].includes(hex)) {
    if (isText || isVector) return tokens.divider_subtle;  // dimmed nav inactive items
    return tokens.divider_subtle;
  }

  // ── Status backgrounds ────────────────────────────────────────────────────
  if (["eaf6ee","e0f6e8","e8f5ea","edf7ed"].includes(hex)) return tokens.status_success_bg;
  if (["fce9e9","fae1e1","fde8e8"].includes(hex)) return tokens.status_error_bg;

  // ── Button disabled ───────────────────────────────────────────────────────
  if (["dce0ef","ebedef","f6f6f8"].includes(hex) && context === "button") return tokens.btn_dis_bg;

  return null; // Unknown / illustration / off-palette — skip
}
```

### Token Object Reference (pass as `tokens` argument)

```javascript
const tokens = {
  // Backgrounds
  bg_primary:       'VariableID:20:1662',
  bg_secondary:     'VariableID:20:1663',
  bg_surface:       'VariableID:20:1664',
  bg_card_generic:  'VariableID:20:1665', // non-UI use only
  input_bg:         'VariableID:20:1668',
  bg_tag:           'VariableID:20:1670',
  // Card (use these for ALL Card/* frames)
  card_bg:          'VariableID:20:1727',
  card_border:      'VariableID:20:1728',
  // Text
  text_primary:     'VariableID:20:1671',
  text_secondary:   'VariableID:20:1672',
  text_disabled:    'VariableID:20:1674',
  text_inverse:     'VariableID:20:1675',
  text_link:        'VariableID:20:1676',
  text_success:     'VariableID:20:1678',
  text_error:       'VariableID:20:1679',
  // Icons
  icon_primary:     'VariableID:20:1690',
  icon_secondary:   'VariableID:20:1691',
  icon_brand:       'VariableID:20:1692',
  icon_inverse:     'VariableID:20:1693',
  // Borders
  border_default:   'VariableID:20:1682',
  border_subtle:    'VariableID:20:1683',
  border_strong:    'VariableID:20:1684',
  border_error:     'VariableID:20:1685',
  divider_subtle:   'VariableID:20:1689',
  input_border:     'VariableID:20:1732',
  // Buttons
  btn_pri_bg:       'VariableID:20:1697',
  btn_pri_text:     'VariableID:20:1698',
  btn_sec_bg:       'VariableID:20:1701',
  btn_sec_text:     'VariableID:20:1702',
  btn_dis_bg:       'VariableID:20:1704',
  // Brand & Status
  brand_primary:    'VariableID:20:1718',
  status_success:   'VariableID:20:1708',
  status_success_bg:'VariableID:20:1710',
  status_error:     'VariableID:20:1711',
  status_error_bg:  'VariableID:20:1713',
  status_warning:   'VariableID:20:1714',
  // Navigation
  nav_bg:           'VariableID:20:1722',
  nav_active_text:  'VariableID:20:1723',
  nav_border:       'VariableID:20:1726',
};
```

### How to Bind a Variable to a Paint

```javascript
// CORRECT: Use setBoundVariableForPaint on the paint object, then assign
const variable = await figma.variables.getVariableByIdAsync("VariableID:20:1671");
const paint = figma.variables.setBoundVariableForPaint(
  figma.util.solidPaint("#000000"), // base paint (color doesn't matter, variable overrides)
  "color",
  variable
);
node.fills = [paint];

// For strokes, same pattern:
node.strokes = [paint];
```

Do NOT use `node.setBoundVariable("fills", 0, "color", variable)` — that throws an error for fills/strokes.

### Applying Text Styles

```javascript
// Build a size_weight → style ID map
const STYLE_MAP = {
  "36_Bold": "S:70f9b66f9d61460107a13a7a598fb6c589ab7cb7,",
  "30_Bold": "S:db6d17663f11d273936c0ef08a2f26d88d0f7823,",
  "24_Bold": "S:2323dfe3acc7d858b59a117b7002b26f1ef2f3a2,",
  "20_Bold": "S:4848b638b9ae86a5d8193b474e19397ac188a4a2,",
  "18_Bold": "S:4007f9be7f753d357dc1063879032cebdaba2ded,",
  "16_Bold": "S:5c7fc7a345d8220d3db489757065fccbc0f9eb6d,",
  "16_Medium": "S:9d782e68a9eb2150144b0a3bf024e39853f15d81,",
  "14_Bold": "S:50b38d8557ca95bbcc3a92c7532b71194fb7da8a,",
  "14_Medium": "S:42261e24c2c3a60f41e8a6ff7508e71d5778c7fa,",
  "14_Regular": "S:45795c45e6899393cfb4aa33a8cb1e2f9af7e450,",
  "14_SemiBold": "S:babfe6dc5dc426f65e2ab9af83109ede2281fab6,",
  "12_Bold": "S:8a49fe82be4ae3eca4def56b3b318cf7232f2284,",
  "12_Medium": "S:de5996f1bcfb05da2bfecdc22b7fe369dd49af27,",
  "12_Regular": "S:29ade159beac7af4576011504956cd42a57ffd18,",
  "10_Bold": "S:2f606fb391d9d2fc2d96c30bfa2bb5a1544708d9,",
  "10_Medium": "S:bc56bb9fb0fc59d97a55e8531adfb8ce17926dc6,",
  "10_Regular": "S:2a795adae3528af54500d4202a348fd1bd03b163,",
  // SemiBold variants
  "28_SemiBold": "S:7b0cc83dfaba70c09332144170876a3b51df243a,",
  "24_SemiBold": "S:8277efa713ad86f341e66ef5fd3351e71b944932,",
  "20_SemiBold": "S:88ea18857c0658d893d501b522a5c9fd1a4d5c9d,",
  "18_SemiBold": "S:dd70cbdc428a908af658ddd7ce8baeb3eb05c8a1,",
  "16_SemiBold": "S:8bde5d995694e0294132cbc5a10704c56efff9a4,",
  "12_SemiBold": "S:54f39ea9d102bf1fda1866b29741b0b3fc12bbb5,",
  "10_SemiBold": "S:c314d6b976dce341cbe1804cf3b1a3df866d3ed5,",
};

// Apply to text nodes
for (const t of textNodes) {
  const size = typeof t.fontSize === "number" ? t.fontSize : null;
  const weight = t.fontName?.style;
  if (!size || !weight) continue; // mixed fonts — skip

  const styleId = STYLE_MAP[`${size}_${weight}`];
  if (styleId) {
    await t.setTextStyleIdAsync(styleId); // MUST use async
  }
}
```

### Batch Processing Pattern

For large pages (100+ components), process in batches to avoid timeouts:

```javascript
// Process by component category to stay under 30s timeout
const buttons = comps.filter(c => c.name.startsWith("Button/"));
const inputs = comps.filter(c => c.name.startsWith("Input/"));
const others = comps.filter(c => !c.name.startsWith("Button/") && !c.name.startsWith("Input/"));

// Run each batch in a separate figma_execute call
```

### Verification

After each step, run an audit to check binding coverage:

```javascript
let boundFills = 0, unboundFills = 0;
for (const n of allNodes) {
  if (n.fills?.length > 0 && n.fills[0]?.type === "SOLID" && n.fills[0]?.visible !== false) {
    if (n.fills[0]?.boundVariables?.color) boundFills++;
    else unboundFills++;
  }
}
const rate = Math.round(boundFills / (boundFills + unboundFills) * 100);
// Target: 85%+ fill binding, 95%+ stroke binding
```

---

## Step 2.5: Dark Mode Contrast Audit (Flag, Don't Fix)

> **Added April 2026.** This step runs AFTER Step 2 verification but BEFORE Step 3 Visual QA.
> It flags token combinations that may produce poor contrast in dark mode — but it does NOT
> silently swap tokens. The correct token stays; the issue goes into the report for the DS team.

### Why this exists

Previously, the tokenization pipeline would silently swap `card/border` → `border/default` on card
strokes because `card/border` resolves to `#FFFFFF @ 10%` in dark mode (nearly invisible on `#141414`
card backgrounds). This created semantically incorrect bindings: a card stroke tagged with a generic
border token. The right behavior: apply `card/border` because the element IS a card, and flag the
contrast issue for the design system team to address at the token definition level.

### What to scan

After Step 2 binding is complete, run this audit on all bound strokes:

```javascript
// Known low-contrast pairs in dark mode (flag these)
const LOW_CONTRAST_PAIRS = [
  { token: "card/border", parent: "card/bg", darkContrast: 1.1, note: "card/border (#FFF@10%) on card/bg (#141414) is nearly invisible" },
  { token: "divider/subtle", parent: "card/bg", darkContrast: 1.3, note: "divider/subtle (#FFF@20%) on card/bg can be hard to see" },
  { token: "nav/border", parent: "nav/bg", darkContrast: 1.2, note: "nav/border (#1F1F1F) on nav/bg (#0A0A0A) is very subtle" },
];
```

### Output format

Include in the final report as a separate section:

```
### Dark Mode Contrast Flags (for DS team)
These bindings are SEMANTICALLY CORRECT but may produce low contrast in dark mode.
Fix at the token definition level, not by swapping to a different token category.

| Element | Token applied | Parent token | Dark contrast | Recommendation |
|---|---|---|---|---|
| Card/Expert Pick stroke | card/border | card/bg | ~1.1:1 | Increase card/border dark opacity to 20-30% |
| Nav/Bottom border | nav/border | nav/bg | ~1.2:1 | Lighten nav/border dark value |
```

### What NOT to do

- ❌ Do NOT swap `card/border` → `border/default` to fix contrast
- ❌ Do NOT swap `nav/border` → `border/subtle` to fix contrast
- ❌ Do NOT override any semantically correct token for visual reasons
- ✅ DO flag the issue and let the DS team decide whether to update the token value

---

## Step 3: Visual QA + Fix Loop

Binding coverage % does not guarantee visual correctness. A frame can be fully tokenized and still look broken — invisible strokes, wrong card fills, unreadable text, broken overlays. This step catches those failures and ensures **light mode and dark mode are both seamless with no UI issues**.

### When to run

Always — immediately after Step 2 (and the auto-fix pass). Do not skip even if binding coverage hits 100%.

---

### 3a — Screenshot the first 3–4 screens in LIGHT mode first

Set all target screens to **SKY Light (`20:2`)**, navigate to each in sequence, and capture a screenshot per screen.

```javascript
// Find the first N top-level frames on the current page
const page = figma.currentPage;
const screens = page.children
  .filter(n => n.type === "FRAME")
  .slice(0, 4);

const collection = await figma.variables.getVariableCollectionByIdAsync(
  "VariableCollectionId:20:1661"
);

// Set all screens to light mode
for (const screen of screens) {
  screen.setExplicitVariableModeForCollection(collection, "20:2");
}
// → Use figma_navigate + figma_take_screenshot for each screen in sequence
```

Use `figma_navigate` to bring each frame into the viewport before calling `figma_take_screenshot`.

---

### 3b — Visual inspection checklist (run for EVERY screenshot)

Check all six points for each screen:

| # | Check | What to look for | Fail signal |
|---|---|---|---|
| 1 | **Card fills** | Cards white (light) / `#141414` (dark) — distinct from page background | Card invisible — same tone as background |
| 2 | **Strokes** | Card borders, input outlines, dividers all visible | Stroke disappears against its parent fill |
| 3 | **Button fills** | Primary: `#042FF2` both modes; Secondary: `#EAEEFF` light / `#272727` dark | Button wrong fill or blends into background |
| 4 | **Text contrast** | Primary text clearly legible; secondary text visibly lighter but readable | Text invisible or unreadable against parent |
| 5 | **Tag / pill fills** | Tags read as distinct chips, not merged into card background | Tags blend into card surface |
| 6 | **Overlays & modals** | Bottom sheets, dialogs, toast overlays should have a distinct surface fill and visible scrim/backdrop | Overlay invisible, scrim missing, or overlay bleeds into page background |

---

### 3c — Resolving failures with color tokens

When a visual failure is found, identify the offending node, its current token, and the correct one. Re-bind using:

```javascript
// Re-bind a fill
async function rebindFill(nodeId, correctVariableId) {
  const node = await figma.getNodeByIdAsync(nodeId);
  const variable = await figma.variables.getVariableByIdAsync(correctVariableId);
  const paint = figma.variables.setBoundVariableForPaint(
    figma.util.solidPaint("#000000"), "color", variable
  );
  node.fills = [paint];
}

// Re-bind a stroke
async function rebindStroke(nodeId, correctVariableId) {
  const node = await figma.getNodeByIdAsync(nodeId);
  const variable = await figma.variables.getVariableByIdAsync(correctVariableId);
  const paint = figma.variables.setBoundVariableForPaint(
    figma.util.solidPaint("#000000"), "color", variable
  );
  node.strokes = [paint];
}
```

**Common failure → correct token mappings:**

| Failure | Wrong token likely applied | Correct token |
|---|---|---|
| Card invisible on background | `background/primary` (`20:1662`) | `background/card` (`20:1665`) |
| Card border invisible in dark | `card/border` (`20:1728`) = `#FFF@10%` too subtle | `border/default` (`20:1682`) = `#647483` in dark |
| Input border missing | unbound / `border/default` | `input/border` (`20:1732`) |
| Secondary button unreadable in dark | `background/secondary` | `button/secondary/bg` (`20:1701`) |
| Tag merges into card | `background/card` | `background/tag` (`20:1670`) |
| Divider invisible | raw `#DCE0EF` unbound | `border/default` (`20:1682`) |
| Overlay surface invisible | unbound / `background/primary` | `background/surface` (`20:1664`) |
| Scrim / backdrop missing | no fill or raw transparent | `background/primary` at reduced opacity, or a dedicated scrim token if defined |

---

### 3d — Re-audit after light-mode fixes

After fixing all light-mode failures:
1. Re-run the binding audit (Step 2 Verification script)
2. Re-capture screenshots for affected screens in light mode
3. Confirm all six checklist points pass
4. Repeat fixes → re-capture loop until checks pass or no further progress is possible

---

### 3e — Switch ALL screens to DARK mode and repeat full visual QA

Once light mode is clean, switch every target screen to **SKY Dark (`20:3`)** and re-run steps 3a–3d from scratch for dark mode.

```javascript
// Switch all screens to dark mode
const collection = await figma.variables.getVariableCollectionByIdAsync(
  "VariableCollectionId:20:1661"
);
for (const screen of screens) {
  screen.setExplicitVariableModeForCollection(collection, "20:3");
}
// → figma_navigate + figma_take_screenshot for each screen
```

Dark mode has unique failure patterns — check specifically:
- **Surfaces that go invisible**: cards, input fields, bottom sheets often rely on `#141414` / `#1A1A1A` backgrounds that can blend if the wrong token was applied
- **Strokes**: `card/border` resolves to `rgba(255,255,255,0.10)` in dark — nearly invisible on dark surfaces; swap to `border/default` (`#647483`) where the border must be clearly visible
- **Text**: `text/secondary` resolves to `rgba(255,255,255,0.85)` — ensure it reads against `#141414` card backgrounds
- **Overlays**: scrim should be dark enough to separate the overlay from content below; if the overlay surface is also dark, the scrim may disappear entirely
- **Status colors**: success green (`#57D49C`) and error red (`#DB7D7D`) must remain legible against dark card fills

Apply any new fixes found in dark mode using the same `rebindFill` / `rebindStroke` helpers, then re-capture to confirm.

---

### 3f — Final dual-mode sign-off

The run is complete **only when both light mode and dark mode pass all six checklist points** with no remaining UI issues. Do not close the loop on light-mode-only success.

After both modes pass, produce the final report:

```
## Visual QA Summary
- Screens reviewed: [N] × light + [N] × dark
- Fills: XX% bound  |  Strokes: XX% bound  |  Text styles: XX% bound

### Fixes applied — Light mode
- [node name] — [old token] → [new token] — reason

### Fixes applied — Dark mode
- [node name] — [old token] → [new token] — reason

### Remaining issues (if any)
- [node name] — [hex] unbound — UI / illustration / unclassified
- [node name] — stroke contrast [ratio] in [mode] — token: [name]

### Screenshots
Light mode: [screen 1…N]
Dark mode:  [screen 1…N]
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `Cannot call with documentAccess: dynamic-page` | Using sync API | Use `setTextStyleIdAsync()` and `getNodeByIdAsync()` |
| `Cannot unwrap symbol` | Mixed cornerRadius or fontSize | Check `typeof value === "number"` before using |
| `fills variable bindings must be set on paints directly` | Using `setBoundVariable()` on node | Use `setBoundVariableForPaint()` on paint object |
| Bindings survive JSON clone | JSON doesn't strip variable metadata | Rebuild paint objects manually with raw r/g/b values |
| `findAll` misses root node | By design — `findAll` only searches children | Process root node separately |
| Effects not tokenizable | Figma limitation — effects can't bind to variables | Set effects per-frame; use subtle values that work in both themes |

---

## Light vs Dark Mode Considerations

Since effects (shadows) and physical properties (stroke weight, corner radius) cannot be tokenized per mode, when a single frame must work in both light and dark:

- Use subtle, neutral shadows (e.g., `#000000 @ 6%`, radius 20, offset y:4) that look acceptable in both themes
- Token-bound fills and strokes handle mode switching automatically
- If light and dark need drastically different effects, maintain separate frames per mode

---

## Workflow Checklist

- [ ] **Pre-check**: Count existing bindings. If already tokenized → force light mode (`20:2`) and re-tokenize (no pausing). If frame is broken → clone fallback (Rule 4).
- [ ] **Step 0**: Detach all tokens (fills, strokes, text styles) from target
- [ ] **Step 1**: Rename layers following Card/Button/Tag/Nav/Input conventions
- [ ] **Step 2a**: Load all 75 color token variables by ID
- [ ] **Step 2b**: Apply color tokens to fills using context-aware hex mapping
- [ ] **Step 2c**: Apply color tokens to strokes
- [ ] **Step 2d**: Apply text styles using size_weight mapping
- [ ] **Step 2 verify**: Run binding audit — target 85%+ fills, 95%+ strokes; auto-fix gaps
- [ ] **Step 2.5**: Run dark mode contrast audit — flag low-contrast token pairs, do NOT swap tokens
- [ ] **Step 3a**: Screenshot first 3–4 screens in SKY Light (`20:2`)
- [ ] **Step 3b**: Inspect each light-mode screenshot — card fills, strokes, button fills, text contrast, tags, overlays (6 checks)
- [ ] **Step 3c**: Re-bind any failing nodes using the failure → correct token table
- [ ] **Step 3d**: Re-audit binding % + re-capture light-mode screenshots; loop until all 6 checks pass
- [ ] **Step 3e**: Switch ALL screens to SKY Dark (`20:3`) — re-run full 3a–3d for dark mode (invisible surfaces, low-contrast strokes, overlay/scrim, status colors)
- [ ] **Step 3f**: Both modes pass all 6 checks → produce final Visual QA Summary with light + dark screenshots
