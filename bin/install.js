#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Paths ──────────────────────────────────────────────────────────────────
const HOME         = os.homedir();
const SKILLS_DIR   = path.join(HOME, '.claude', 'skills', 'figma-tokenize');
const COMMANDS_DIR = path.join(HOME, '.claude', 'commands');

const PKG_ROOT     = path.join(__dirname, '..');
const SKILL_SRC    = path.join(PKG_ROOT, 'SKILL.md');
const CMD_SRC      = path.join(PKG_ROOT, 'commands', 'figma-tokenize.md');

// ── Install ────────────────────────────────────────────────────────────────
console.log('\n🔧  Installing SKY DS Figma Tokenize skill for Claude Code...\n');

try {
  // 1. Create target directories
  fs.mkdirSync(SKILLS_DIR,   { recursive: true });
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });

  // 2. Copy SKILL.md → ~/.claude/skills/figma-tokenize/SKILL.md
  fs.copyFileSync(SKILL_SRC, path.join(SKILLS_DIR, 'SKILL.md'));
  console.log('  ✅  Skill installed   →  ' + path.join(SKILLS_DIR, 'SKILL.md'));

  // 3. Copy slash command → ~/.claude/commands/figma-tokenize.md
  fs.copyFileSync(CMD_SRC, path.join(COMMANDS_DIR, 'figma-tokenize.md'));
  console.log('  ✅  Command installed →  ' + path.join(COMMANDS_DIR, 'figma-tokenize.md'));

} catch (err) {
  console.error('\n❌  Installation failed:\n', err.message);
  process.exit(1);
}

// ── Done ───────────────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SKY DS Figma Tokenize — ready!

  HOW TO USE
  ──────────
  1. Open Figma Desktop and start the Claude Console plugin
  2. Open Claude Code in any terminal
  3. Paste a Figma frame URL or node ID:

     /figma-tokenize https://www.figma.com/design/FILE/NAME?node-id=62-826
     /figma-tokenize 62:826

  WHAT IT DOES
  ────────────
  → Detaches old bindings (Step 0)
  → Renames layers semantically (Step 1)
  → Binds every fill/stroke/text to SKY DS tokens (Step 2)
  → Verifies coverage (≥85%) and takes screenshots in light + dark mode

  KEEP IT UPDATED
  ───────────────
  npx sky-ds-figma-tokenize     (run again to update)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
