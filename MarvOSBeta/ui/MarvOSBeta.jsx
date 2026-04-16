import { loadOptions, saveOptions } from "/MarvOS/lib/options.js";
import { MARVOS_SOURCE_PATH, readStatus, STATUS_NAMES } from "/MarvOS/lib/status.js";
import { getProgressSnapshot } from "/MarvOS/lib/progression.js";
import { rankMoneyTargets } from "/MarvOS/lib/scoring.js";

const SCRIPTS = {
    orchestrator: "/MarvOS/orchestrator.js",
    classic: "/MarvOS/ui/MarvOS.jsx",
    beta: "/MarvOSBeta/ui/MarvOSBeta.jsx",
    betaLoader: "/MarvOSBeta/Loader.js",
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
    buyMode: "passive",
};

const MODES = ["startup", "money", "xp", "rep"];
const DEFAULT_BUNDLE_SOURCE = "https://raw.githubusercontent.com/saudkw/MarvOS/main/MarvOS.bundle.txt";

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(1260, 900);
    ns.ui.setTailTitle("MarvOS Beta");
    ensureOrchestrator(ns);

    const React = getReactLib();
    if (!React) {
        ns.printRaw(<div>React runtime unavailable in this Bitburner session.</div>);
        await new Promise(() => {});
        return;
    }

    ns.printRaw(<BetaApp ns={ns} React={React} />);
    await new Promise(() => {});
}

