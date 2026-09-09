-- CreateIndex
CREATE INDEX "Job_status_scheduledDate_idx" ON "Job"("status", "scheduledDate");
