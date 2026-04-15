# MarvOS

MarvOS is a Bitburner control shell built around one dashboard and a small set of focused automation scripts.

## What Is In This Repo

- `MarvOS/`: UI, orchestration, loader, and repo-based update flow
- root scripts such as `formulas-batcher.js`, `startup.js`, `xp-grind.js`, `hacknet-manager.js`, and `stock-trader.js`
- `MarvOS.bundle.txt`: the bundled payload that Bitburner downloads and installs
- `tools/build_marvos_installer.py`: regenerates both `MarvOS/install.js` and `MarvOS.bundle.txt`

## In-Game Install

First-time bootstrap still needs one script in Bitburner. After that, updates are one command.

### First install

Create `MarvOS/install.js` in Bitburner and paste in the generated contents from this repo's `MarvOS/install.js`, then run:

```text
run MarvOS/install.js
run MarvOS/Loader.js
```

### Upgrades

Once `MarvOS/load.js` exists in the game, updates are:

```text
run MarvOS/load.js https://raw.githubusercontent.com/saudkw/MarvOS/main/MarvOS.bundle.txt
```

After the first successful run, `load.js` remembers the source URL. Future upgrades are just:

```text
run MarvOS/load.js
```

That command downloads the latest bundle, overwrites the old files, and boots the new MarvOS immediately.

## Repo Workflow

After changing files locally, regenerate the bundle:

```bash
python3 tools/build_marvos_installer.py
```

Then commit and push the updated source plus `MarvOS.bundle.txt`.
