import { loadOptions, saveOptions } from "/MarvOS/lib/options.js";
import { readStatus, STATUS_NAMES } from "/MarvOS/lib/status.js";
import { getProgressSnapshot } from "/MarvOS/lib/progression.js";
import { rankMoneyTargets } from "/MarvOS/lib/scoring.js";

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
const ENGINE_SCRIPTS = [
    SCRIPTS.startup,
    SCRIPTS.formulas,
    SCRIPTS.xp,
    SCRIPTS.hacknet,
    SCRIPTS.share,
    SCRIPTS.stock,
];

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
    autoMode: true,
    selectedMode: "money",
    autoTor: true,
    autoTrade: false,
};

const REFRESH_PORT = 20;
const MODES = ["startup", "money", "xp", "rep"];

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(980, 760);
    ns.ui.setTailTitle("MarvOS");
    ensureOrchestrator(ns);

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
        const progress = getProgressSnapshot(ns);
        const topTargets = rankMoneyTargets(ns, { limit: 6 });
        const modeState = deriveModeState(options, statuses.orchestrator, progress);
        const theme = ns.ui.getTheme();

        ns.clearLog();
        ns.printRaw(renderHeader(theme, modeState));
        ns.printRaw(renderModeBar(ns, theme, options, modeState));
        ns.printRaw(renderOverview(ns, theme, progress, modeState));
        ns.printRaw(renderMainGrid(ns, theme, options, statuses, progress, modeState));
        ns.printRaw(renderBottomGrid(ns, theme, topTargets, progress));

        await waitForRefresh(ns);
    }
}

function renderHeader(theme, modeState) {
    return (
        <div style={heroStyle(theme)}>
            <div>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>MarvOS</div>
                <div style={{ opacity: 0.8, marginTop: 4 }}>Progression-first control plane for this run.</div>
            </div>
            <div style={{ textAlign: "right" }}>
                <div style={{ opacity: 0.7, fontSize: 12, textTransform: "uppercase" }}>Current Mode</div>
                <div style={{ marginTop: 4 }}>{renderBadge(theme, modeLabel(modeState.currentMode), "active")}</div>
                <div style={{ marginTop: 8, opacity: 0.8 }}>{modeState.reason}</div>
            </div>
        </div>
    );
}

