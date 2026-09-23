-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "contactPhone" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "arrivalTime" TEXT,
ADD COLUMN     "arrivalWindow" TEXT;
