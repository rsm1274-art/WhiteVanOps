/**
 * POST/PUT /api/jobs with the double-booking confirmation round-trip.
 *
 * The server answers a same-day tech/van double-booking with 409
 * `{ needsConfirmation, warnings }` (see jobConflicts.ts). This asks the
 * user "Book anyway?" and, on OK, re-sends with `confirmDoubleBooking: true`.
 *
 * Returns the parsed response body on success, or null if the user declined
 * (the caller should leave its modal open). Throws with the server's error
 * message on any other failure.
 */
export async function submitJob(
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  fallbackError: string
): Promise<unknown | null> {
  const send = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/jobs", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    return { res, result };
  };

  let { res, result } = await send(body);
  if (res.status === 409 && result.needsConfirmation) {
    const list = (result.warnings as string[]).map((w) => `• ${w}`).join("\n");
    if (!window.confirm(`Same-day double-booking:\n\n${list}\n\nBook anyway?`)) return null;
    ({ res, result } = await send({ ...body, confirmDoubleBooking: true }));
  }
  if (!res.ok) throw new Error(result.error || fallbackError);
  return result;
}