function renderModeBar(ns, theme, options, modeState) {
    return (
        <div style={cardStyle(theme)}>
            <div style={cardHeaderStyle}>
                <div style={cardTitleStyle}>Mode Bar</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {renderBadge(theme, options.autoMode ? "Auto On" : "Manual", options.autoMode ? "active" : "off")}
                    <button style={secondaryButtonStyle(theme)} onClick={() => toggleAutoMode(ns, options)}>
                        {options.autoMode ? "Turn Auto Off" : "Turn Auto On"}
                    </button>
                </div>
            </div>
            <div style={{ opacity: 0.82, marginBottom: 10 }}>
                Click a mode to force it manually. With auto on, MarvOS switches between Startup, XP, and Money based on progression. Rep mode is a manual push mode.
            </div>
            <div style={modeBarStyle}>
                {MODES.map((mode) => (
                    <button
                        key={mode}
                        style={modeButtonStyle(theme, modeState.currentMode === mode, !options.autoMode && options.selectedMode === mode)}
                        onClick={() => setManualMode(ns, options, mode)}
                    >
                        <div style={{ fontWeight: 700 }}>{modeLabel(mode)}</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>{modeHint(mode)}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}

function renderOverview(ns, theme, progress, modeState) {
    return (
        <div style={compactGridStyle(6)}>
            {renderStatTile(theme, "Hack", String(progress.hacking))}
            {renderStatTile(theme, "Money", ns.formatNumber(progress.money, 2))}
            {renderStatTile(theme, "Factions", String(progress.factions.length))}
            {renderStatTile(theme, "TOR", progress.tor ? "Online" : "Missing")}
            {renderStatTile(theme, "Formulas", progress.formulas ? "Ready" : "Missing")}
            {renderStatTile(theme, "Openers", `${progress.portOpeners}/5`)}
            {renderStatTile(theme, "Stocks", stockLabel(progress.stock))}
            {renderStatTile(theme, "Auto Plan", modeLabel(progress.suggestedMode))}
            {renderStatTile(theme, "Requested", optionsLabel(modeState.requestedMode))}
            {renderStatTile(theme, "Hack Goal", progress.nextHackGoal ? String(progress.nextHackGoal) : "None")}
            {renderStatTile(theme, "BitRunners", milestoneLabel(progress, "BitRunners"))}
            {renderWideTile(theme, "Recommendation", progress.recommendation, 2)}
            {renderWideTile(theme, "Mode Reason", modeState.reason, 2)}
        </div>
    );
}

function renderMainGrid(ns, theme, options, statuses, progress, modeState) {
    return (
        <div style={twoColumnGridStyle}>
            <div style={cardStyle(theme)}>
                <div style={cardHeaderStyle}>
                    <div style={cardTitleStyle}>Operations</div>
                    {renderBadge(theme, modeLabel(modeState.currentMode), "active")}
                </div>
                <div style={miniSectionTitle}>Managed Engines</div>
                {renderEngineRow(theme, "Orchestrator", isScriptRunning(ns, SCRIPTS.orchestrator), "Controls mode switching")}
                {renderEngineRow(theme, "Money", isScriptRunning(ns, SCRIPTS.formulas), statuses.formulas?.target ?? "formulas-batcher")}
                {renderEngineRow(theme, "Startup", isScriptRunning(ns, SCRIPTS.startup), statuses.startup?.target ?? "startup")}
                {renderEngineRow(theme, "XP", isScriptRunning(ns, SCRIPTS.xp), options.xpTarget || "auto target")}
                {renderEngineRow(theme, "Rep", isScriptRunning(ns, SCRIPTS.share), "rep-share")}
                {renderEngineRow(theme, "Stocks", isScriptRunning(ns, SCRIPTS.stock), stockEngineLabel(progress.stock, options.autoTrade))}
                {renderEngineRow(theme, "Hacknet", isScriptRunning(ns, SCRIPTS.hacknet), statuses.hacknet?.action ?? "hacknet-manager")}

                <div style={miniSectionTitle}>Actions</div>
                <div style={buttonWrapStyle}>
                    <button style={secondaryButtonStyle(theme)} onClick={() => runOnce(ns, SCRIPTS.backdoor, [])}>Backdoor Next</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => runRootScript(ns, options.rootScript)}>Run Rooter</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => runBuyScript(ns, options.buyScript)}>Run Buyer</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => runOnce(ns, SCRIPTS.load, [])}>Load OS</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => openControlledLogs(ns)}>Open Logs</button>
                    <button style={dangerButtonStyle(theme)} onClick={() => stopManaged(ns)}>Stop Engines</button>
                </div>

                <div style={miniSectionTitle}>Config</div>
                <div style={buttonWrapStyle}>
                    <button style={secondaryButtonStyle(theme)} onClick={() => setXpTarget(ns, options)}>XP Target</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => setRootScript(ns, options)}>Root Script</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => setBuyScript(ns, options)}>Buy Script</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => setReserve(ns, options, "shareReserve", "Share reserve on home")}>Share Reserve</button>
                    <button style={secondaryButtonStyle(theme)} onClick={() => setReserve(ns, options, "homeReserve", "Home reserve for startup/xp")}>Home Reserve</button>
                </div>
                <div style={compactGridStyle(2)}>
                    {renderStatTile(theme, "XP Target", options.xpTarget || "auto")}
                    {renderStatTile(theme, "Root Script", options.rootScript)}
                    {renderStatTile(theme, "Buy Script", options.buyScript || "unset")}
                    {renderStatTile(theme, "Share Reserve", String(options.shareReserve))}
                    {renderStatTile(theme, "Home Reserve", String(options.homeReserve))}
                </div>

                <div style={miniSectionTitle}>Flags</div>
                {renderFlagRow(ns, theme, options, "autoTor", "Auto TOR", "Try to buy TOR automatically when Singularity access exists")}
                {renderFlagRow(ns, theme, options, "autoTrade", "Auto Trade", stockFlagDetail(progress.stock))}
                {renderFlagRow(ns, theme, options, "formulasDebug", "Formulas Debug", "Show target rejection detail in money logs")}
                {renderFlagRow(ns, theme, options, "shareHome", "Share Home", "Allow rep-share to consume spare home RAM")}
                {renderFlagRow(ns, theme, options, "sharePurchased", "Share Bought", "Allow rep-share to use purchased servers")}
                {renderFlagRow(ns, theme, options, "helper", "Helper Text", "Keep extra explanations visible")}
            </div>

            <div style={cardStyle(theme)}>
                <div style={cardHeaderStyle}>
                    <div style={cardTitleStyle}>Live Activity</div>
                    {renderBadge(theme, options.autoMode ? "Auto" : "Manual", options.autoMode ? "active" : "off")}
                </div>
                {renderStatusBlock(ns, theme, "Orchestrator", statuses.orchestrator, {
                    idleAction: "No orchestration status yet",
                    fallbackText: modeState.reason,
                })}
                {renderStatusBlock(ns, theme, "Money Engine", statuses.formulas, {
                    idleAction: "Idle",
                })}
                {renderStatusBlock(ns, theme, "Startup", statuses.startup, {
                    idleAction: "Idle",
                })}
                {renderStatusBlock(ns, theme, "XP Grind", statuses.xp, {
                    idleAction: "Idle",
                })}
                {renderStatusBlock(ns, theme, "Stock Trader", statuses.stock, {
                    idleAction: progress.stock.autoTradeReady ? "Idle" : stockFlagDetail(progress.stock),
                })}
                {renderStatusBlock(ns, theme, "Hacknet", statuses.hacknet, {
                    idleAction: "Idle",
                })}
            </div>
        </div>
    );
}

