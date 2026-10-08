// Starts the incremental sync scheduler inside the Next.js Node server (not in the browser, not on the edge).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_SCHEDULER !== "1") {
    const { startScheduler } = await import("./server/jobs/run");
    startScheduler();
  }
}
