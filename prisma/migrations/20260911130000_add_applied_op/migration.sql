-- v2.0 Phase 2: idempotency foundation. AppliedOp records every field-write op
-- the server has applied so a replayed op can be recognized instead of
-- double-applied. No route writes to this table yet (Phase 3 wires it up).
CREATE TABLE "AppliedOp" (
    "opId" TEXT NOT NULL,
    "opType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "resultId" TEXT,
    "outcome" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedOp_pkey" PRIMARY KEY ("opId")
);

CREATE INDEX "AppliedOp_targetKey_idx" ON "AppliedOp"("targetKey");
