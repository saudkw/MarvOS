# MarvOS Architecture

## What Was Reused From SphyxOS

SphyxOS UI shell pattern:
- one long-lived JSX dashboard
- sections of buttons grouped by feature
- continuous rerender into a tail window
- orchestration layer above the actual workers

Relevant SphyxOS file:
- `/Users/saud/Downloads/Bitburn/sphyxos/repo/SphyxOS/bins/LoaderSphyxOS.jsx`

The useful ideas were:
- dashboard as control plane
- visible current activity
- feature-level toggles
- progression-aware operations

The parts intentionally not copied:
- huge port protocol
- monolithic all-game controller
- cheat UI integration by default
- RAM-dodging every API call

## MarvOS Shape

Entry:
- `/MarvOS/Loader.js`

UI shell:
- `/MarvOS/ui/MarvOS.jsx`

Support libraries:
- `/MarvOS/lib/options.js`
- `/MarvOS/lib/status.js`
- `/MarvOS/lib/progression.js`
- `/MarvOS/lib/scoring.js`

## Design Choices

### 1. File-backed state instead of heavy port choreography

SphyxOS uses many ports for cross-script state and commands.

MarvOS uses:
- one persistent options file
- lightweight JSON status files written by controllers

This is easier to reason about and easier to debug.

### 2. Keep your scripts as the execution layer

MarvOS does not replace your current engines immediately.

It orchestrates:
- `formulas-batcher.js`
- `startup.js`
- `xp-grind.js`
- `hacknet-manager.js`
- `rep-share.js`
- `backdoor-targets.js`

### 3. Progression-first dashboard

The dashboard is centered on:
- current money/xp activity
- current target and controller action
- milestone backdoor/faction progress
- top target ranking snapshot

### 4. Clean path to future upgrades

Next likely expansions:
- integrated progression autopilot
- direct control of controller settings from the dashboard
- richer target diagnostics
- augment planning and reset checklist
- optional non-default cheat tools in a separate section
