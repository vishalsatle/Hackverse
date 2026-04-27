import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type BriefPayload = {
  liveArticles: Array<{
    source_id: string;
    source_name: string;
    title: string;
    summary: string;
    link: string;
    published: string;
  }>;
  brief: string;
};

type JobState = {
  key: string;
  mode: string;
  location: string;
  data: BriefPayload | null;
  generatedAt: number;
  running: boolean;
  lastError: string | null;
  nextRunAt: number;
  runCount: number;
  successCount: number;
  lastDurationMs: number;
  lastArticleCount: number;
};

const jobs = new Map<string, JobState>();
let globalNextRunAt = Date.now() + REFRESH_INTERVAL_MS;
let schedulerStarted = false;

function parsePipelineOutput(stdout: string): BriefPayload {
  const inputMarker = "=== LIVE OSINT INPUT (TOP 5) ===";
  const runMarker = "=== RUNNING CREW PIPELINE ===";
  const briefMarker = "=== FINAL COMMANDER BRIEF ===";

  const inputStart = stdout.indexOf(inputMarker);
  const runStart = stdout.indexOf(runMarker);
  const briefStart = stdout.indexOf(briefMarker);

  if (inputStart === -1 || runStart === -1 || briefStart === -1) {
    throw new Error("Unexpected pipeline output format.");
  }

  const jsonSlice = stdout
    .slice(inputStart + inputMarker.length, runStart)
    .trim();
  const liveArticles = JSON.parse(jsonSlice);
  const brief = stdout.slice(briefStart + briefMarker.length).trim();

  return { liveArticles, brief };
}

async function runPipeline(mode: string, location: string): Promise<BriefPayload> {
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, "groq_agent_pipeline.py");
  const winPython = path.join(cwd, ".venv", "Scripts", "python.exe");
  const unixPython = path.join(cwd, ".venv", "bin", "python");
  const pythonExec = process.platform === "win32" ? winPython : unixPython;

  const { stdout } = await execFileAsync(pythonExec, [scriptPath], {
    cwd,
    timeout: 290000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      INTEL_MODE: mode,
      INTEL_LOCATION: location,
    },
  });
  return parsePipelineOutput(stdout);
}

async function executeJob(job: JobState) {
  if (job.running) return;
  job.running = true;
  const startedAt = Date.now();
  job.runCount += 1;
  try {
    const payload = await runPipeline(job.mode, job.location);
    job.data = payload;
    job.generatedAt = Date.now();
    job.successCount += 1;
    job.lastArticleCount = payload.liveArticles.length;
    job.lastError = null;
  } catch (error) {
    job.lastError = error instanceof Error ? error.message : "Unknown pipeline error";
  } finally {
    job.lastDurationMs = Date.now() - startedAt;
    job.running = false;
  }
}

function createJob(mode: string, location: string): JobState {
  const key = `${mode}:${location}`;
  const job: JobState = {
    key,
    mode,
    location,
    data: null,
    generatedAt: 0,
    running: false,
    lastError: null,
    nextRunAt: globalNextRunAt,
    runCount: 0,
    successCount: 0,
    lastDurationMs: 0,
    lastArticleCount: 0,
  };

  void executeJob(job);
  return job;
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => {
    globalNextRunAt = Date.now() + REFRESH_INTERVAL_MS;
    for (const job of jobs.values()) {
      job.nextRunAt = globalNextRunAt;
      void executeJob(job);
    }
  }, REFRESH_INTERVAL_MS);
}

export async function getScheduledBrief(mode: string, location: string, force = false) {
  startScheduler();
  const key = `${mode}:${location}`;
  let job = jobs.get(key);
  if (!job) {
    job = createJob(mode, location);
    jobs.set(key, job);
  }

  if (force) {
    await executeJob(job);
  } else if (!job.data && !job.running) {
    await executeJob(job);
  }

  return {
    data: job.data,
    generatedAt: job.generatedAt,
    running: job.running,
    nextRunAt: job.nextRunAt,
    lastError: job.lastError,
    telemetry: {
      runCount: job.runCount,
      successCount: job.successCount,
      lastDurationMs: job.lastDurationMs,
      lastArticleCount: job.lastArticleCount,
    },
  };
}
