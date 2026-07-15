-- CreateTable
CREATE TABLE "SyncReviewItem" (
    "id" TEXT NOT NULL,
    "personnelId" TEXT,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "rejectedAt" TIMESTAMP(3) NOT NULL,
    "rejectionStatus" INTEGER NOT NULL,
    "rejectionMessage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncReviewItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SyncReviewItem" ADD CONSTRAINT "SyncReviewItem_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
