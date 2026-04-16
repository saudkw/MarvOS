# MarvOS

MarvOS is a Bitburner control shell built around one dashboard and a small set of focused automation scripts.

## What Is In This Repo

- `MarvOS/`: classic UI, orchestration, loader, and repo-based update flow
- `MarvOSBeta/`: hook-driven Beta UI using the same backend and engine scripts
- root scripts such as `formulas-batcher.js`, `startup.js`, `xp-grind.js`, `hacknet-manager.js`, and `stock-trader.js`
- `MarvOS.bundle.txt`: the bundled payload that Bitburner downloads and installs
- `tools/build_marvos_installer.py`: regenerates both `MarvOS/install.js` and `MarvOS.bundle.txt`

## In-Game Install

MarvOS is packaged so the runtime files come from one bundle. After the first tiny bootstrap, install and upgrades are one command.

### First install

```text
wget https://raw.githubusercontent.com/saudkw/MarvOS/main/MarvOS/load.js MarvOS/load.js
run MarvOS/load.js
```

### Upgrades

Once `MarvOS/load.js` exists in the game, upgrades are just:

```text
run MarvOS/load.js
```

That command downloads the latest bundle, overwrites the old files, and boots the new MarvOS immediately. No extra scripts need to be pasted into `home`.

## Launching The UI

Classic UI:

```text
run MarvOS/Loader.js
```

Beta UI:

```text
run MarvOSBeta/Loader.js
```

Both frontends use the same backend, orchestrator, and engine scripts.

## Repo Workflow

After changing files locally, regenerate the bundle:

```bash
python3 tools/build_marvos_installer.py
```

Then commit and push the updated source plus `MarvOS.bundle.txt`.
