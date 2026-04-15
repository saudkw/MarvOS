const MILESTONE_TARGETS = [
    "CSEC",
    "avmnite-02h",
    "I.I.I.I",
    "run4theh111z",
    "fulcrumassets",
];

/** @param {NS} ns */
export async function main(ns) {
    const requested = String(ns.args[0] ?? "").trim();
    const target = requested || pickNextTarget(ns);

    if (!target) {
        ns.tprint("No eligible milestone backdoor target found");
        return;
    }

    if (!canBackdoor(ns, target)) {
        ns.tprint(`Target not ready: ${target}`);
        return;
    }

    const path = shortestPath(ns, "home", target);
    if (path.length === 0) {
        ns.tprint(`No path found to ${target}`);
        return;
    }

    const command = buildTerminalCommand(path);
    runTerminalCommand(command);
    ns.tprint(`BACKDOOR -> ${target}`);
}

function pickNextTarget(ns) {
    for (const target of MILESTONE_TARGETS) {
        if (canBackdoor(ns, target)) {
            return target;
        }
    }

    return "";
}

function canBackdoor(ns, target) {
    if (!serverExists(ns, target)) return false;
    if (!ns.hasRootAccess(target)) return false;

    const server = ns.getServer(target);
    if (server.backdoorInstalled) return false;
    if (server.requiredHackingSkill > ns.getHackingLevel()) return false;

    return shortestPath(ns, "home", target).length > 0;
}

function serverExists(ns, target) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        if (host === target) return true;

        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }

    return false;
}

function shortestPath(ns, start, goal) {
    if (start === goal) return [start];

    const seen = new Set([start]);
    const queue = [[start]];

    while (queue.length > 0) {
        const path = queue.shift();
        const host = path[path.length - 1];

        for (const next of ns.scan(host)) {
            if (seen.has(next)) continue;

            const nextPath = [...path, next];
            if (next === goal) return nextPath;

            seen.add(next);
            queue.push(nextPath);
        }
    }

    return [];
}

function buildTerminalCommand(path) {
    const hops = path.filter((host) => host !== "home");
    const connectChain = hops.map((host) => `connect ${host}`).join("; ");
    return connectChain ? `home; ${connectChain}; backdoor` : "home; backdoor";
}

function runTerminalCommand(command) {
    const input = globalThis.document.getElementById("terminal-input");
    input.value = command;
    const handlerKey = Object.keys(input).find((key) => key.startsWith("__reactProps"));
    if (!handlerKey) {
        throw new Error("Unable to access terminal input handler");
    }

    input[handlerKey].onChange({ target: input });
    input[handlerKey].onKeyDown({
        key: "Enter",
        preventDefault: () => null,
    });
}