function renderBottomGrid(ns, theme, topTargets, progress) {
    return (
        <div style={twoColumnGridStyle}>
            <div style={cardStyle(theme)}>
                <div style={cardHeaderStyle}>
                    <div style={cardTitleStyle}>Target Scoreboard</div>
                    {renderBadge(theme, `${topTargets.length} ranked`, "neutral")}
                </div>
                {topTargets.length === 0
                    ? <div style={{ opacity: 0.8 }}>No valid ranked targets.</div>
                    : topTargets.map((row) => (
                        <div key={row.host} style={tableRowStyle(theme)}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700 }}>{row.host}</div>
                                <div style={{ opacity: 0.76, marginTop: 2 }}>
                                    req={row.requiredHack} | chance={(row.chance * 100).toFixed(1)}% | hack={Math.round(row.hackTime / 1000)}s
                                </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <div>{Math.floor(row.score)}</div>
                                <div style={{ opacity: 0.76, marginTop: 2 }}>{ns.formatNumber(row.maxMoney, 2)}</div>
                            </div>
                        </div>
                    ))}
            </div>

            <div style={cardStyle(theme)}>
                <div style={cardHeaderStyle}>
                    <div style={cardTitleStyle}>Progression</div>
                    {renderBadge(theme, `${progress.factions.length} factions`, "neutral")}
                </div>
                {progress.milestones.map((m) => (
                    <div key={m.name} style={tableRowStyle(theme)}>
                        <div>
                            <div style={{ fontWeight: 700 }}>{m.name}</div>
                            <div style={{ opacity: 0.76, marginTop: 2 }}>{m.faction}</div>
                        </div>
                        <div style={{ textAlign: "right", opacity: 0.9 }}>
                            <div>req={m.requiredHack ?? "?"}</div>
                            <div style={{ marginTop: 2 }}>
                                rooted={yesNo(m.rooted)} | backdoor={yesNo(m.backdoored)} | joined={yesNo(m.joined)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function renderEngineRow(theme, label, running, detail) {
    return (
        <div style={rowStyle(theme)}>
            <div>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ opacity: 0.78, marginTop: 2 }}>{detail}</div>
            </div>
            {renderBadge(theme, running ? "Running" : "Stopped", running ? "active" : "off")}
        </div>
    );
}

function renderFlagRow(ns, theme, options, key, label, detail) {
    return (
        <div style={rowStyle(theme)}>
            <div>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ opacity: 0.78, marginTop: 2 }}>{detail}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {renderBadge(theme, options[key] ? "On" : "Off", options[key] ? "active" : "off")}
                <button style={secondaryButtonStyle(theme)} onClick={() => toggleOption(ns, options, key)}>Toggle</button>
            </div>
        </div>
    );
}

