import { getScheduledBrief } from "@/lib/briefScheduler";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const requestedMode = (url.searchParams.get("mode") || "conflict").toLowerCase();
    const mode = ["conflict", "weather", "disaster"].includes(requestedMode)
      ? requestedMode
      : "conflict";
    const rawLocation = url.searchParams.get("location") || "Kyiv";
    const location = rawLocation.slice(0, 80);
    const scheduled = await getScheduledBrief(mode, location, force);
    if (!scheduled.data) {
      return Response.json(
        {
          error: "No brief generated yet. Scheduler is warming up.",
          running: scheduled.running,
          nextRunAt: scheduled.nextRunAt,
          lastError: scheduled.lastError,
          telemetry: scheduled.telemetry,
        },
        { status: 202 },
      );
    }

    return Response.json({
      ...scheduled.data,
      generatedAt: scheduled.generatedAt,
      running: scheduled.running,
      nextRunAt: scheduled.nextRunAt,
      lastError: scheduled.lastError,
      telemetry: scheduled.telemetry,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Failed to generate intelligence brief.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
