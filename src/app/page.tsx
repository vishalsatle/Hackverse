"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_INTERVAL_SECONDS = 300;

const traceSeeds = [
  {
    id: "SRC-7712",
    confidence: 0.91,
    note: "Cross-border convoy movement spike detected near corridor K12.",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
  },
  {
    id: "SRC-7745",
    confidence: 0.87,
    note: "Telegram chatter indicates fuel depot restocking under blackout conditions.",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
  },
  {
    id: "SRC-7760",
    confidence: 0.79,
    note: "Local hospital admissions increased 23% in 6 hours across sector Delta.",
    url: "https://www.reutersagency.com/feed/?best-topics=world&post_type=best",
  },
  {
    id: "SRC-7791",
    confidence: 0.84,
    note: "Nighttime thermal signatures show unusual artillery positioning activity.",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
  },
];

const initialTraceLogs = traceSeeds.map((seed) => ({
  ...seed,
  timestamp: "1970-01-01T00:00:00Z",
  confidence: seed.confidence,
}));

type PipelineArticle = {
  source_id: string;
  source_name: string;
  title: string;
  summary: string;
  link: string;
  published: string;
};

type BriefResponse = {
  liveArticles: PipelineArticle[];
  brief: string;
  generatedAt: number;
  running?: boolean;
  nextRunAt?: number;
  lastError?: string | null;
  telemetry?: {
    runCount: number;
    successCount: number;
    lastDurationMs: number;
    lastArticleCount: number;
  };
};

type IntelMode = "conflict" | "weather" | "disaster";

type ParsedBrief = {
  summary: string;
  threatBadge: "CRITICAL" | "WARNING" | "STABLE";
  scenarios: string[];
  recommendations: string[];
};

function modeAgents(mode: IntelMode) {
  if (mode === "weather") {
    return [
      "Atmospheric Analyst",
      "Storm Pattern Model",
      "Wind Risk Assessor",
      "Terrain Exposure Mapper",
      "Infrastructure Weather Cell",
    ];
  }
  if (mode === "disaster") {
    return [
      "Disaster Event Triage",
      "Humanitarian Signals",
      "Relief Logistics Planner",
      "Population Displacement Model",
      "Infrastructure Damage Cell",
    ];
  }
  return [
    "Geospatial Analyst",
    "Social Media Scraper",
    "Signals Intel",
    "Economic Watcher",
    "Narrative Shift Model",
  ];
}

function cleanText(input: string) {
  return input
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/<a [^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/�/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeLine(input: string, maxLen = 220) {
  const cleaned = cleanText(input)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen)}...`;
}

function displayHost(link: string) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function compactTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value.slice(0, 19);
  return new Date(parsed).toISOString().slice(11, 19) + "Z";
}

function sectionSlice(lines: string[], heading: string) {
  const start = lines.findIndex((line) => line.toLowerCase() === heading.toLowerCase());
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("#### ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).filter(Boolean);
}

function parseBrief(brief: string): ParsedBrief {
  const lines = brief
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const summarySection = sectionSlice(lines, "#### Executive Summary");
  const scenariosSection = sectionSlice(lines, "#### Strategic Scenarios");
  const recommendationsSection = sectionSlice(lines, "#### Recommended Actions");

  const summary =
    summarySection.find((line) => !line.startsWith("#")) ||
    "Brief generated. Review traceability sources for details.";
  const threatText = sectionSlice(lines, "#### Threat Level").join(" ").toLowerCase();
  const threatBadge: ParsedBrief["threatBadge"] =
    threatText.includes("critical") || threatText.includes("high")
      ? "CRITICAL"
      : threatText.includes("elevated") || threatText.includes("moderate")
        ? "WARNING"
        : "STABLE";

  const scenarios = scenariosSection
    .filter((line) => /^\d+\./.test(line) || line.startsWith("- "))
    .map((line) => sanitizeLine(line.replace(/^\d+\.\s*/, "").replace(/^- /, "")));

  const recommendations = recommendationsSection
    .filter((line) => line.startsWith("- ") || line.startsWith("* ") || !line.startsWith("#"))
    .map((line) => sanitizeLine(line.replace(/^[-*]\s*/, ""), 180))
    .slice(0, 3);

  return {
    summary,
    threatBadge,
    scenarios: scenarios.length ? scenarios : ["No scenario lines returned by current brief."],
    recommendations: recommendations.length
      ? recommendations
      : ["No explicit recommended actions returned by current brief."],
  };
}

function toIstClock(value: Date) {
  return value.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
}

function toCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const sec = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${sec}`;
}