function BetaApp({ ns, React }) {
    const [snapshot, setSnapshot] = React.useState(() => buildSnapshot(ns));
    const [actionText, setActionText] = React.useState("System online.");

    const refresh = async () => {
        setSnapshot(buildSnapshot(ns));
    };

    const runAction = async (label, action) => {
        setActionText(label);
        await action();
        await refresh();
    };

    React.useEffect(() => {
        let cancelled = false;
        let timer;

        const tick = async () => {
            if (cancelled) return;
            setSnapshot(buildSnapshot(ns));
            if (!cancelled) timer = setTimeout(tick, 1500);
        };

        tick();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [ns]);

    React.useEffect(() => {
        if (!actionText) return;
        const timer = setTimeout(() => setActionText(""), 5000);
        return () => clearTimeout(timer);
    }, [actionText]);

    const { theme, options, statuses, progress, targets, modeState, network, diagnostics, install } = snapshot;
    const palette = getPalette(theme);
    const modeTone = modeToneFor(modeState.currentMode);
    const topTargets = targets.slice(0, 5);

    return (
        <div style={shellStyle(palette)}>
            <div style={atmosphereStyle(palette)} />

            <div style={heroStyle(palette)}>
                <div style={heroLeftStyle}>
                    <div style={eyebrowStyle(palette)}>Bitburner Command Surface</div>
                    <div style={heroTitleStyle}>MarvOS Beta</div>
                    <div style={heroSubtitleStyle}>
                        React-style operator shell on top of the MarvOS automation stack.
                    </div>

                    <div style={heroStatStripStyle}>
                        {renderHeroMetric(palette, "Hack", String(progress.hacking))}
                        {renderHeroMetric(palette, "Cash", ns.formatNumber(progress.money, 2))}
                        {renderHeroMetric(palette, "Mode", modeLabel(modeState.currentMode))}
                        {renderHeroMetric(palette, "Buyer", buyModeLabel(options.buyMode))}
                    </div>
                </div>

                <div style={heroRightStyle}>
                    <div style={statusTicketStyle(palette)}>
                        <div style={ticketLabelStyle}>System Intent</div>
                        <div style={ticketValueStyle}>{progress.recommendation}</div>
                        <div style={ticketMetaStyle}>{modeState.reason}</div>
                    </div>

                    <div style={statusTicketStyle(palette, modeTone)}>
                        <div style={ticketLabelStyle}>Operator Pulse</div>
                        <div style={ticketValueStyle}>{actionText || "Awaiting command."}</div>
                        <div style={ticketMetaStyle}>
                            Target {diagnostics.currentTarget || "none"} | Stocks {stockLabel(progress.stock)}
                        </div>
                    </div>
                </div>
            </div>

            <div style={ribbonStyle}>
                {renderRibbonChip(palette, `Target ${diagnostics.currentTarget || "none"}`, diagnostics.currentTarget ? "primary" : "neutral")}
                {renderRibbonChip(palette, `Top ${diagnostics.topCandidate || "none"}`, diagnostics.topCandidate ? "primary" : "neutral")}
                {renderRibbonChip(palette, `Buyer ${buyModeLabel(options.buyMode)}`, options.buyMode === "aggressive" ? "warn" : "primary")}
                {renderRibbonChip(palette, `Stocks ${stockLabel(progress.stock)}`, progress.stock.autoTradeReady ? "primary" : "neutral")}
                {renderRibbonChip(palette, `TOR ${progress.tor ? "online" : "missing"}`, progress.tor ? "primary" : "neutral")}
                {renderRibbonChip(palette, `Formulas ${progress.formulas ? "ready" : "missing"}`, progress.formulas ? "primary" : "warn")}
                {renderRibbonChip(palette, `BitRunners ${milestoneLabel(progress, "BitRunners")}`, milestoneLabel(progress, "BitRunners") === "Joined" ? "primary" : "neutral")}
            </div>

            <div style={dashboardGridStyle}>
                <div style={leftRailStyle}>
                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Control Rail</div>
                                <div style={panelTitleStyle}>Modes</div>
                            </div>
                            {renderInlineBadge(palette, options.autoMode ? "Auto" : "Manual", options.autoMode ? "primary" : "warn")}
                        </div>

                        <div style={modeGridStyle}>
                            {MODES.map((mode) => (
                                <button
                                    key={mode}
                                    style={modeCardStyle(palette, modeState.currentMode === mode, !options.autoMode && options.selectedMode === mode, mode)}
                                    onClick={() => runAction(`Manual mode -> ${modeLabel(mode)}`, () => setManualMode(ns, options, mode))}
                                >
                                    <div style={modeCardNameStyle}>{modeLabel(mode)}</div>
                                    <div style={modeCardHintStyle}>{modeHint(mode)}</div>
                                </button>
                            ))}
                        </div>

                        <div style={toggleRowStyle}>
                            <button
                                style={toggleButtonStyle(palette, options.autoMode)}
                                onClick={() => runAction(options.autoMode ? "Auto mode disabled" : "Auto mode enabled", () => toggleAutoMode(ns, options))}
                            >
                                {options.autoMode ? "Disable Auto" : "Enable Auto"}
                            </button>
                            <button
                                style={toggleButtonStyle(palette, options.buyMode === "aggressive", true)}
                                onClick={() => runAction(`Buyer -> ${options.buyMode === "aggressive" ? "Passive" : "Aggressive"}`, () => toggleBuyMode(ns, options))}
                            >
                                Buyer {buyModeLabel(options.buyMode)}
                            </button>
                        </div>
                    </section>

                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Command Deck</div>
                                <div style={panelTitleStyle}>Launch / Stop</div>
                            </div>
                        </div>

                        <div style={buttonGridStyle}>
                            <button style={commandButtonStyle(palette)} onClick={() => runAction("Rooter launch requested", () => runRootScript(ns, options.rootScript))}>Run Rooter</button>
                            <button style={commandButtonStyle(palette)} onClick={() => runAction(`Buyer launch requested (${buyModeLabel(options.buyMode)})`, () => runBuyScript(ns, options))}>Run Buyer</button>
                            <button style={commandButtonStyle(palette)} onClick={() => runAction("Backdoor chain requested", () => runOnce(ns, SCRIPTS.backdoor, []))}>Backdoor Next</button>
                            <button style={commandButtonStyle(palette)} onClick={() => runAction("OS load requested", () => runOnce(ns, SCRIPTS.load, []))}>Load OS</button>
                            <button style={commandButtonStyle(palette)} onClick={() => openControlledLogs(ns)}>Open Logs</button>
                            <button style={dangerButtonStyle(palette)} onClick={() => runAction("Engine shutdown requested", () => stopManaged(ns))}>Stop Engines</button>
                        </div>
                    </section>

                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Operator Settings</div>
                                <div style={panelTitleStyle}>Paths / Flags</div>
                            </div>
                        </div>

                        <div style={settingsButtonGridStyle}>
                            <button style={miniButtonStyle(palette)} onClick={() => runAction("XP target prompt opened", () => setXpTarget(ns, options))}>XP Target</button>
                            <button style={miniButtonStyle(palette)} onClick={() => runAction("Root script prompt opened", () => setRootScript(ns, options))}>Root Script</button>
                            <button style={miniButtonStyle(palette)} onClick={() => runAction("Buy script prompt opened", () => setBuyScript(ns, options))}>Buy Script</button>
                            <button style={miniButtonStyle(palette)} onClick={() => runAction("Bundle source prompt opened", () => setBundleSource(ns))}>Bundle Source</button>
                        </div>

                        <div style={settingsReadoutStyle}>
                            {renderKeyValue(palette, "XP Target", options.xpTarget || "auto")}
                            {renderKeyValue(palette, "Root Script", options.rootScript)}
                            {renderKeyValue(palette, "Buy Script", options.buyScript || "disabled")}
                            {renderKeyValue(palette, "Share Reserve", String(options.shareReserve))}
                            {renderKeyValue(palette, "Home Reserve", String(options.homeReserve))}
                        </div>

                        <div style={flagStackStyle}>
                            {renderFlagToggle(palette, "Auto TOR", options.autoTor, () => runAction(`Auto TOR ${!options.autoTor ? "enabled" : "disabled"}`, () => toggleOption(ns, options, "autoTor")))}
                            {renderFlagToggle(palette, "Auto Trade", options.autoTrade, () => runAction(`Auto Trade ${!options.autoTrade ? "enabled" : "disabled"}`, () => toggleOption(ns, options, "autoTrade")))}
                            {renderFlagToggle(palette, "Formulas Debug", options.formulasDebug, () => runAction(`Formulas Debug ${!options.formulasDebug ? "enabled" : "disabled"}`, () => toggleOption(ns, options, "formulasDebug")))}
                            {renderFlagToggle(palette, "Share Home", options.shareHome, () => runAction(`Share Home ${!options.shareHome ? "enabled" : "disabled"}`, () => toggleOption(ns, options, "shareHome")))}
                            {renderFlagToggle(palette, "Share Bought", options.sharePurchased, () => runAction(`Share Bought ${!options.sharePurchased ? "enabled" : "disabled"}`, () => toggleOption(ns, options, "sharePurchased")))}
                        </div>
                    </section>
                </div>

                <div style={centerStageStyle}>
                    <section style={panelStyle(palette, "hero")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Money Engine</div>
                                <div style={panelTitleStyle}>Focus Target</div>
                            </div>
                            {renderInlineBadge(palette, diagnostics.state, diagnostics.state === "Batching" ? "primary" : diagnostics.state === "Prepping" ? "warn" : "neutral")}
                        </div>

                        <div style={targetHeroGridStyle}>
                            <div>
                                <div style={targetNameStyle}>{diagnostics.currentTarget || diagnostics.topCandidate || "No target locked"}</div>
                                <div style={targetCaptionStyle}>
                                    {statuses.formulas?.action || "No live formulas action yet"} | {modeState.reason}
                                </div>

                                <div style={targetMeterStackStyle}>
                                    {renderMeter(palette, "Money state", diagnostics.moneyPctValue, diagnostics.money, "#3ecf8e")}
                                    {renderMeter(palette, "Hack chance", diagnostics.chanceValue, diagnostics.chance, "#60a5fa")}
                                    {renderMeter(palette, "Security pressure", invertRatio(diagnostics.secDiffValue, 25), diagnostics.security, "#f59e0b")}
                                </div>
                            </div>

                            <div style={targetDataWallStyle}>
                                {renderDataTile(palette, "Hack %", diagnostics.hackPct)}
                                {renderDataTile(palette, "Interval", diagnostics.interval)}
                                {renderDataTile(palette, "Top candidate", diagnostics.topCandidate || "none")}
                                {renderDataTile(palette, "Mode", modeLabel(modeState.currentMode))}
                                {renderDataTile(palette, "Stocks", stockFlagDetail(progress.stock))}
                                {renderDataTile(palette, "Buyer", buyModeLabel(options.buyMode))}
                            </div>
                        </div>
                    </section>

                    <section style={panelStyle(palette, "glass")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Automation Matrix</div>
                                <div style={panelTitleStyle}>Active Systems</div>
                            </div>
                        </div>

                        <div style={engineGridStyle}>
                            {renderEngineCard(palette, "Orchestrator", statuses.orchestrator, modeState.reason)}
                            {renderEngineCard(palette, "Money", statuses.formulas, diagnostics.state)}
                            {renderEngineCard(palette, "XP", statuses.xp, options.xpTarget || "auto target")}
                            {renderEngineCard(palette, "Hacknet", statuses.hacknet, "idle")}
                            {renderEngineCard(palette, "Stocks", statuses.stock, stockFlagDetail(progress.stock))}
                            {renderEngineCard(palette, "Rep Share", isScriptRunning(ns, SCRIPTS.share) ? { action: "active", updatedAt: Date.now() } : null, "off")}
                        </div>
                    </section>

                    <section style={panelStyle(palette, "glass")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Target Board</div>
                                <div style={panelTitleStyle}>Candidate Rankings</div>
                            </div>
                            {renderInlineBadge(palette, `${topTargets.length} visible`, "neutral")}
                        </div>

                        <div style={targetBoardStyle}>
                            {topTargets.length === 0
                                ? <div style={emptyStateStyle}>No ranked targets available.</div>
                                : topTargets.map((row, index) => (
                                    <div key={row.host} style={targetRowStyle(palette, index === 0)}>
                                        <div style={targetRowMainStyle}>
                                            <div style={targetRowRankStyle}>{index + 1}</div>
                                            <div>
                                                <div style={targetRowHostStyle}>{row.host}</div>
                                                <div style={targetRowMetaStyle}>
                                                    req={row.requiredHack} | chance={(row.chance * 100).toFixed(1)}% | hack={Math.round(row.hackTime / 1000)}s
                                                </div>
                                            </div>
                                        </div>
                                        <div style={targetRowScoreStyle}>
                                            <div>{Math.floor(row.score)}</div>
                                            <div style={targetRowMoneyStyle}>{ns.formatNumber(row.maxMoney, 2)}</div>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </section>
                </div>

                <div style={rightRailStyle}>
                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Resource Picture</div>
                                <div style={panelTitleStyle}>Network</div>
                            </div>
                        </div>

                        <div style={metricBandStyle}>
                            {renderCompactMetric(palette, "Workers", `${network.activeWorkers}/${network.totalWorkers}`)}
                            {renderCompactMetric(palette, "Usable", ns.formatRam(network.totalUsableRam, 2))}
                            {renderCompactMetric(palette, "Free", ns.formatRam(network.freeRam, 2))}
                        </div>

                        <div style={networkMeterGroupStyle}>
                            {renderNetworkMeter(palette, "Money RAM", network.moneyRam, network.totalUsableRam, "#3ecf8e")}
                            {renderNetworkMeter(palette, "Share RAM", network.shareRam, network.totalUsableRam, "#f59e0b")}
                            {renderNetworkMeter(palette, "Other RAM", network.otherRam, network.totalUsableRam, "#60a5fa")}
                            {renderNetworkMeter(palette, "Free RAM", network.freeRam, network.totalUsableRam, "#94a3b8")}
                        </div>
                    </section>

                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Diagnosis Feed</div>
                                <div style={panelTitleStyle}>Formulas Notes</div>
                            </div>
                        </div>

                        <div style={debugFeedStyle}>
                            {options.formulasDebug && diagnostics.debug.length > 0
                                ? diagnostics.debug.map((line, index) => (
                                    <div key={`${index}:${line}`} style={debugLineStyle}>
                                        {line}
                                    </div>
                                ))
                                : <div style={emptyStateStyle}>Enable Formulas Debug to surface rejection reasoning here.</div>}
                        </div>
                    </section>

                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Progress Ladder</div>
                                <div style={panelTitleStyle}>Milestones</div>
                            </div>
                        </div>

                        <div style={progressStackStyle}>
                            {progress.milestones.map((m) => (
                                <div key={m.name} style={progressRowStyle(palette)}>
                                    <div>
                                        <div style={progressNameStyle}>{m.name}</div>
                                        <div style={progressFactionStyle}>{m.faction}</div>
                                    </div>
                                    <div style={progressMetaStyle}>
                                        <div>req={m.requiredHack ?? "?"}</div>
                                        <div style={progressPillRowStyle}>
                                            {renderInlineBadge(palette, `root ${yesNo(m.rooted)}`, m.rooted ? "primary" : "neutral")}
                                            {renderInlineBadge(palette, `door ${yesNo(m.backdoored)}`, m.backdoored ? "primary" : "neutral")}
                                            {renderInlineBadge(palette, `join ${yesNo(m.joined)}`, m.joined ? "primary" : "neutral")}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section style={panelStyle(palette, "solid")}>
                        <div style={panelHeaderStyle}>
                            <div>
                                <div style={panelKickerStyle}>Install / Update</div>
                                <div style={panelTitleStyle}>One Command Flow</div>
                            </div>
                        </div>

                        <div style={codePanelStyle}>
                            <div style={codeLabelStyle}>First install</div>
                            <div style={codeLineStyle}>wget {install.loaderUrl} MarvOS/load.js</div>
                            <div style={codeLineStyle}>run MarvOS/load.js</div>
                            <div style={codeLabelStyle}>Update</div>
                            <div style={codeLineStyle}>run MarvOS/load.js</div>
                            <div style={codeLabelStyle}>Classic / Beta</div>
                            <div style={codeLineStyle}>run MarvOS/Loader.js</div>
                            <div style={codeLineStyle}>run MarvOSBeta/Loader.js</div>
                            <div style={codeLabelStyle}>Bundle source</div>
                            <div style={codeLineStyle}>{install.source}</div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

function buildSnapshot(ns) {
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
    const targets = rankMoneyTargets(ns, { limit: 8 });
    const modeState = deriveModeState(options, statuses.orchestrator, progress);
    const network = getNetworkSummary(ns);
    const diagnostics = getTargetDiagnostics(statuses.formulas, targets);
    const install = getInstallState(ns);
    const theme = ns.ui.getTheme();

    return {
        options,
        statuses,
        progress,
        targets,
        modeState,
        network,
        diagnostics,
        install,
        theme,
    };
}

function getReactLib() {
    return globalThis["React"] ?? globalThis["window"]?.React;
}

function getNetworkSummary(ns) {
    const purchased = new Set(ns.getPurchasedServers());
    const hosts = discoverHosts(ns, purchased);
    let totalWorkers = 0;
    let activeWorkers = 0;
    let totalUsableRam = 0;
    let freeRam = 0;
    let moneyRam = 0;
    let shareRam = 0;
    let otherRam = 0;

    for (const host of hosts) {
        if (!ns.hasRootAccess(host)) continue;
        const maxRam = ns.getServerMaxRam(host);
        if (maxRam <= 0) continue;
        const reserve = host === "home" ? 32 : 0;
        const usable = Math.max(0, maxRam - reserve);
        if (usable <= 0) continue;

        totalWorkers += 1;
        totalUsableRam += usable;
        freeRam += Math.max(0, usable - ns.getServerUsedRam(host));

        let hostActive = false;
        for (const proc of ns.ps(host)) {
            const ram = proc.threads * ns.getScriptRam(proc.filename, host);
            if (["hack.js", "grow.js", "weaken.js", "formulas-batcher.js", "startup.js", "xp-grind.js"].includes(proc.filename)) {
                moneyRam += ram;
                hostActive = true;
            } else if (proc.filename === "share-worker.js" || proc.filename === "rep-share.js") {
                shareRam += ram;
                hostActive = true;
            } else {
                otherRam += ram;
            }
        }

        if (hostActive) activeWorkers += 1;
    }

    return { totalWorkers, activeWorkers, totalUsableRam, freeRam, moneyRam, shareRam, otherRam };
}

function getTargetDiagnostics(formulasStatus, targets) {
    const batchPlan = formulasStatus?.batchPlan ?? null;
    const moneyPctValue = formulasStatus?.moneyPct !== undefined ? Number(formulasStatus.moneyPct) : null;
    const chanceValue = formulasStatus?.chance !== undefined ? Number(formulasStatus.chance) : null;
    const secDiffValue = formulasStatus?.secDiff !== undefined ? Number(formulasStatus.secDiff) : null;
    const hackPctValue = batchPlan?.hackPct !== undefined ? Number(batchPlan.hackPct) : null;

    return {
        currentTarget: formulasStatus?.target ?? "",
        topCandidate: targets[0]?.host ?? "",
        state: inferTargetState(formulasStatus),
        action: formulasStatus?.action ?? "idle",
        chance: chanceValue !== null ? `${(chanceValue * 100).toFixed(1)}%` : "n/a",
        money: moneyPctValue !== null ? `${moneyPctValue.toFixed(1)}%` : "n/a",
        security: secDiffValue !== null ? `+${secDiffValue.toFixed(2)}` : "n/a",
        hackPct: hackPctValue !== null ? `${(hackPctValue * 100).toFixed(2)}%` : "n/a",
        interval: batchPlan?.launchInterval !== undefined ? `${Math.round(Number(batchPlan.launchInterval))}ms` : "n/a",
        debug: Array.isArray(formulasStatus?.debug) ? formulasStatus.debug.slice(0, 10) : [],
        moneyPctValue,
        chanceValue,
        secDiffValue,
        hackPctValue,
    };
}

function inferTargetState(formulasStatus) {
    const batchType = String(formulasStatus?.batchPlan?.type ?? "").toLowerCase();
    const action = String(formulasStatus?.action ?? "").toLowerCase();
    if (!action) return "Idle";
    if (action.includes("prep")) return "Prepping";
    if (action.includes("waiting for ram") || action.includes("countdown")) return "Waiting";
    if (action.includes("hwgw") || action.includes("hgw") || action.includes("hybrid")) return "Batching";
    if (batchType === "hwgw" || batchType === "hgw" || batchType === "hybrid") return "Batching";
    if (action.includes("waiting")) return "Waiting";
    return "Active";
}

function getInstallState(ns) {
    const source = readSource(ns);
    return {
        source: source || DEFAULT_BUNDLE_SOURCE,
        sourceLabel: source ? "custom" : "default repo",
        hasSavedSource: Boolean(source),
        loaderUrl: "https://raw.githubusercontent.com/saudkw/MarvOS/main/MarvOS/load.js",
    };
}

function readSource(ns) {
    if (!ns.fileExists(MARVOS_SOURCE_PATH, "home")) return "";
    return String(ns.read(MARVOS_SOURCE_PATH) ?? "").trim();
}

function discoverHosts(ns, purchased = new Set(ns.getPurchasedServers())) {
    const seen = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }
    for (const host of purchased) seen.add(host);
    return seen;
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

function getPalette(theme) {
    return {
        primary: theme?.primary ?? "#00ff41",
        warning: "#f59e0b",
        danger: "#ef4444",
        cyan: "#60a5fa",
        text: theme?.primary ?? "#e5ffe8",
        surface: "rgba(9, 16, 16, 0.86)",
        surfaceStrong: "rgba(13, 22, 24, 0.94)",
        border: "rgba(82, 255, 126, 0.22)",
        borderStrong: "rgba(82, 255, 126, 0.42)",
        ink: "#031108",
        muted: "rgba(224, 255, 230, 0.68)",
    };
}

function renderHeroMetric(palette, label, value) {
    return (
        <div style={heroMetricStyle(palette)}>
            <div style={microLabelStyle(palette)}>{label}</div>
            <div style={heroMetricValueStyle}>{value}</div>
        </div>
    );
}

function renderRibbonChip(palette, text, tone) {
    return <div style={ribbonChipStyle(palette, tone)}>{text}</div>;
}

function renderInlineBadge(palette, text, tone) {
    return <span style={inlineBadgeStyle(palette, tone)}>{text}</span>;
}

function renderMeter(palette, label, value, display, fill) {
    const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value * 100));
    return (
        <div style={meterWrapStyle}>
            <div style={meterLabelRowStyle}>
                <span>{label}</span>
                <span>{display}</span>
            </div>
            <div style={meterTrackStyle}>
                <div style={{ ...meterFillStyle(fill), width: `${pct}%` }} />
            </div>
        </div>
    );
}

function renderDataTile(palette, label, value) {
    return (
        <div style={dataTileStyle(palette)}>
            <div style={microLabelStyle(palette)}>{label}</div>
            <div style={dataTileValueStyle}>{value}</div>
        </div>
    );
}

function renderEngineCard(palette, title, status, fallback) {
    const detail = [];
    if (status?.target) detail.push(status.target);
    if (status?.action) detail.push(status.action);
    if (status?.moneyPct !== undefined) detail.push(`money ${Number(status.moneyPct).toFixed(1)}%`);
    if (status?.secDiff !== undefined) detail.push(`sec +${Number(status.secDiff).toFixed(2)}`);
    const state = detail.join(" | ") || fallback;

    return (
        <div style={engineCardStyle(palette)}>
            <div style={engineCardHeaderStyle}>
                <div style={engineCardTitleStyle}>{title}</div>
                {renderInlineBadge(palette, status ? "live" : "idle", status ? "primary" : "neutral")}
            </div>
            <div style={engineCardBodyStyle}>{state}</div>
        </div>
    );
}

function renderCompactMetric(palette, label, value) {
    return (
        <div style={compactMetricStyle(palette)}>
            <div style={microLabelStyle(palette)}>{label}</div>
            <div style={compactMetricValueStyle}>{value}</div>
        </div>
    );
}

function renderNetworkMeter(palette, label, value, total, fill) {
    return (
        <div style={networkMeterStyle}>
            <div style={meterLabelRowStyle}>
                <span>{label}</span>
                <span>{formatRamBrief(value)}</span>
            </div>
            <div style={meterTrackStyle}>
                <div style={{ ...meterFillStyle(fill), width: `${Math.max(0, Math.min(100, safeRatio(value, total) * 100))}%` }} />
            </div>
        </div>
    );
}

function renderKeyValue(palette, label, value) {
    return (
        <div style={keyValueRowStyle}>
            <span style={microLabelStyle(palette)}>{label}</span>
            <span style={keyValueValueStyle}>{value}</span>
        </div>
    );
}

function renderFlagToggle(palette, label, enabled, onClick) {
    return (
        <button style={flagRowStyle(palette, enabled)} onClick={onClick}>
            <span>{label}</span>
            {renderInlineBadge(palette, enabled ? "on" : "off", enabled ? "primary" : "neutral")}
        </button>
    );
}

function safeRatio(value, total) {
    return total > 0 ? value / total : 0;
}

function invertRatio(value, cap) {
    if (value === null || value === undefined) return 0;
    return 1 - Math.max(0, Math.min(1, value / cap));
}

function formatRamBrief(value) {
    if (value >= 1024) return `${(value / 1024).toFixed(1)} TB`;
    return `${value.toFixed(1)} GB`;
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

function stockFlagDetail(stock) {
    if (!stock.wse) return "Need WSE account";
    if (!stock.tix) return "Need TIX API";
    if (!stock.fourSigmaApi) return "Momentum mode until 4S TIX API";
    return "4S API active";
}

function modeLabel(mode) {
    switch (mode) {
        case "startup": return "Startup";
        case "money": return "Money";
        case "xp": return "XP";
        case "rep": return "Rep";
        default: return "Money";
    }
}

function modeHint(mode) {
    switch (mode) {
        case "startup": return "Bootstrap the run";
        case "money": return "Distributed batching";
        case "xp": return "Force hack level";
        case "rep": return "Money plus share";
        default: return "";
    }
}

function modeToneFor(mode) {
    switch (mode) {
        case "startup": return "warn";
        case "xp": return "info";
        case "rep": return "primary";
        default: return "primary";
    }
}

function yesNo(value) {
    return value ? "yes" : "no";
}

function buyModeLabel(mode) {
    return mode === "aggressive" ? "Aggressive" : "Passive";
}

function isScriptRunning(ns, script) {
    return ns.ps("home").some((proc) => matchesScript(proc.filename, script));
}

function setManualMode(ns, options, mode) {
    options.autoMode = false;
    options.selectedMode = mode;
    saveOptions(ns, options);
    ensureOrchestrator(ns);
    notify(ns, `MarvOS Beta manual mode -> ${modeLabel(mode)}`);
}

function toggleAutoMode(ns, options) {
    options.autoMode = !options.autoMode;
    saveOptions(ns, options);
    if (options.autoMode) ensureOrchestrator(ns);
    notify(ns, `MarvOS Beta auto mode ${options.autoMode ? "enabled" : "disabled"}`);
}

function runOnce(ns, script, args) {
    const normalized = normalizeScriptPath(script);
    const pid = ns.exec(normalized, "home", 1, ...args);
    notify(ns, pid > 0 ? `Started ${normalized}` : `Failed to start ${normalized}`);
}

function runRootScript(ns, rootScript) {
    const script = normalizeScriptPath(rootScript);
    if (!script || !ns.fileExists(script, "home")) {
        notify(ns, `Root script missing: ${script || "unset"}`);
        return;
    }
    const pid = ns.exec(script, "home", 1);
    notify(ns, pid > 0 ? `Started ${script}` : `Failed to start ${script}`);
}

function runBuyScript(ns, options) {
    const script = normalizeScriptPath(options.buyScript);
    if (!script || !ns.fileExists(script, "home")) {
        notify(ns, `Buy script missing: ${script || "unset"}`);
        return;
    }
    const pid = ns.exec(script, "home", 1, ...buildBuyArgs(options.buyMode));
    notify(ns, pid > 0 ? `Started ${script} (${buyModeLabel(options.buyMode)})` : `Failed to start ${script}`);
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
    for (const proc of ns.ps("home")) {
        if (ENGINE_SCRIPTS.some((script) => matchesScript(proc.filename, script))) {
            ns.kill(proc.pid);
        }
    }
    notify(ns, "Stopped engine scripts");
}

function ensureOrchestrator(ns) {
    if (isScriptRunning(ns, SCRIPTS.orchestrator)) return;
    if (!ns.fileExists(SCRIPTS.orchestrator, "home")) return;
    ns.exec(SCRIPTS.orchestrator, "home", 1);
}

async function setXpTarget(ns, options) {
    const result = await ns.prompt("XP target hostname. Leave empty for auto.", { type: "text" });
    if (result === false) return;
    options.xpTarget = String(result || "").trim();
    saveOptions(ns, options);
    notify(ns, `XP target set to ${options.xpTarget || "auto"}`);
}

async function setRootScript(ns, options) {
    const result = await ns.prompt("Root script filename on home.", { type: "text" });
    if (result === false) return;
    options.rootScript = normalizeScriptPath(String(result || "").trim() || DEFAULT_OPTIONS.rootScript);
    saveOptions(ns, options);
    notify(ns, `Root script set to ${options.rootScript}`);
}

async function setBuyScript(ns, options) {
    const result = await ns.prompt("Purchased-server script filename on home. Leave empty to disable.", { type: "text" });
    if (result === false) return;
    const value = String(result || "").trim();
    options.buyScript = value ? normalizeScriptPath(value) : "";
    saveOptions(ns, options);
    notify(ns, options.buyScript ? `Buy script set to ${options.buyScript}` : "Buy script disabled");
}

async function setBundleSource(ns) {
    const current = readSource(ns) || DEFAULT_BUNDLE_SOURCE;
    const result = await ns.prompt(`Bundle source URL.\nCurrent: ${current}`, { type: "text" });
    if (result === false) return;
    const value = String(result || "").trim();
    if (!value) return;
    ns.write(MARVOS_SOURCE_PATH, value, "w");
    notify(ns, "Bundle source updated");
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
    notify(ns, `${key} ${options[key] ? "enabled" : "disabled"}`);
}

function toggleBuyMode(ns, options) {
    options.buyMode = options.buyMode === "aggressive" ? "passive" : "aggressive";
    saveOptions(ns, options);
    notify(ns, `Buy mode -> ${buyModeLabel(options.buyMode)}`);
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
    ns.tprint(`[MarvOS Beta] ${message}`);
}

const shellStyle = (palette) => ({
    position: "relative",
    padding: 18,
    color: palette.text,
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, rgba(82,255,126,0.10), transparent 28%), linear-gradient(180deg, #041109 0%, #050d14 55%, #071019 100%)",
    overflow: "hidden",
});

const atmosphereStyle = (palette) => ({
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: "linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.06) 48%, transparent 100%)",
    opacity: 0.9,
});

const heroStyle = (palette) => ({
    position: "relative",
    zIndex: 1,
    display: "grid",
    gridTemplateColumns: "1.35fr 0.95fr",
    gap: 16,
    padding: "22px 24px",
    borderRadius: 24,
    border: `1px solid ${palette.borderStrong}`,
    background: "linear-gradient(135deg, rgba(8,22,17,0.92), rgba(11,20,28,0.88))",
    boxShadow: "0 28px 70px rgba(0,0,0,0.35)",
    marginBottom: 14,
});

const heroLeftStyle = {
    minWidth: 0,
};

const heroRightStyle = {
    display: "grid",
    gap: 12,
};

const heroTitleStyle = {
    fontSize: 42,
    fontWeight: 900,
    letterSpacing: 0.8,
    lineHeight: 1,
    marginTop: 6,
};

const heroSubtitleStyle = {
    maxWidth: 620,
    opacity: 0.78,
    fontSize: 15,
    marginTop: 10,
    lineHeight: 1.45,
};

const heroStatStripStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
    marginTop: 18,
};

const heroMetricStyle = (palette) => ({
    padding: "12px 14px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${palette.border}`,
    minWidth: 0,
});

const heroMetricValueStyle = {
    marginTop: 6,
    fontSize: 18,
    fontWeight: 800,
};

const statusTicketStyle = (palette, tone = "primary") => ({
    padding: "14px 16px",
    borderRadius: 16,
    border: `1px solid ${tone === "warn" ? palette.warning : tone === "info" ? palette.cyan : palette.borderStrong}`,
    background: tone === "warn"
        ? "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.03))"
        : tone === "info"
            ? "linear-gradient(135deg, rgba(96,165,250,0.12), rgba(96,165,250,0.03))"
            : "linear-gradient(135deg, rgba(82,255,126,0.10), rgba(82,255,126,0.03))",
});

const ticketLabelStyle = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    opacity: 0.65,
};

const ticketValueStyle = {
    marginTop: 8,
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.3,
};

const ticketMetaStyle = {
    marginTop: 8,
    opacity: 0.72,
    lineHeight: 1.4,
};

const ribbonStyle = {
    position: "relative",
    zIndex: 1,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
};

const ribbonChipStyle = (palette, tone) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${tone === "warn" ? palette.warning : tone === "neutral" ? "rgba(255,255,255,0.12)" : palette.borderStrong}`,
    background: tone === "warn"
        ? "rgba(245,158,11,0.11)"
        : tone === "neutral"
            ? "rgba(255,255,255,0.04)"
            : "rgba(82,255,126,0.10)",
    fontSize: 12,
    fontWeight: 700,
});

const dashboardGridStyle = {
    position: "relative",
    zIndex: 1,
    display: "grid",
    gridTemplateColumns: "0.96fr 1.35fr 0.94fr",
    gap: 14,
    alignItems: "start",
};

const leftRailStyle = {
    display: "grid",
    gap: 14,
};

const centerStageStyle = {
    display: "grid",
    gap: 14,
};

const rightRailStyle = {
    display: "grid",
    gap: 14,
};

const panelStyle = (palette, tone) => ({
    borderRadius: 22,
    padding: 16,
    border: `1px solid ${tone === "hero" ? palette.borderStrong : palette.border}`,
    background: tone === "hero"
        ? "linear-gradient(160deg, rgba(82,255,126,0.08), rgba(96,165,250,0.08) 55%, rgba(255,255,255,0.02))"
        : tone === "glass"
            ? "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))"
            : palette.surface,
    boxShadow: tone === "hero" ? "0 18px 36px rgba(0,0,0,0.24)" : "0 8px 24px rgba(0,0,0,0.18)",
    minWidth: 0,
});

const panelHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    marginBottom: 14,
};

const panelKickerStyle = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    opacity: 0.62,
};

const panelTitleStyle = {
    fontSize: 22,
    fontWeight: 850,
    lineHeight: 1.1,
    marginTop: 4,
};

const inlineBadgeStyle = (palette, tone) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${tone === "warn" ? palette.warning : tone === "neutral" ? "rgba(255,255,255,0.12)" : palette.borderStrong}`,
    background: tone === "warn"
        ? "rgba(245,158,11,0.10)"
        : tone === "neutral"
            ? "rgba(255,255,255,0.04)"
            : "rgba(82,255,126,0.10)",
    fontSize: 12,
    fontWeight: 700,
});

const modeGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
};

const modeCardStyle = (palette, current, selected, mode) => {
    const tone = mode === "startup" ? palette.warning : mode === "xp" ? palette.cyan : palette.primary;
    return {
        borderRadius: 18,
        padding: "14px 14px 16px",
        border: `1px solid ${current ? tone : selected ? palette.borderStrong : "rgba(255,255,255,0.12)"}`,
        background: current
            ? `linear-gradient(135deg, ${hexToRgba(tone, 0.16)}, ${hexToRgba(tone, 0.04)})`
            : selected
                ? "rgba(255,255,255,0.05)"
                : "rgba(255,255,255,0.03)",
        color: palette.text,
        textAlign: "left",
        cursor: "pointer",
        minHeight: 88,
    };
};

const modeCardNameStyle = {
    fontSize: 17,
    fontWeight: 800,
};

const modeCardHintStyle = {
    marginTop: 6,
    opacity: 0.72,
    fontSize: 13,
    lineHeight: 1.35,
};

const toggleRowStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginTop: 12,
};

const toggleButtonStyle = (palette, enabled, accent) => ({
    borderRadius: 14,
    padding: "12px 14px",
    border: `1px solid ${enabled ? (accent ? palette.warning : palette.borderStrong) : "rgba(255,255,255,0.12)"}`,
    background: enabled
        ? accent ? "rgba(245,158,11,0.10)" : "rgba(82,255,126,0.10)"
        : "rgba(255,255,255,0.03)",
    color: palette.text,
    fontWeight: 800,
    cursor: "pointer",
});

const buttonGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
};

const commandButtonStyle = (palette) => ({
    borderRadius: 14,
    padding: "12px 14px",
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.04)",
    color: palette.text,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
});

const dangerButtonStyle = (palette) => ({
    borderRadius: 14,
    padding: "12px 14px",
    border: `1px solid ${palette.danger}`,
    background: "rgba(239,68,68,0.12)",
    color: "#ff8d8d",
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
});

const settingsButtonGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
};

const miniButtonStyle = (palette) => ({
    borderRadius: 12,
    padding: "10px 12px",
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.03)",
    color: palette.text,
    cursor: "pointer",
    textAlign: "left",
});

const settingsReadoutStyle = {
    display: "grid",
    gap: 8,
    marginTop: 12,
};

const keyValueRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
};

