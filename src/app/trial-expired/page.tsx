import { getSessionUser } from "@/lib/auth";
import { getTrialStatus } from "@/lib/trial";
import { TrialExpiredClient } from "./TrialExpiredClient";

export default async function TrialExpiredPage() {
  await getSessionUser(); // middleware already guarantees a valid, trial-locked session exists
  const trial = getTrialStatus();

  return <TrialExpiredClient machineId={trial.machineId} />;
}
