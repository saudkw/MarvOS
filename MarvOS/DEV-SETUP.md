# MarvOS Update Workflow

There are now two valid paths:

1. `Load OS` from a GitHub bundle
2. official websocket filesync for active local development

## One-command GitHub loader

Generate the bundle locally:

```bash
python3 tools/build_marvos_installer.py
```

Commit `MarvOS.bundle.txt` to your repo, then in Bitburner run once with the raw URL:

```text
run MarvOS/load.js https://raw.githubusercontent.com/<user>/<repo>/<branch>/MarvOS.bundle.txt
```

That saves the source URL. After that, upgrades are just:

```text
run MarvOS/load.js
```

`load.js` downloads the latest bundle, overwrites the old files, and boots MarvOS immediately.

## Optional websocket filesync dev path

Use the official Bitburner filesync websocket flow instead of reinstalling MarvOS by paste.

### Local

1. From this folder run:

   ```bash
   npm run sync
   ```

2. Keep it running. It will print the local port it is serving on.

### Bitburner

1. Open `Settings -> Remote API`.
2. Set:
   - `Hostname`: `localhost`
   - `Port`: `12525`
   - `Use wss`: off
3. Click `Connect`.

With `pushAllOnConnection: true`, the whole repo pushes on connect and then changed files push on save.

## Reloading after filesync

After file changes are synced into the game, reload MarvOS:

```text
run MarvOS/load.js
```

If you changed engine scripts too and want a clean restart:

```text
run MarvOS/reload.js --full
```
