const FASTAPI_BASE_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";
const POLL_INTERVAL_MS = 15 * 1000;

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

type ScheduledBriefResult = {
  data: BriefPayload | null;
  generatedAt: number;
  running: boolean;
  nextRunAt: number;
  lastError: string | null;
  telemetry: {
    runCount: number;
    successCount: number;
    lastDurationMs: number;
    lastArticleCount: number;
  };
};

async function fetchFromFastAPI(
  mode: string,
  location: string,
  force: boolean
): Promise<ScheduledBriefResult> {
  const params = new URLSearchParams({ mode, location });
  if (force) params.set("force", "true");

  const res = await fetch(`${FASTAPI_BASE_URL}/brief?${params.toString()}`, {
    cache: "no-store",
  });

  if (res.status === 202) {
    const body = await res.json();
    const detail = body.detail ?? body;
    return {
      data: null,
      generatedAt: 0,
      running: detail.running ?? true,
      nextRunAt: detail.next_run_at ?? Date.now() + 60_000,
      lastError: detail.last_error ?? null,
      telemetry: {
        runCount: detail.telemetry?.run_count ?? 0,
        successCount: detail.telemetry?.success_count ?? 0,
        lastDurationMs: detail.telemetry?.last_duration_ms ?? 0,
        lastArticleCount: detail.telemetry?.last_article_count ?? 0,
      },
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`FastAPI error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  const liveArticles = (data.live_articles ?? []).map(
    (a: Record<string, string>) => ({
      source_id: a.source_id,
      source_name: a.source_name,
      title: a.title,
      summary: a.summary,
      link: a.link,
      published: a.published,
    })
  );

  return {
    data: {
      liveArticles,
      brief: data.brief ?? "",
    },
    generatedAt: data.generated_at ?? Date.now(),
    running: data.running ?? false,
    nextRunAt: data.next_run_at ?? Date.now() + 300_000,
    lastError: data.last_error ?? null,
    telemetry: {
      runCount: data.telemetry?.run_count ?? 0,
      successCount: data.telemetry?.success_count ?? 0,
      lastDurationMs: data.telemetry?.last_duration_ms ?? 0,
      lastArticleCount: data.telemetry?.last_article_count ?? 0,
    },
  };
}

export async function getScheduledBrief(
  mode: string,
  location: string,
  force = false
): Promise<ScheduledBriefResult> {
  return fetchFromFastAPI(mode, location, force);
}
