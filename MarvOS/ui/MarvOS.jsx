import { loadOptions, saveOptions } from "/MarvOS/lib/options.js";
import { readStatus, STATUS_NAMES } from "/MarvOS/lib/status.js";
import { isScriptRunningOnHome, stopManagedRuntime } from "/MarvOS/lib/runtime.js";

const SCRIPTS = {
    orchestrator: "/MarvOS/orchestrator.js",
    load: "/MarvOS/load.js",
    startup: "/startup.js",
    formulas: "/formulas-batcher.js",
    xp: "/xp-grind.js",
    hacknet: "/hacknet-manager.js",
    share: "/rep-share.js",
    stock: "/stock-trader.js",
    backdoor: "/backdoor-targets.js",
};

const DEFAULT_OPTIONS = {
    rootScript: "/rootall.js",
    buyScript: "/buyservers.js",
    xpTarget: "",
    formulasDebug: false,
    homeReserve: 32,
    shareHome: false,
    sharePurchased: false,
    shareReserve: 32,
    helper: true,
    autoMode: false,
    selectedMode: "money",
    autoTor: true,
    autoTrade: false,
    buyMode: "passive",
    showScoreboard: false,
    showDiagnostics: false,
};

const REFRESH_PORT = 20;
const MODES = ["startup", "money", "xp", "rep"];

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(760, 520);
    ns.ui.setTailTitle("MarvOS Minimal");

    while (true) {
        const options = loadOptions(ns, DEFAULT_OPTIONS);
        const statuses = {
            orchestrator: readStatus(ns, STATUS_NAMES.orchestrator),
            formulas: readStatus(ns, STATUS_NAMES.formulas),
            startup: readStatus(ns, STATUS_NAMES.startup),
            xp: readStatus(ns, STATUS_NAMES.xp),
            hacknet: readStatus(ns, STATUS_NAMES.hacknet),
            stock: readStatus(ns, STATUS_NAMES.stock),
        };
        const snapshot = getSnapshot(ns);
        const theme = ns.ui.getTheme();

        ns.clearLog();
        ns.printRaw(renderApp(ns, theme, options, statuses, snapshot));
        await waitForRefresh(ns);
    }
}

