#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "MarvOS" / "install.js"
BUNDLE_OUTPUT = ROOT / "MarvOS.bundle.txt"

FILES = [
    "MarvOS/Loader.js",
    "MarvOS/load.js",
    "MarvOS/reload.js",
    "MarvOS/orchestrator.js",
    "MarvOS/ui/MarvOS.jsx",
    "MarvOSBeta/Loader.js",
    "MarvOSBeta/ui/MarvOSBeta.jsx",
    "MarvOS/lib/status.js",
    "MarvOS/lib/options.js",
    "MarvOS/lib/runtime.js",
    "MarvOS/lib/money-core.js",
    "MarvOS/lib/progression.js",
    "MarvOS/lib/scoring.js",
    "MarvOS/extras/serverRun.js",
    "formulas-batcher.js",
    "startup.js",
    "xp-grind.js",
    "hacknet-manager.js",
    "stock-trader.js",
    "rep-share.js",
    "share-worker.js",
    "backdoor-targets.js",
    "rootall.js",
    "buyservers.js",
    "hack.js",
    "grow.js",
    "weaken.js",
    "quack/early-hack.js",
]


def build_payload() -> list[dict[str, str]]:
    payload: list[dict[str, str]] = []
    for rel_path in FILES:
        path = ROOT / rel_path
        payload.append(
            {
                "path": rel_path,
                "contents": path.read_text(encoding="utf-8"),
            }
        )
    return payload


def main() -> None:
    payload = build_payload()
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    script = f"""const FILES = {payload_json};

/** @param {{NS}} ns */
export async function main(ns) {{
    let written = 0;

    for (const file of FILES) {{
        ns.write(file.path, file.contents, "w");
        written += 1;
    }}

    ns.tprint(`MarvOS installed: ${{written}} files`);
    ns.tprint("Next: run MarvOS/Loader.js");
}}
"""

    OUTPUT.write_text(script, encoding="utf-8")
    BUNDLE_OUTPUT.write_text(payload_json, encoding="utf-8")
    print(f"wrote {OUTPUT}")
    print(f"wrote {BUNDLE_OUTPUT}")


if __name__ == "__main__":
    main()
