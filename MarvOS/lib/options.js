const OPTIONS_PATH = "/MarvOS/data/options.txt";

/** @param {NS} ns */
export function loadOptions(ns, defaults) {
    if (!ns.fileExists(OPTIONS_PATH, "home")) {
        const initial = normalizeOptions(ns, { ...defaults }, defaults);
        saveOptions(ns, initial);
        return initial;
    }

    try {
        const raw = ns.read(OPTIONS_PATH).trim();
        if (!raw) {
            const initial = normalizeOptions(ns, { ...defaults }, defaults);
            saveOptions(ns, initial);
            return initial;
        }
        const merged = normalizeOptions(ns, { ...defaults, ...JSON.parse(raw) }, defaults);
        if (JSON.stringify(merged) !== JSON.stringify({ ...defaults, ...JSON.parse(raw) })) {
            saveOptions(ns, merged);
        }
        return merged;
    } catch {
        const initial = normalizeOptions(ns, { ...defaults }, defaults);
        saveOptions(ns, initial);
        return initial;
    }
}

/** @param {NS} ns */
export function saveOptions(ns, options) {
    ns.write(OPTIONS_PATH, JSON.stringify(options), "w");
}

function normalizeOptions(ns, options, defaults) {
    const normalized = { ...options };

    if (normalized.rootScript) {
        normalized.rootScript = normalizeScriptPath(normalized.rootScript);
    } else if (defaults.rootScript) {
        normalized.rootScript = defaults.rootScript;
    }

    const buyDefault = defaults.buyScript ? normalizeScriptPath(defaults.buyScript) : "";
    const buyCurrent = normalized.buyScript ? normalizeScriptPath(normalized.buyScript) : "";

    if (buyCurrent === "/buyserver.js" || buyCurrent === "/buy-max-servers.js") {
        normalized.buyScript = buyDefault;
    } else if (buyCurrent) {
        normalized.buyScript = buyCurrent;
    } else {
        normalized.buyScript = buyDefault;
    }

    if (buyDefault && !ns.fileExists(normalized.buyScript, "home") && ns.fileExists(buyDefault, "home")) {
        normalized.buyScript = buyDefault;
    }

    return normalized;
}

function normalizeScriptPath(script) {
    if (!script) return "";
    return script.startsWith("/") ? script : `/${script}`;
}
