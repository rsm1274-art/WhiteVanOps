import { getSessionUser } from "@/lib/auth";
import { getTrialStatus } from "@/lib/trial";
import { TrialExpiredClient } from "./TrialExpiredClient";

export default async function TrialExpiredPage() {
  await getSessionUser(); // middleware already guarantees a valid session exists
  const trial = getTrialStatus();

  // stillLocked=false: the office has activated since this session was
  // signed in (its trialLocked claim is stale) — signing in again clears it.
  return <TrialExpiredClient machineId={trial.machineId} stillLocked={trial.isLocked} />;
}