function renderStatusBlock(ns, theme, title, status, options = {}) {
    if (!status) {
        return (
            <div style={statusCardStyle(theme)}>
                <div style={{ fontWeight: 700 }}>{title}</div>
                <div style={{ opacity: 0.8, marginTop: 4 }}>{options.idleAction ?? "Idle"}</div>
                {options.fallbackText ? <div style={{ marginTop: 4, opacity: 0.72 }}>{options.fallbackText}</div> : null}
            </div>
        );
    }

    const lines = [];
    if (status.target) lines.push(`target=${status.target}`);
    if (status.action) lines.push(status.action);
    if (status.mode) lines.push(`mode=${status.mode}`);
    if (status.reason) lines.push(status.reason);
    if (status.moneyPct !== undefined) lines.push(`money ${Number(status.moneyPct).toFixed(1)}%`);
    if (status.secDiff !== undefined) lines.push(`sec +${Number(status.secDiff).toFixed(2)}`);
    if (status.freeRam !== undefined) lines.push(`RAM ${ns.formatRam(status.freeRam, 2)}`);
    if (status.nextHackGoal) lines.push(`goal ${status.nextHackGoal}`);

    return (
        <div style={statusCardStyle(theme)}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{title}</div>
                {renderBadge(theme, ageText(status.updatedAt), "neutral")}
            </div>
            <div style={{ marginTop: 6, opacity: 0.9 }}>{lines.join(" | ") || (options.idleAction ?? "Idle")}</div>
            {status.recommendation ? <div style={{ marginTop: 6, opacity: 0.74 }}>{status.recommendation}</div> : null}
        </div>
    );
}

function renderStatTile(theme, label, value) {
    return (
        <div key={label} style={statTileStyle(theme)}>
            <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.7 }}>{label}</div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>{value}</div>
        </div>
    );
}

function renderWideTile(theme, label, value, span = 2) {
    return (
        <div key={label} style={{ ...statTileStyle(theme), gridColumn: `span ${span}` }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.7 }}>{label}</div>
            <div style={{ marginTop: 6 }}>{value}</div>
        </div>
    );
}

function deriveModeState(options, orchestratorStatus, progress) {
    if (orchestratorStatus) {
        return {
            currentMode: orchestratorStatus.mode ?? progress.suggestedMode ?? "money",
            requestedMode: orchestratorStatus.requestedMode ?? (options.autoMode ? "auto" : options.selectedMode),
            reason: orchestratorStatus.reason ?? progress.suggestionReason ?? progress.recommendation,
        };
    }

    return {
        currentMode: options.autoMode ? progress.suggestedMode : options.selectedMode,
        requestedMode: options.autoMode ? "auto" : options.selectedMode,
        reason: progress.suggestionReason ?? progress.recommendation,
    };
}

function milestoneLabel(progress, faction) {
    const row = progress.milestones.find((item) => item.faction === faction);
    if (!row) return "Unknown";
    if (row.joined) return "Joined";
    if (row.backdoored) return "Ready";
    return "Pending";
}

function stockLabel(stock) {
    switch (stock.level) {
        case "4s": return "4S API";
        case "pre-4s": return "TIX";
        case "manual": return "Manual";
        default: return "Locked";
    }
}

function stockEngineLabel(stock, autoTrade) {
    if (!stock.wse) return "need WSE account";
    if (!stock.tix) return "need TIX API";
    return autoTrade ? `auto ${stockLabel(stock)}` : `${stockLabel(stock)} ready`;
}

function stockFlagDetail(stock) {
    if (!stock.wse) return "Locked: buy WSE account first";
    if (!stock.tix) return "Locked: buy TIX API access for scripts";
    if (!stock.fourSigmaApi) return "Enabled trader uses momentum until 4S TIX API is bought";
    return "Enabled trader uses 4S forecast data";
}

function ageText(updatedAt) {
    if (!updatedAt) return "stale";
    const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
    if (seconds < 2) return "live";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
}

function modeLabel(mode) {
    switch (mode) {
        case "startup": return "Startup";
        case "money": return "Money";
        case "xp": return "XP";
        case "rep": return "Rep";
        case "auto": return "Auto";
        default: return "Money";
    }
}

function modeHint(mode) {
    switch (mode) {
        case "startup": return "Early root + growth";
        case "money": return "Formulas batcher";
        case "xp": return "Hack XP push";
        case "rep": return "Money + share";
        default: return "";
    }
}

function optionsLabel(mode) {
    return mode === "auto" ? "Auto" : modeLabel(mode);
}

function yesNo(value) {
    return value ? "yes" : "no";
}

function isScriptRunning(ns, script) {
    return ns.ps("home").some((proc) => matchesScript(proc.filename, script));
}

