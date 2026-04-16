# SKY DS — Figma Tokenize Skill

A Claude Code skill that tokenizes Figma frames with the **HDFC Securities SKY Design System** — binding color variables and text styles in one automated pass, with full light/dark mode support.

---

## What it does

Runs a 3-step pipeline on any Figma frame:

| Step | What happens |
|---|---|
| **Step 0** | Detaches all existing variable bindings (clean slate) |
| **Step 1** | Renames layers semantically so context detection works |
| **Step 2** | Binds every fill, stroke, and text node to the correct SKY DS token |
| **Verify** | Reports coverage %, flags unbound nodes, runs auto-fix loop |
| **Visual QA** | Screenshots in light + dark mode, checks contrast |

Coverage targets: **≥85% fills · ≥85% strokes · ≥85% text styles**

---

## Requirements

| Requirement | Notes |
|---|---|
| [Claude Code](https://claude.ai/claude-code) | CLI version, not the web app |
| Figma Desktop app | Required for the plugin bridge |
| [Claude Figma Console plugin](https://www.figma.com/community/plugin/1436543797280543446) | Installed and running in Figma Desktop |
| Access to the SKY DS Figma file | `VariableCollectionId:20:1661` must be present |

---

## Install (one command)

```bash
npx github:abhimahamkali/sky-ds-figma-tokenize
```

That's it — no npm account needed. `npx` downloads directly from GitHub and runs the installer.

The installer:
- Copies `SKILL.md` → `~/.claude/skills/figma-tokenize/SKILL.md`
- Copies the slash command → `~/.claude/commands/figma-tokenize.md`

**Run the same command again anytime to update to the latest version.**

---

## Usage

Open Claude Code in any terminal. With Figma Desktop open and the Console plugin running:

```
/figma-tokenize https://www.figma.com/design/FILE_ID/NAME?node-id=62-826
```

or with a bare node ID:

```
/figma-tokenize 62:826
```

Claude parses the URL, extracts the frame, and runs the full pipeline. You watch your Figma file get tokenized in real time.

---

## Why sessions don't break this

The `SKILL.md` file IS the workflow. Claude reads it fresh at the start of every `/figma-tokenize` call — so:

- ✅ New sessions always have the complete instructions
- ✅ Context limits don't matter — no session memory required
- ✅ All 75 token IDs, hex mappings, and binding rules live in `SKILL.md`
- ✅ Updating the skill = `npx sky-ds-figma-tokenize` pulls the latest

---

## How to update the skill

When you discover a new edge case or fix a bug, edit `SKILL.md` and push:

```bash
cd ~/.claude/skills/figma-tokenize   # or wherever you cloned it
git add SKILL.md
git commit -m "fix: map #cb7434 orange to status_warning"
git push
```

Your teammates get the update by running the install command again — it always pulls from `main`:

```bash
npx github:abhimahamkali/sky-ds-figma-tokenize
```

---

## Token system overview

```
Primitives  → SKY Colors (47 variables)
                └── Semantic → Color Tokens (75 vars, 2 modes)
                                  SKY Light (20:2)
                                  SKY Dark  (20:3)
                      └── Scale → Radius, Spacing, Typography
```

Collection: `VariableCollectionId:20:1661`

Key tokens used in binding:

| Role | Token | Light | Dark |
|---|---|---|---|
| Page background | `background/primary` | `#FFFFFF` | `#0A0A0A` |
| Card background | `color/card/bg` | `#FFFFFF` | `#141414` |
| Primary text | `text/primary` | `#020531` | `#FFFFFF` |
| Secondary text | `text/secondary` | `#676983` | `#FFFFFF@85%` |
| Brand blue | `brand/primary` | `#042FF2` | `#042FF2` |
| Success | `status/success` | `#068913` | `#57D49C` |
| Error | `status/error` | `#DE2020` | `#DB7D7D` |

Full token reference is in `SKILL.md`.

---

## Known unresolvable gaps

These colors are intentionally left unbound — no matching token exists in SKY DS:

| Hex | Context | Reason |
|---|---|---|
| `#CB7434` | Tag/BTST orange | No `color/status/warning/orange` token |
| `#9E77ED`, `#8257D9` | Avatar circles | Illustration palette |
| `#001B33` | Chart deep shadow | Chart/illustration |
| `4.69px`, `13.44px` text | Scaled instances | Non-standard fractional sizes from scaled component instances |
| `Black` font weight | Stock tickers | SKY DS only defines Regular/Medium/SemiBold/Bold |

---

## Contributing

1. Fork → branch → edit `SKILL.md`
2. Test by running a tokenize on a frame
3. Check coverage report and dark mode screenshots
4. PR back with the frame ID you tested on

---

## License

MIT — use freely, attribution appreciated.