function renderApp(ns, theme, options, statuses, snapshot) {
    const automationRunning = isScriptRunningOnHome(ns, SCRIPTS.orchestrator);
    const currentMode = statuses.orchestrator?.mode ?? (options.autoMode ? "auto" : options.selectedMode);

    return (
        <div style={rootStyle(theme)}>
            <div style={headerStyle(theme)}>
                <div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>MarvOS</div>
                    <div style={{ opacity: 0.76, marginTop: 4 }}>Minimal debug panel. Heavy UI disabled while backend is being stabilized.</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {renderBadge(theme, automationRunning ? "Automation Armed" : "Automation Off", automationRunning ? "active" : "off")}
                    {renderBadge(theme, options.autoMode ? "Auto" : "Manual", options.autoMode ? "active" : "neutral")}
                    {renderBadge(theme, `Mode ${labelMode(currentMode)}`, "neutral")}
                    {renderBadge(theme, snapshot.formulas ? "Formulas Ready" : "Formulas Missing", snapshot.formulas ? "active" : "off")}
                </div>
            </div>

            <div style={sectionStyle(theme)}>
                <div style={sectionTitleStyle}>Controls</div>
                <div style={buttonRowStyle}>
                    <button style={buttonStyle(theme)} onClick={() => toggleAutomation(ns)}>
                        {automationRunning ? "Stop Automation" : "Start Automation"}
                    </button>
                    <button style={buttonStyle(theme)} onClick={() => toggleAutoMode(ns, options)}>
                        {options.autoMode ? "Turn Auto Off" : "Turn Auto On"}
                    </button>
                    <button style={buttonStyle(theme)} onClick={() => stopManaged(ns)}>Stop Engines</button>
                    <button style={buttonStyle(theme)} onClick={() => runOnce(ns, SCRIPTS.load, [])}>Load OS</button>
                </div>
                <div style={buttonRowStyle}>
                    {MODES.map((mode) => (
                        <button key={mode} style={modeButtonStyle(theme, !options.autoMode && options.selectedMode === mode)} onClick={() => setManualMode(ns, options, mode)}>
                            {labelMode(mode)}
                        </button>
                    ))}
                </div>
                <div style={buttonRowStyle}>
                    <button style={buttonStyle(theme)} onClick={() => runRootScript(ns, options.rootScript)}>Run Rooter</button>
                    <button style={buttonStyle(theme)} onClick={() => runBuyScript(ns, options)}>Run Buyer</button>
                    <button style={buttonStyle(theme)} onClick={() => runStockTrader(ns, snapshot)}>Run Stocks</button>
                    <button style={buttonStyle(theme)} onClick={() => openControlledLogs(ns)}>Open Logs</button>
                </div>
            </div>

            <div style={sectionStyle(theme)}>
                <div style={sectionTitleStyle}>Snapshot</div>
                <div style={gridStyle(4)}>
                    {tile(theme, "Hack", String(snapshot.hacking))}
                    {tile(theme, "Money", ns.formatNumber(snapshot.money, 2))}
                    {tile(theme, "TOR", snapshot.tor ? "Online" : "Missing")}
                    {tile(theme, "Stocks", snapshot.stockLabel)}
                    {tile(theme, "Bought Servers", String(snapshot.purchasedServers))}
                    {tile(theme, "Root Script", options.rootScript)}
                    {tile(theme, "Buy Script", options.buyScript || "off")}
                    {tile(theme, "Buy Mode", labelBuyMode(options.buyMode))}
                </div>
            </div>

            <div style={sectionStyle(theme)}>
                <div style={sectionTitleStyle}>Engine Status</div>
                {renderStatus(theme, "Orchestrator", statuses.orchestrator, automationRunning ? "Waiting for status..." : "Automation is off")}
                {renderStatus(theme, "Money", statuses.formulas, isScriptRunningOnHome(ns, SCRIPTS.formulas) ? "Running" : "Stopped")}
                {renderStatus(theme, "Startup", statuses.startup, isScriptRunningOnHome(ns, SCRIPTS.startup) ? "Running" : "Stopped")}
                {renderStatus(theme, "XP", statuses.xp, isScriptRunningOnHome(ns, SCRIPTS.xp) ? "Running" : "Stopped")}
                {renderStatus(theme, "Stock Trader", statuses.stock, isScriptRunningOnHome(ns, SCRIPTS.stock) ? "Running" : stockReadinessText(snapshot))}
                {renderStatus(theme, "Hacknet", statuses.hacknet, isScriptRunningOnHome(ns, SCRIPTS.hacknet) ? "Running" : "Stopped")}
            </div>
        </div>
    );
}

function getSnapshot(ns) {
    const player = ns.getPlayer();
    const stock = getStockState(ns);
    return {
        hacking: ns.getHackingLevel(),
        money: ns.getServerMoneyAvailable("home"),
        tor: Boolean(player.tor) || Boolean(player.hasTorRouter),
        formulas: ns.fileExists("Formulas.exe", "home"),
        purchasedServers: ns.getPurchasedServers().length,
        stock,
        stockLabel: stock.level,
    };
}

function getStockState(ns) {
    const stock = ns.stock;
    if (!stock) {
        return { wse: false, tix: false, fourSigmaApi: false, level: "Locked" };
    }

    let wse = false;
    let tix = false;
    let fourSigmaApi = false;

    try { wse = stock.hasWSEAccount(); } catch {}
    try { tix = stock.hasTIXAPIAccess(); } catch {}
    try { fourSigmaApi = stock.has4SDataTIXAPI(); } catch {}

    let level = "Locked";
    if (wse && !tix) level = "Manual";
    if (wse && tix && !fourSigmaApi) level = "TIX";
    if (wse && tix && fourSigmaApi) level = "4S API";

    return { wse, tix, fourSigmaApi, level };
}

function renderStatus(theme, label, status, fallback) {
    const summary = status ? summarizeStatus(status) : fallback;
    return (
        <div style={statusRowStyle(theme)}>
            <div style={{ fontWeight: 700 }}>{label}</div>
            <div style={{ opacity: 0.82, flex: 1 }}>{summary}</div>
            <div style={{ opacity: 0.62, fontSize: 12 }}>{status?.updatedAt ? ageText(status.updatedAt) : "idle"}</div>
        </div>
    );
}