function setManualMode(ns, options, mode) {
    options.autoMode = false;
    options.selectedMode = mode;
    saveOptions(ns, options);
    ensureOrchestrator(ns);
    notify(ns, `MarvOS manual mode -> ${modeLabel(mode)}`);
    triggerRefresh(ns);
}

function toggleAutoMode(ns, options) {
    options.autoMode = !options.autoMode;
    saveOptions(ns, options);
    if (options.autoMode) ensureOrchestrator(ns);
    notify(ns, `MarvOS auto mode ${options.autoMode ? "enabled" : "disabled"}`);
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
    if (!script) {
        notify(ns, "No root script configured");
        return;
    }
    if (!ns.fileExists(script, "home")) {
        notify(ns, `Root script missing: ${script}`);
        return;
    }
    const pid = ns.exec(script, "home", 1);
    notify(ns, pid > 0 ? `Started ${script}` : `Failed to start ${script}`);
    triggerRefresh(ns);
}

function runBuyScript(ns, buyScript) {
    const script = normalizeScriptPath(buyScript);
    if (!script) {
        notify(ns, "No buy script configured");
        return;
    }
    if (!ns.fileExists(script, "home")) {
        notify(ns, `Buy script missing: ${script}`);
        return;
    }
    const pid = ns.exec(script, "home", 1);
    notify(ns, pid > 0 ? `Started ${script}` : `Failed to start ${script}`);
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
    notify(ns, opened > 0 ? `Opened ${opened} managed log${opened === 1 ? "" : "s"}` : "No managed scripts are running");
}

function stopManaged(ns) {
    let stopped = 0;
    for (const proc of ns.ps("home")) {
        if (ENGINE_SCRIPTS.some((script) => matchesScript(proc.filename, script))) {
            ns.kill(proc.pid);
            stopped += 1;
        }
    }
    notify(ns, stopped > 0 ? `Stopped ${stopped} engine script${stopped === 1 ? "" : "s"}` : "No engine scripts were running");
    triggerRefresh(ns);
}

function ensureOrchestrator(ns) {
    if (isScriptRunning(ns, SCRIPTS.orchestrator)) return;
    if (!ns.fileExists(SCRIPTS.orchestrator, "home")) return;
    const pid = ns.exec(SCRIPTS.orchestrator, "home", 1);
    if (pid > 0) notify(ns, "Started /MarvOS/orchestrator.js");
}

async function setXpTarget(ns, options) {
    const result = await ns.prompt("XP target hostname. Leave empty for auto.", { type: "text" });
    if (result === false) return;
    options.xpTarget = String(result || "").trim();
    saveOptions(ns, options);
    notify(ns, `XP target set to ${options.xpTarget || "auto"}`);
    triggerRefresh(ns);
}

async function setRootScript(ns, options) {
    const result = await ns.prompt("Root script filename on home.", { type: "text" });
    if (result === false) return;
    options.rootScript = normalizeScriptPath(String(result || "").trim() || DEFAULT_OPTIONS.rootScript);
    saveOptions(ns, options);
    notify(ns, `Root script set to ${options.rootScript}`);
    triggerRefresh(ns);
}

async function setBuyScript(ns, options) {
    const result = await ns.prompt("Purchased-server script filename on home. Leave empty to disable.", { type: "text" });
    if (result === false) return;
    const value = String(result || "").trim();
    options.buyScript = value ? normalizeScriptPath(value) : "";
    saveOptions(ns, options);
    notify(ns, options.buyScript ? `Buy script set to ${options.buyScript}` : "Buy script disabled");
    triggerRefresh(ns);
}

async function setReserve(ns, options, key, label) {
    const result = await ns.prompt(label, { type: "text" });
    if (result === false) return;
    const numeric = Math.max(0, Math.floor(Number(result)));
    if (!Number.isFinite(numeric)) return;
    options[key] = numeric;
    saveOptions(ns, options);
    notify(ns, `${label}: ${numeric}`);
    triggerRefresh(ns);
}

