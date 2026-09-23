/**
 * "New" / "Updated" badges on the field job list — the tech's only signal
 * that the office changed something, since there is no push channel.
 *
 * Per tech, localStorage holds jobId → the job's server `updatedAt` as of the
 * last time the tech looked (expanded the card). Server timestamps only, so
 * phone/office clock skew can't produce false badges.
 *
 * The tech's own writes also bump `updatedAt`. Every job the tech writes to is
 * recorded as "self-touched"; once its queued writes have reached the server
 * (no pending sync-queue op for it), the next job-list load re-stamps it as
 * seen, so a tech's own save never badges their own card.
 */

export type SeenMap = Record<string, string>;
export type JobBadge = "new" | "updated" | null;

interface SeenJob {
  id: string;
  updatedAt: string;
}

export function jobBadge(job: SeenJob, seen: SeenMap | null, selfTouched: ReadonlySet<string>): JobBadge {
  if (!seen || selfTouched.has(job.id)) return null;
  const last = seen[job.id];
  if (!last) return "new";
  return Date.parse(job.updatedAt) > Date.parse(last) ? "updated" : null;
}

/**
 * Fold a freshly loaded job list into the seen state.
 * - First run (no map yet): baseline every current job as seen, so upgrading
 *   doesn't light up the whole list.
 * - Self-touched jobs with no pending writes are re-stamped and released.
 * - Entries for jobs no longer in the list are pruned.
 */
export function reconcileSeen(
  seen: SeenMap | null,
  jobs: SeenJob[],
  selfTouched: string[],
  pendingJobIds: ReadonlySet<string>
): { seen: SeenMap; selfTouched: string[] } {
  const next: SeenMap = {};
  for (const job of jobs) {
    if (seen === null) next[job.id] = job.updatedAt;
    else if (seen[job.id]) next[job.id] = seen[job.id];
  }
  const ids = new Set(jobs.map((j) => j.id));
  const stillTouched: string[] = [];
  for (const id of selfTouched) {
    if (pendingJobIds.has(id)) {
      stillTouched.push(id);
    } else if (ids.has(id)) {
      next[id] = jobs.find((j) => j.id === id)!.updatedAt;
    }
  }
  return { seen: next, selfTouched: stillTouched };
}