function summarizeStatus(status) {
    const parts = [];
    if (status.mode) parts.push(`mode=${status.mode}`);
    if (status.target) parts.push(`target=${status.target}`);
    if (status.action) parts.push(status.action);
    if (status.reason) parts.push(status.reason);
    if (status.moneyPct !== undefined) parts.push(`money ${Number(status.moneyPct).toFixed(1)}%`);
    if (status.secDiff !== undefined) parts.push(`sec +${Number(status.secDiff).toFixed(2)}`);
    if (Array.isArray(status.notes) && status.notes.length > 0) parts.push(status.notes.join(" | "));
    return parts.join(" | ") || "No status";
}

function toggleAutomation(ns) {
    if (isScriptRunningOnHome(ns, SCRIPTS.orchestrator)) {
        for (const proc of ns.ps("home")) {
            if (matchesScript(proc.filename, SCRIPTS.orchestrator)) {
                ns.kill(proc.pid);
            }
        }
        notify(ns, "Stopped automation");
    } else {
        ensureOrchestrator(ns);
    }
    triggerRefresh(ns);
}

function ensureOrchestrator(ns) {
    if (isScriptRunningOnHome(ns, SCRIPTS.orchestrator)) return;
    if (!ns.fileExists(SCRIPTS.orchestrator, "home")) {
        notify(ns, "Missing /MarvOS/orchestrator.js");
        return;
    }
    const pid = ns.exec(SCRIPTS.orchestrator, "home", 1);
    notify(ns, pid > 0 ? "Started automation" : "Failed to start automation");
}

function toggleAutoMode(ns, options) {
    options.autoMode = !options.autoMode;
    saveOptions(ns, options);
    notify(ns, `Auto mode ${options.autoMode ? "enabled" : "disabled"}`);
    triggerRefresh(ns);
}

function setManualMode(ns, options, mode) {
    options.autoMode = false;
    options.selectedMode = mode;
    saveOptions(ns, options);
    notify(ns, `Manual mode -> ${labelMode(mode)}`);
    triggerRefresh(ns);
}

function runOnce(ns, script, args) {
    const normalized = normalizeScriptPath(script);
    const pid = ns.exec(normalized, "home", 1, ...args);
    notify(ns, pid > 0 ? `Started ${normalized}` : `Failed to start ${normalized}`);
    triggerRefresh(ns);
}

function runRootScript(ns, rootScript) {
    const script = normalizeScriptPath(rootScript);
    if (!script || !ns.fileExists(script, "home")) {
        notify(ns, `Root script missing: ${script || "unset"}`);
        return;
    }
    const pid = ns.exec(script, "home", 1);
    notify(ns, pid > 0 ? `Started ${script}` : `Failed to start ${script}`);
    triggerRefresh(ns);
}

function runBuyScript(ns, options) {
    const script = normalizeScriptPath(options.buyScript);
    if (!script || !ns.fileExists(script, "home")) {
        notify(ns, `Buy script missing: ${script || "unset"}`);
        return;
    }
    const pid = ns.exec(script, "home", 1, ...buildBuyArgs(options.buyMode));
    notify(ns, pid > 0 ? `Started ${script}` : `Failed to start ${script}`);
    triggerRefresh(ns);
}

function runStockTrader(ns, snapshot) {
    if (!snapshot.stock.wse || !snapshot.stock.tix) {
        notify(ns, stockReadinessText(snapshot));
        return;
    }
    const pid = ns.exec(SCRIPTS.stock, "home", 1);
    notify(ns, pid > 0 ? "Started stock trader" : "Failed to start stock trader");
    triggerRefresh(ns);
}

function openControlledLogs(ns) {
    let opened = 0;
    for (const proc of ns.ps("home")) {
        if (Object.values(SCRIPTS).some((script) => matchesScript(proc.filename, script))) {
            ns.ui.openTail(proc.pid);
            opened += 1;
        }
    }
    notify(ns, opened > 0 ? `Opened ${opened} log${opened === 1 ? "" : "s"}` : "No managed logs to open");
}