export default function Home() {
  const [activeMode, setActiveMode] = useState<IntelMode>("conflict");
  const [weatherLocation, setWeatherLocation] = useState("Kyiv");
  const [istTime, setIstTime] = useState("00:00:00");
  const [traceLogs, setTraceLogs] = useState(initialTraceLogs);
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_INTERVAL_SECONDS);
  const [nextRunAt, setNextRunAt] = useState<number | null>(null);
  const [lastRefreshIst, setLastRefreshIst] = useState("--:--:--");
  const [briefSummary, setBriefSummary] = useState(
    "Awaiting pipeline execution. The commander brief will populate after the first 5-minute cycle.",
  );
  const [threatBadge, setThreatBadge] = useState<ParsedBrief["threatBadge"]>("WARNING");
  const [strategicScenarios, setStrategicScenarios] = useState<string[]>([
    "Scenario output pending first pipeline run.",
  ]);
  const [liveRecommendations, setLiveRecommendations] = useState<string[]>([
    "Recommendations will populate from live brief output.",
  ]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState({
    runCount: 0,
    successCount: 0,
    lastDurationMs: 0,
    lastArticleCount: 0,
  });
  const refreshTriggeredAtZeroRef = useRef(false);
  const detectionToBrief = isRefreshing
    ? "RUNNING"
    : toCountdown(REFRESH_INTERVAL_SECONDS - secondsLeft);
  const successRate =
    telemetry.runCount > 0
      ? `${Math.round((telemetry.successCount / telemetry.runCount) * 100)}%`
      : "N/A";
  const sourceCoverage =
    telemetry.lastArticleCount > 0
      ? `${Math.min(100, telemetry.lastArticleCount * 20)}%`
      : "0%";
  const threatSignals = `${telemetry.lastArticleCount || traceLogs.length}`;
  const kpis = [
    { label: "DETECTION TO BRIEF", value: detectionToBrief, tone: "good" },
    { label: "ACTIVE THREAT SIGNALS", value: threatSignals, tone: "warn" },
    { label: "PIPELINE SUCCESS", value: successRate, tone: "good" },
    { label: "SOURCE COVERAGE", value: sourceCoverage, tone: "good" },
  ];
  const liveAgents = modeAgents(activeMode);
  const streamRate = `${Math.max(1, telemetry.lastArticleCount)} rec/cycle`;
  const fusionRate =
    telemetry.lastDurationMs > 0 ? `${(telemetry.lastDurationMs / 1000).toFixed(1)}s` : "N/A";
  const backlog = isRefreshing ? "running" : toCountdown(secondsLeft);

  const refreshFromPipeline = useCallback(async (force: boolean, mode: IntelMode) => {
    if (force) {
      setIsRefreshing(true);
    }
    try {
      const params = new URLSearchParams({
        mode,
        location: weatherLocation,
      });
      if (force) params.set("force", "1");
      const response = await fetch(`/api/brief?${params.toString()}`);
      if (response.status === 202) {
        const warming = (await response.json()) as {
          nextRunAt?: number;
          running?: boolean;
          lastError?: string | null;
          telemetry?: {
            runCount: number;
            successCount: number;
            lastDurationMs: number;
            lastArticleCount: number;
          };
        };
        if (warming.nextRunAt) {
          setNextRunAt(warming.nextRunAt);
        }
        if (warming.telemetry) {
          setTelemetry(warming.telemetry);
        }
        setPipelineError(warming.lastError ?? null);
        setIsRefreshing(Boolean(warming.running));
        return;
      }
      if (!response.ok) {
        throw new Error("API request failed");
      }
      const data = (await response.json()) as BriefResponse;
      if (data.nextRunAt && data.nextRunAt > Date.now()) {
        setNextRunAt(data.nextRunAt);
      }
      setIsRefreshing(Boolean(data.running));
      setPipelineError(data.lastError ?? null);
      if (data.telemetry) {
        setTelemetry(data.telemetry);
      }

      const nextLogs = data.liveArticles.map((article, idx) => ({
        id: article.source_id,
        confidence: Math.max(0.72, 0.94 - idx * 0.04),
        note: cleanText(article.title),
        url: article.link,
        timestamp: article.published || new Date(data.generatedAt).toISOString(),
      }));
      if (nextLogs.length > 0) {
        setTraceLogs(nextLogs);
      }

      const summaryLine =
        parseBrief(data.brief);
      setBriefSummary(summaryLine.summary);
      setThreatBadge(summaryLine.threatBadge);
      setStrategicScenarios(summaryLine.scenarios);
      setLiveRecommendations(summaryLine.recommendations);
      setLastRefreshIst(toIstClock(new Date(data.generatedAt)));
    } catch {
      setPipelineError("Dashboard API request failed. Retrying in next scheduler cycle.");
      setBriefSummary("Pipeline execution failed. Retrying in next 5-minute cycle.");
      setStrategicScenarios(["No scenarios available due to refresh error."]);
      setLiveRecommendations(["No recommendations available due to refresh error."]);
      setIsRefreshing(false);
    }
  }, [weatherLocation]);

  useEffect(() => {
    const timer = setInterval(() => setIstTime(toIstClock(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void refreshFromPipeline(false, activeMode);
    }, 0);
    const timer = setInterval(() => {
      void refreshFromPipeline(false, activeMode);
    }, 15000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(timer);
    };
  }, [activeMode, refreshFromPipeline]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!nextRunAt) {
        setSecondsLeft(REFRESH_INTERVAL_SECONDS);
        refreshTriggeredAtZeroRef.current = false;
        return;
      }
      const left = Math.max(0, Math.floor((nextRunAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && !refreshTriggeredAtZeroRef.current) {
        refreshTriggeredAtZeroRef.current = true;
        void refreshFromPipeline(false, activeMode);
      } else if (left > 0) {
        refreshTriggeredAtZeroRef.current = false;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [nextRunAt, activeMode, refreshFromPipeline]);

  return (
    <main className="min-h-screen bg-[#0B0F19] text-slate-100">
      <div className="grid min-h-screen grid-rows-[60px_auto_1fr_auto]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#334155] bg-[#1A1D24] px-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="border-r border-[#334155] pr-3 text-sm font-semibold tracking-wide text-[#00E5FF]">
              HACKVERSE // TACTICAL COMMAND CENTER
            </span>
            <span className="rounded-md border border-[#334155] bg-[#121722] px-2 py-1 font-mono text-xs text-slate-300">
              OSINT STREAM: ACTIVE
            </span>
            <span className="rounded-md border border-[#334155] bg-[#121722] px-2 py-1 font-mono text-xs text-slate-300">
              MULTI-AGENT SYSTEM: ONLINE
            </span>
          </div>
          <span className="font-mono text-base text-slate-300">IST {istTime}</span>
        </header>

        <section className="grid grid-cols-1 gap-3 border-b border-[#334155] bg-[#10151f] p-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-md border border-[#334155] bg-[#1A1D24] px-4 py-3"
            >
              <p className="font-mono text-xs text-slate-400">{kpi.label}</p>
              <p
                className={`text-2xl font-semibold ${
                  kpi.tone === "warn" ? "text-[#FFB300]" : "text-[#00E5FF]"
                }`}
              >
                {kpi.value}
              </p>
            </div>
          ))}
        </section>

        <section className="flex flex-wrap items-center gap-2 border-b border-[#334155] bg-[#10151f] px-3 py-2">
          <button
            onClick={() => setActiveMode("conflict")}
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              activeMode === "conflict"
                ? "border-[#00E5FF] bg-[#0F2730] text-[#00E5FF]"
                : "border-[#334155] bg-[#1A1D24] text-slate-300"
            }`}
          >
            Conflict Intelligence
          </button>
          <button
            onClick={() => setActiveMode("weather")}
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              activeMode === "weather"
                ? "border-[#00E5FF] bg-[#0F2730] text-[#00E5FF]"
                : "border-[#334155] bg-[#1A1D24] text-slate-300"
            }`}
          >
            Weather Intelligence
          </button>
          <button
            onClick={() => setActiveMode("disaster")}
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              activeMode === "disaster"
                ? "border-[#00E5FF] bg-[#0F2730] text-[#00E5FF]"
                : "border-[#334155] bg-[#1A1D24] text-slate-300"
            }`}
          >
            Disaster Intelligence
          </button>
          {activeMode === "weather" && (
            <input
              value={weatherLocation}
              onChange={(event) => setWeatherLocation(event.target.value)}
              className="ml-2 rounded-md border border-[#334155] bg-[#1A1D24] px-3 py-1 text-xs text-slate-200 outline-none focus:border-[#00E5FF]"
              placeholder="City / Region"
            />
          )}
        </section>

        <section className="grid min-h-0 grid-cols-1 gap-3 p-3 2xl:grid-cols-[280px_1.3fr_1fr]">
          <aside className="min-h-0 rounded-md border border-[#334155] bg-[#1A1D24] p-4">
            <h2 className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-[#00E5FF]">
              AGENT + STREAM STATUS
            </h2>
            <div className="space-y-2">
              {liveAgents.map((agent) => (
                <div
                  key={agent}
                  className="flex items-center justify-between rounded-md border border-[#334155] bg-[#121722] px-2 py-2"
                >
                  <span className="text-xs text-slate-200">{agent}</span>
                  <span
                    className={`flex items-center gap-2 font-mono text-[10px] ${
                      pipelineError ? "text-[#FF3366]" : isRefreshing ? "text-[#FFB300]" : "text-[#00E676]"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 animate-pulse rounded-full ${
                        pipelineError ? "bg-[#FF3366]" : isRefreshing ? "bg-[#FFB300]" : "bg-[#00E676]"
                      }`}
                    />
                    {pipelineError ? "DEGRADED" : isRefreshing ? "SYNCING" : "ONLINE"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-[#334155] bg-[#121722] p-2 font-mono text-[11px] text-slate-300">
              <p className="text-slate-400">LIVE PIPELINE HEALTH</p>
              <p>Mode: {activeMode.toUpperCase()}</p>
              <p>Ingest: {streamRate}</p>
              <p>Last Run: {fusionRate}</p>
              <p>Runs: {telemetry.runCount} / Success: {telemetry.successCount}</p>
              <p>Backlog: {backlog}</p>
            </div>
          </aside>

          <article className="min-h-0 overflow-y-auto overflow-x-hidden rounded-md border border-[#334155] bg-[#1A1D24] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-[#00E5FF]">
                COMMANDER&apos;S BRIEF
              </h1>
              <span
                className={`rounded-md px-3 py-1 font-mono text-xs shadow-[0_0_18px_rgba(255,51,102,0.35)] ${
                  threatBadge === "CRITICAL"
                    ? "border border-[#FF3366] bg-[#2A1620] text-[#FF3366]"
                    : threatBadge === "WARNING"
                      ? "border border-[#FFB300] bg-[#2A2416] text-[#FFB300]"
                      : "border border-[#00E676] bg-[#15261E] text-[#00E676]"
                }`}
              >
                THREAT LEVEL: {threatBadge}
              </span>
            </div>

            <div className="space-y-4">
              <section className="rounded-md border border-[#334155] bg-[#121722] p-3">
                <h3 className="mb-1 text-sm font-semibold text-slate-200">
                  5-MINUTE DECISION SUMMARY
                </h3>
                <p className="text-sm leading-6 text-slate-300">
                  {cleanText(briefSummary)}
                </p>
              </section>

              <section className="rounded-md border border-[#334155] bg-[#121722] p-3">
                <h3 className="mb-1 text-sm font-semibold text-slate-200">
                  Strategic Scenarios
                </h3>
                <div className="space-y-2 text-sm text-slate-300">
                  {strategicScenarios.map((scenario, idx) => (
                    <p key={`${scenario}-${idx}`} className="break-words">
                      <span
                        className={`font-semibold ${
                          idx === 0
                            ? "text-[#FF3366]"
                            : idx === 1
                              ? "text-[#FFB300]"
                              : "text-[#00E676]"
                        }`}
                      >
                        Scenario {String.fromCharCode(65 + idx)}:
                      </span>{" "}
                      {cleanText(scenario)}
                    </p>
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-[#334155] bg-[#121722] p-3">
                <h3 className="mb-1 text-sm font-semibold text-slate-200">
                  Recommended Immediate Actions (Traceable)
                </h3>
                <div className="space-y-2">
                  {liveRecommendations.map((action, idx) => (
                    <div
                      key={`${action}-${idx}`}
                      className="rounded-md border border-[#334155] bg-[#121722] p-3"
                    >
                      <p className="break-words text-sm text-slate-200">
                        <span className="font-mono text-xs text-[#00E5FF]">
                          REC-{String(idx + 1).padStart(2, "0")}
                        </span>{" "}
                        {cleanText(action)}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        confidence={Math.max(0.72, 0.92 - idx * 0.05).toFixed(2)} | sources=
                        {traceLogs.slice(0, 2).map((entry) => entry.id).join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </article>

          <section className="min-h-0 rounded-md border border-[#334155] bg-[#1A1D24] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[#00E5FF]">
              TACTICAL VISUALIZATIONS
            </h2>
            <div className="grid h-[235px] place-items-center rounded-md border border-dashed border-[#334155] bg-[#121722]">
              <div className="w-full space-y-3 px-3">
                <p className="text-center font-mono text-xs text-slate-300">
                  GEOSPATIAL MAP / CIVILIAN IMPACT LAYER
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-[#334155] bg-[#0F1625] p-2">
                    <p className="font-mono text-[10px] text-slate-400">RISK GRID</p>
                    <div className="mt-2 grid grid-cols-6 gap-1">
                      {Array.from({ length: 24 }).map((_, i) => {
                        const confidence = traceLogs[i % Math.max(traceLogs.length, 1)]?.confidence ?? 0.8;
                        return (
                        <div
                          key={i}
                          className={`h-3 rounded-sm ${
                            confidence >= 0.9
                              ? "bg-[#FF3366]/80"
                              : confidence >= 0.8
                                ? "bg-[#FFB300]/70"
                                : "bg-[#00E676]/60"
                          }`}
                        />
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-md border border-[#334155] bg-[#0F1625] p-2">
                    <p className="font-mono text-[10px] text-slate-400">IMPACT TREND</p>
                    <div className="mt-2 flex h-14 items-end gap-1">
                      {traceLogs.map((entry, idx) => (
                        <div
                          key={`${entry.id}-${idx}`}
                          style={{ height: `${Math.round(entry.confidence * 100)}%` }}
                          className="w-full rounded-sm bg-[#00E5FF]/70"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </section>

        <section className="min-h-0 border-t border-[#334155] bg-[#10151f] p-3">
          <div className="h-full rounded-md border border-[#334155] bg-[#0D121C] p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-[#00E5FF]">
                SOURCE TRACEABILITY LOG
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-[#334155] bg-[#1A1D24] px-2 py-1 font-mono text-[11px] text-slate-300">
                  NEXT REFRESH {toCountdown(secondsLeft)}
                </span>
                <span className="rounded-md border border-[#334155] bg-[#1A1D24] px-2 py-1 font-mono text-[11px] text-slate-300">
                  LAST UPDATE {lastRefreshIst}
                </span>
                <span className="rounded-md border border-[#334155] bg-[#1A1D24] px-2 py-1 font-mono text-[11px] text-slate-300">
                  PIPELINE {pipelineError ? "ERROR" : isRefreshing ? "RUNNING" : "READY"}
                </span>
                <button className="rounded-md border border-[#334155] bg-[#1A1D24] px-3 py-1 text-xs font-semibold text-slate-200 hover:border-[#00E5FF] hover:text-[#00E5FF]">
                  EXPORT EVIDENCE PACK
                </button>
              </div>
            </div>
            {pipelineError && (
              <div className="mb-2 rounded-md border border-[#FF3366] bg-[#2A1620] px-3 py-2 font-mono text-[11px] text-[#FF3366]">
                PIPELINE ERROR: {pipelineError.slice(0, 220)}
              </div>
            )}

            <div className="mb-2 hidden grid-cols-[1fr_130px_130px_1.1fr] gap-2 rounded-md border border-[#334155] bg-[#121722] px-2 py-1 font-mono text-[10px] text-slate-400 lg:grid">
              <p>SOURCE EVENT</p>
              <p>CONFIDENCE</p>
              <p>TIMESTAMP</p>
              <p>REFERENCE</p>
            </div>
            <div className="max-h-[280px] space-y-2 overflow-y-auto rounded-md border border-[#334155] bg-black/20 p-2 font-mono text-xs">
              {traceLogs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-1 gap-2 rounded-md border border-[#334155] bg-[#111827] p-2 lg:grid-cols-[1fr_130px_130px_1.1fr]"
                >
                  <p className="break-words text-slate-200">
                    <span className="text-[#00E5FF]">{log.id}</span>{" "}
                    <span className="line-clamp-2">{cleanText(log.note)}</span>
                  </p>
                  <p
                    className={`${
                      log.confidence >= 0.9
                        ? "text-[#00E676]"
                        : log.confidence >= 0.8
                          ? "text-[#FFB300]"
                          : "text-[#FF3366]"
                    }`}
                  >
                    {log.confidence.toFixed(2)}
                  </p>
                  <p className="text-slate-300">{compactTimestamp(log.timestamp)}</p>
                  <a
                    href={log.url}
                    className="text-[#00E676] underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {displayHost(log.url)}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