function toggleOption(ns, options, key) {
    if (key === "autoTrade") {
        const progress = getProgressSnapshot(ns);
        if (!progress.stock.autoTradeReady && !options.autoTrade) {
            notify(ns, stockFlagDetail(progress.stock));
            return;
        }
    }
    options[key] = !options[key];
    saveOptions(ns, options);
    notify(ns, `${optionLabel(key)} ${options[key] ? "enabled" : "disabled"}`);
    triggerRefresh(ns);
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

function optionLabel(key) {
    switch (key) {
        case "autoTor": return "Auto TOR";
        case "autoTrade": return "Auto Trade";
        case "formulasDebug": return "Formulas Debug";
        case "shareHome": return "Share Home";
        case "sharePurchased": return "Share Bought";
        case "helper": return "Helper Text";
        default: return key;
    }
}

function triggerRefresh(ns) {
    ns.tryWritePort(REFRESH_PORT, Date.now());
}

async function waitForRefresh(ns) {
    ns.clearPort(REFRESH_PORT);
    await Promise.race([
        ns.nextPortWrite(REFRESH_PORT),
        ns.asleep(3000),
    ]);
}

function heroStyle(theme) {
    return {
        display: "flex",
        justifyContent: "space-between",
        gap: 14,
        alignItems: "center",
        padding: "14px 16px",
        marginBottom: 10,
        border: `1px solid ${theme.primary}`,
        background: "linear-gradient(180deg, rgba(0,255,65,0.08), rgba(255,255,255,0.02))",
    };
}

function cardStyle(theme) {
    return {
        border: `1px solid ${theme.primary}`,
        backgroundColor: "rgba(255,255,255,0.03)",
        padding: "12px 14px",
        marginBottom: 10,
    };
}

const cardHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    marginBottom: 10,
};

const cardTitleStyle = {
    fontSize: 16,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
};

function compactGridStyle(columns) {
    return {
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 8,
        marginBottom: 10,
    };
}

const twoColumnGridStyle = {
    display: "grid",
    gridTemplateColumns: "1.15fr 1fr",
    gap: 10,
    marginBottom: 10,
};

const modeBarStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 8,
};

const buttonWrapStyle = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
};

const miniSectionTitle = {
    fontSize: 12,
    textTransform: "uppercase",
    opacity: 0.72,
    marginTop: 12,
    marginBottom: 6,
};

function rowStyle(theme) {
    return {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px",
        border: `1px solid rgba(0,255,65,0.25)`,
        backgroundColor: "rgba(255,255,255,0.02)",
        marginBottom: 6,
    };
}

function tableRowStyle(theme) {
    return {
        ...rowStyle(theme),
        alignItems: "flex-start",
    };
}

function statTileStyle(theme) {
    return {
        border: `1px solid rgba(0,255,65,0.25)`,
        backgroundColor: "rgba(255,255,255,0.02)",
        padding: "10px 12px",
        minWidth: 0,
    };
}

function statusCardStyle(theme) {
    return {
        border: `1px solid rgba(0,255,65,0.25)`,
        backgroundColor: "rgba(255,255,255,0.02)",
        padding: "10px 12px",
        marginBottom: 8,
    };
}

function secondaryButtonStyle(theme) {
    return {
        backgroundColor: "rgba(255,255,255,0.04)",
        color: theme.primary,
        border: `1px solid rgba(0,255,65,0.45)`,
        padding: "7px 11px",
        cursor: "pointer",
    };
}

function dangerButtonStyle(theme) {
    return {
        backgroundColor: "rgba(255,77,77,0.12)",
        color: theme.error,
        border: `1px solid ${theme.error}`,
        padding: "7px 11px",
        cursor: "pointer",
    };
}

function modeButtonStyle(theme, isCurrent, isSelected) {
    return {
        backgroundColor: isCurrent
            ? "rgba(0,255,65,0.14)"
            : isSelected
                ? "rgba(255,255,255,0.07)"
                : "rgba(255,255,255,0.03)",
        color: isCurrent ? theme.primary : theme.primary,
        border: `1px solid ${isCurrent ? theme.primary : "rgba(0,255,65,0.35)"}`,
        padding: "10px 12px",
        textAlign: "left",
        cursor: "pointer",
    };
}

function renderBadge(theme, text, tone) {
    const palette = tone === "active"
        ? { color: theme.primary, background: "rgba(0,255,65,0.14)", border: theme.primary }
        : tone === "off"
            ? { color: theme.error, background: "rgba(255,77,77,0.12)", border: theme.error }
            : { color: theme.primary, background: "rgba(255,255,255,0.04)", border: "rgba(0,255,65,0.35)" };

    return (
        <span
            style={{
                display: "inline-block",
                padding: "4px 10px",
                minWidth: 74,
                textAlign: "center",
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.background,
                color: palette.color,
            }}
        >
            {text}
        </span>
    );
}