const keyValueValueStyle = {
    textAlign: "right",
    fontWeight: 700,
    maxWidth: "58%",
    overflowWrap: "anywhere",
};

const flagStackStyle = {
    display: "grid",
    gap: 8,
    marginTop: 14,
};

const flagRowStyle = (palette, enabled) => ({
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    borderRadius: 12,
    padding: "10px 12px",
    border: `1px solid ${enabled ? palette.borderStrong : "rgba(255,255,255,0.10)"}`,
    background: enabled ? "rgba(82,255,126,0.08)" : "rgba(255,255,255,0.03)",
    color: palette.text,
    cursor: "pointer",
});

const targetHeroGridStyle = {
    display: "grid",
    gridTemplateColumns: "1.15fr 0.95fr",
    gap: 14,
    alignItems: "start",
};

const targetNameStyle = {
    fontSize: 30,
    fontWeight: 900,
    lineHeight: 1.05,
};

const targetCaptionStyle = {
    marginTop: 8,
    opacity: 0.76,
    lineHeight: 1.45,
};

const targetMeterStackStyle = {
    display: "grid",
    gap: 12,
    marginTop: 18,
};

const meterWrapStyle = {
    display: "grid",
    gap: 6,
};

const meterLabelRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    fontSize: 12,
    opacity: 0.82,
};

