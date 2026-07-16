import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppDataWvoDir } from "@/lib/licenseCrypto";
import { readDataDir } from "@/lib/import/readers";
import { buildMappingProposal } from "@/lib/import/detect";
import {
  validateMappingShape,
  validateMappingAgainstTables,
  type Mapping,
} from "@/lib/import/mappingSchema";
import { buildImportPlan } from "@/lib/import/pipeline";
import { executeImport } from "@/lib/import/execute";
import fs from "node:fs";
import path from "node:path";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const authErr = requireRole(user, "admin", "superuser");
  if (authErr) return authErr;

  const tempDir = path.join(getAppDataWvoDir(), "temp-imports", user!.userId);

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const files = formData.getAll("files") as File[];
      
      if (!files || files.length === 0) {
        return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
      }

      // Clean up old uploads
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = path.join(tempDir, file.name);
        fs.writeFileSync(filePath, buffer);
      }

      const tables = await readDataDir(tempDir);
      if (tables.length === 0) {
        return NextResponse.json({ error: "No CSV or Excel sheets recognized" }, { status: 400 });
      }

      const { mapping, notes } = buildMappingProposal(tables);
      
      // Return file definitions & headers to help frontend construct the mapper UI
      const filesMetadata = tables.map(t => ({
        file: t.file,
        sheet: t.sheet,
        headers: t.headers,
        sampleRow: t.rows[0]?.values || null,
      }));

      return NextResponse.json({
        mapping,
        notes,
        files: filesMetadata,
      });
    } catch (err: any) {
      console.error("Upload import files failed:", err);
      return NextResponse.json({ error: err.message || "Failed to process uploaded files" }, { status: 500 });
    }
  }

  // JSON request body for Validate or Execute
  try {
    const body = await request.json();
    const { action, mapping, skipRejected, clearDatabase } = body;

    if (!mapping) {
      return NextResponse.json({ error: "Missing mapping config" }, { status: 400 });
    }

    if (!fs.existsSync(tempDir)) {
      return NextResponse.json({ error: "No uploaded files found. Please upload files first." }, { status: 400 });
    }

    const headerRows = Object.fromEntries(mapping.files.map((f: any) => [f.file, f.headerRow || 1]));
    const tables = await readDataDir(tempDir, headerRows);
    
    const errors = [
      ...validateMappingShape(mapping),
      ...validateMappingAgainstTables(mapping, tables),
    ];
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, errors }, { status: 400 });
    }

    const plan = buildImportPlan(mapping, tables);

    if (action === "validate") {
      return NextResponse.json({
        ok: true,
        summary: plan.summary,
        rejectedCount: plan.rejected.length,
        skippedCount: plan.skipped.length,
        rejected: plan.rejected,
        skipped: plan.skipped,
      });
    }

    if (action === "execute") {
      if (plan.rejected.length > 0 && !skipRejected) {
        return NextResponse.json({
          ok: false,
          error: "There are rejected/invalid rows in the source files. Fix them or select 'Skip Rejected Rows'.",
        }, { status: 400 });
      }

      if (clearDatabase) {
        // Delete all transactional tables in correct dependency order
        await prisma.$transaction([
          prisma.payment.deleteMany(),
          prisma.invoiceLineItem.deleteMany(),
          prisma.invoice.deleteMany(),
          prisma.clientFollowUp.deleteMany(),
          prisma.clientNote.deleteMany(),
          prisma.timeEntry.deleteMany(),
          prisma.jobLineItem.deleteMany(),
          prisma.jobAssignment.deleteMany(),
          prisma.jobEquipment.deleteMany(),
          prisma.job.deleteMany(),
          prisma.recurringJobPersonnel.deleteMany(),
          prisma.recurringJobEquipment.deleteMany(),
          prisma.recurringJobTemplate.deleteMany(),
          prisma.stockLevel.deleteMany(),
          prisma.stockLocation.deleteMany(),
          prisma.inventoryItem.deleteMany(),
          prisma.equipment.deleteMany(),
          prisma.vehicle.deleteMany(),
          prisma.personnelQualification.deleteMany(),
          prisma.personnel.deleteMany(),
          prisma.client.deleteMany(),
        ]);
      }

      const result = await executeImport(prisma as any, plan);

      // Cleanup
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // non-blocking
      }

      return NextResponse.json({
        ok: true,
        created: result.created,
      });
    }

    return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  } catch (err: any) {
    console.error("Import processing failed:", err);
    return NextResponse.json({ error: err.message || "Failed to process import" }, { status: 500 });
  }
}
