-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "recurringTemplateId" TEXT;

-- CreateTable
CREATE TABLE "RecurringJobTemplate" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assignedVehicleId" TEXT,
    "notes" TEXT,
    "frequency" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringJobTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringJobPersonnel" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "personnelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringJobPersonnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringJobEquipment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringJobEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringJobPersonnel_templateId_personnelId_key" ON "RecurringJobPersonnel"("templateId", "personnelId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringJobEquipment_templateId_equipmentId_key" ON "RecurringJobEquipment"("templateId", "equipmentId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringJobTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJobTemplate" ADD CONSTRAINT "RecurringJobTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJobTemplate" ADD CONSTRAINT "RecurringJobTemplate_assignedVehicleId_fkey" FOREIGN KEY ("assignedVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJobPersonnel" ADD CONSTRAINT "RecurringJobPersonnel_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringJobTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJobPersonnel" ADD CONSTRAINT "RecurringJobPersonnel_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJobEquipment" ADD CONSTRAINT "RecurringJobEquipment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringJobTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJobEquipment" ADD CONSTRAINT "RecurringJobEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