const meterTrackStyle = {
    width: "100%",
    height: 11,
    borderRadius: 999,
    background: "rgba(255,255,255,0.07)",
    overflow: "hidden",
};

const meterFillStyle = (fill) => ({
    height: "100%",
    borderRadius: 999,
    background: fill,
});

const targetDataWallStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
};

const dataTileStyle = (palette) => ({
    borderRadius: 14,
    padding: "12px 14px",
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.04)",
});

const dataTileValueStyle = {
    marginTop: 8,
    fontSize: 16,
    fontWeight: 800,
    lineHeight: 1.25,
};

const engineGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
};

const engineCardStyle = (palette) => ({
    borderRadius: 16,
    padding: "12px 14px",
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.03)",
});

const engineCardHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
};

const engineCardTitleStyle = {
    fontWeight: 800,
};

const engineCardBodyStyle = {
    marginTop: 8,
    opacity: 0.78,
    lineHeight: 1.4,
    minHeight: 38,
};

const targetBoardStyle = {
    display: "grid",
    gap: 8,
};

const targetRowStyle = (palette, lead) => ({
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    borderRadius: 16,
    padding: "12px 14px",
    border: `1px solid ${lead ? palette.borderStrong : palette.border}`,
    background: lead ? "linear-gradient(135deg, rgba(82,255,126,0.08), rgba(96,165,250,0.05))" : "rgba(255,255,255,0.03)",
});

