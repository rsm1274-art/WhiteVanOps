/**
 * "New" / "Updated" badges on the field job list. There is no push channel
 * (LAN-only, see CLAUDE.md "Transport is WiFi-only"), so a tech notices a
 * reassignment or reschedule only by spotting it. This keeps, per tech, the
 * `updatedAt` each job had when the tech last opened its card, in
 * localStorage, and flags jobs whose server `updatedAt` has moved since.
 *
 * Pure functions here; the field page owns the localStorage read/write.
 */

/** jobId → the job's `updatedAt` (server ISO string) when the tech last looked. */
export type SeenMap = Record<string, string>;

export type JobBadge = "new" | "updated" | null;

export function seenStorageKey(techId: string): string {
  return `wvo.seenJobs.${techId}`;
}

export function parseSeen(raw: string | null): SeenMap | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SeenMap) : null;
  } catch {
    return null;
  }
}

/**
 * Folds a fresh job list into the seen map:
 * - First ever load (`seen === null`): everything counts as seen, so a tech
 *   isn't greeted by a wall of "New" badges the first time.
 * - Jobs the tech just wrote to themselves (`selfWritten`) are marked seen at
 *   their new `updatedAt` — their own save isn't news.
 * - Jobs no longer on the list are dropped so the map can't grow forever.
 */
export function reconcileSeen(
  seen: SeenMap | null,
  jobs: { id: string; updatedAt: string }[],
  selfWritten: ReadonlySet<string> = new Set()
): SeenMap {
  const next: SeenMap = {};
  for (const job of jobs) {
    if (seen === null || selfWritten.has(job.id)) next[job.id] = job.updatedAt;
    else if (job.id in seen) next[job.id] = seen[job.id];
  }
  return next;
}

export function jobBadge(job: { id: string; updatedAt: string }, seen: SeenMap | null): JobBadge {
  if (seen === null) return null;
  if (!(job.id in seen)) return "new";
  return job.updatedAt > seen[job.id] ? "updated" : null;
}