function stopManaged(ns) {
    const stopped = stopManagedRuntime(ns);
    notify(ns, stopped > 0 ? `Stopped ${stopped} managed script${stopped === 1 ? "" : "s"}` : "No managed scripts were running");
    triggerRefresh(ns);
}

function buildBuyArgs(mode) {
    const args = ["--prefix", "MiniMarv-"];
    if (mode === "aggressive") {
        args.push("--budget-pct", "0.90", "--reserve", "50_000_000", "--interval", "12000", "--max-ops", "8");
    } else {
        args.push("--budget-pct", "0.25", "--reserve", "250_000_000", "--interval", "20000", "--max-ops", "1");
    }
    return args;
}

function normalizeScriptPath(script) {
    if (!script) return "";
    return script.startsWith("/") ? script : `/${script}`;
}

function matchesScript(actual, expected) {
    const normalized = normalizeScriptPath(expected);
    return actual === normalized || actual === normalized.slice(1);
}

function notify(ns, message) {
    ns.tprint(`[MarvOS] ${message}`);
}

function triggerRefresh(ns) {
    ns.tryWritePort(REFRESH_PORT, Date.now());
}

async function waitForRefresh(ns) {
    ns.clearPort(REFRESH_PORT);
    await Promise.race([
        ns.nextPortWrite(REFRESH_PORT),
        ns.asleep(8000),
    ]);
}

function stockReadinessText(snapshot) {
    if (!snapshot.stock.wse) return "Need WSE account";
    if (!snapshot.stock.tix) return "Need TIX API";
    return "Ready";
}

function ageText(updatedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
    if (seconds < 2) return "live";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m`;
}

function labelMode(mode) {
    switch (mode) {
        case "startup": return "Startup";
        case "money": return "Money";
        case "xp": return "XP";
        case "rep": return "Rep";
        case "auto": return "Auto";
        default: return "Money";
    }
}

function labelBuyMode(mode) {
    return mode === "aggressive" ? "Aggressive" : "Passive";
}

function renderBadge(theme, text, kind) {
    const color =
        kind === "active" ? theme.primary :
        kind === "off" ? theme.error :
        theme.secondary;
    return (
        <div style={{
            border: `1px solid ${color}`,
            color,
            padding: "4px 8px",
            fontSize: 12,
        }}>
            {text}
        </div>
    );
}

function tile(theme, label, value) {
    return (
        <div style={{
            border: `1px solid ${theme.primary}`,
            padding: "8px 10px",
            backgroundColor: "rgba(255,255,255,0.02)",
        }}>
            <div style={{ fontSize: 11, opacity: 0.68, textTransform: "uppercase" }}>{label}</div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>{value}</div>
        </div>
    );
}

function rootStyle(theme) {
    return {
        color: theme.primary,
        fontFamily: "monospace",
    };
}

function headerStyle(theme) {
    return {
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
        border: `1px solid ${theme.primary}`,
        padding: "12px 14px",
        marginBottom: 10,
        backgroundColor: "rgba(0,255,65,0.06)",
    };
}

function sectionStyle(theme) {
    return {
        border: `1px solid ${theme.primary}`,
        padding: "12px 14px",
        marginBottom: 10,
        backgroundColor: "rgba(255,255,255,0.02)",
    };
}

const sectionTitleStyle = {
    fontSize: 15,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: 10,
};

const buttonRowStyle = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 8,
};

function buttonStyle(theme) {
    return {
        border: `1px solid ${theme.primary}`,
        backgroundColor: "rgba(255,255,255,0.04)",
        color: theme.primary,
        padding: "6px 10px",
        cursor: "pointer",
    };
}

function modeButtonStyle(theme, active) {
    return {
        ...buttonStyle(theme),
        backgroundColor: active ? "rgba(0,255,65,0.14)" : "rgba(255,255,255,0.04)",
    };
}

function gridStyle(columns) {
    return {
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 8,
    };
}

function statusRowStyle(theme) {
    return {
        display: "flex",
        gap: 10,
        alignItems: "center",
        borderTop: `1px solid rgba(0,255,65,0.18)`,
        padding: "8px 0",
    };
}