const targetRowMainStyle = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
};

const targetRowRankStyle = {
    width: 28,
    height: 28,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.08)",
    fontWeight: 800,
};

const targetRowHostStyle = {
    fontWeight: 800,
};

const targetRowMetaStyle = {
    marginTop: 4,
    opacity: 0.72,
    fontSize: 12,
};

const targetRowScoreStyle = {
    textAlign: "right",
    fontWeight: 800,
};

const targetRowMoneyStyle = {
    marginTop: 4,
    opacity: 0.72,
    fontSize: 12,
};

const metricBandStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 14,
};

const compactMetricStyle = (palette) => ({
    borderRadius: 14,
    padding: "10px 12px",
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.03)",
});

const compactMetricValueStyle = {
    marginTop: 6,
    fontWeight: 800,
};

const networkMeterGroupStyle = {
    display: "grid",
    gap: 12,
};

const networkMeterStyle = {
    display: "grid",
    gap: 6,
};

const debugFeedStyle = {
    display: "grid",
    gap: 8,
    maxHeight: 260,
    overflow: "hidden",
};

const debugLineStyle = {
    borderRadius: 12,
    padding: "9px 11px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    overflowWrap: "anywhere",
    lineHeight: 1.35,
};

const emptyStateStyle = {
    opacity: 0.68,
    lineHeight: 1.45,
};

const progressStackStyle = {
    display: "grid",
    gap: 8,
};

const progressRowStyle = (palette) => ({
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    borderRadius: 14,
    padding: "11px 12px",
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.03)",
});

const progressNameStyle = {
    fontWeight: 800,
};

const progressFactionStyle = {
    marginTop: 4,
    opacity: 0.72,
};

const progressMetaStyle = {
    textAlign: "right",
    opacity: 0.82,
    fontSize: 12,
};

const progressPillRowStyle = {
    display: "flex",
    gap: 6,
    justifyContent: "flex-end",
    flexWrap: "wrap",
    marginTop: 6,
};

const codePanelStyle = {
    display: "grid",
    gap: 8,
};

const codeLabelStyle = {
    marginTop: 4,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    opacity: 0.64,
};

const codeLineStyle = {
    borderRadius: 12,
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    overflowWrap: "anywhere",
};

const eyebrowStyle = (palette) => ({
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.95,
    opacity: 0.68,
    color: palette.muted,
});

const microLabelStyle = (palette) => ({
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.85,
    opacity: 0.62,
    color: palette.muted,
});

function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    if (value.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
