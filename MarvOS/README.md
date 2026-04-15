# MarvOS

MarvOS is your Bitburner control shell.

Current goals:
- control your own scripts from one dashboard
- show progression status and current activity
- keep the architecture cleaner than SphyxOS
- reuse the good ideas from SphyxOS without adopting the whole monolith

Current entrypoint:
- `/MarvOS/Loader.js`

Current dashboard:
- `/MarvOS/ui/MarvOS.jsx`

Current data:
- `/MarvOS/data/options.txt`
- `/MarvOS/data/*-status.txt`

Current philosophy:
- tiny worker scripts
- simple persistent options
- status files instead of a huge port protocol
- orchestration around your actual scripts:
  - `formulas-batcher.js`
  - `startup.js`
  - `xp-grind.js`
  - `hacknet-manager.js`
  - `rep-share.js`
