// Shared by server (trialGuard.ts) and browser code — must stay free of
// Node-only imports (fs, node-machine-id), or it drags them into the client bundle.

/** Body `code` a client checks to send the user to /trial-expired. */
export const TRIAL_EXPIRED_CODE = "trial_expired";

/** True when a fetch was refused because the 30-day trial ended. */
export async function isTrialExpiredResponse(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body = await res.clone().json();
    return body?.code === TRIAL_EXPIRED_CODE;
  } catch {
    return false;
  }
}
