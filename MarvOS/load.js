export const DEFAULT_BUNDLE_SOURCE = "https://raw.githubusercontent.com/saudkw/MarvOS/main/MarvOS.bundle.txt";
const MARVOS_SOURCE_PATH = "/MarvOS/data/source.txt";
const TEMP_PATH = "/MarvOS/data/load-bundle.txt";
const RESTART_SCRIPTS = [
    "/MarvOS/ui/MarvOS.jsx",
    "/MarvOSBeta/ui/MarvOSBeta.jsx",
    "/MarvOS/orchestrator.js",
    "/MarvOS/Loader.js",
    "/MarvOSBeta/Loader.js",
];

/** @param {NS} ns */
export async function main(ns) {
    const sourceArg = String(ns.args[0] ?? "").trim();
    const source = sourceArg || getBundleSource(ns);

    stopRunningMarvOS(ns);
    await ns.sleep(50);

    ns.rm(TEMP_PATH, "home");
    const ok = await ns.wget(source, TEMP_PATH, "home");
    if (!ok) {
        ns.tprint(`[MarvOS] Failed to download bundle: ${source}`);
        return;
    }

    let bundle;
    try {
        bundle = JSON.parse(ns.read(TEMP_PATH));
    } catch {
        const preview = ns.read(TEMP_PATH).slice(0, 120);
        ns.tprint("[MarvOS] Bundle download was not valid JSON");
        ns.tprint(preview);
        return;
    }

    if (!Array.isArray(bundle) || bundle.length === 0) {
        ns.tprint("[MarvOS] Bundle was empty or invalid");
        return;
    }

    let written = 0;
    for (const file of bundle) {
        const path = normalizePath(file.path ?? file.filename ?? "");
        if (!path) continue;
        const contents = extractContents(file);
        if (typeof contents !== "string") continue;
        ns.write(path, contents, "w");
        written += 1;
    }

    if (written === 0) {
        ns.tprint("[MarvOS] Bundle contained no writable files");
        return;
    }

    if (sourceArg) {
        ns.write(MARVOS_SOURCE_PATH, source, "w");
    }

    ns.tprint(`[MarvOS] Loaded ${written} files from bundle`);
    ns.spawn("/MarvOS/Loader.js", 1);
}

export function getBundleSource(ns) {
    const saved = loadSavedSource(ns);
    return saved || DEFAULT_BUNDLE_SOURCE;
}

function loadSavedSource(ns) {
    if (!ns.fileExists(MARVOS_SOURCE_PATH, "home")) return "";
    return String(ns.read(MARVOS_SOURCE_PATH) ?? "").trim();
}

function normalizePath(path) {
    if (!path) return "";
    return String(path).replace(/^\/+/, "");
}

function extractContents(file) {
    if (typeof file.contents === "string") return file.contents;
    if (typeof file.file === "string") {
        try {
            return JSON.parse(file.file);
        } catch {
            return "";
        }
    }
    return "";
}

function stopRunningMarvOS(ns) {
    const processes = ns.ps("home");
    for (const script of RESTART_SCRIPTS) {
        const normalized = script.startsWith("/") ? script.slice(1) : script;
        for (const proc of processes) {
            if (proc.filename === script || proc.filename === normalized) {
                ns.kill(proc.pid);
            }
        }
    }
}
