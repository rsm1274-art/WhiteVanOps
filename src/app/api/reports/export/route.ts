import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { audit } from "@/lib/audit";
import { validateDefinition } from "@/lib/reports/definition";
import { canViewReport } from "@/lib/reports/permissions";
import { runReport } from "@/lib/reports/run";
import { toCsv } from "@/lib/reports/csv";
import { toWorkbook } from "@/lib/reports/xlsx";
import { renderReportPdf, PDF_MAX_COLUMNS } from "@/lib/reports/pdf";
import { sanitizeFilename } from "@/lib/reports/exportFilename";

// Exports either an ad-hoc (client-supplied) or saved (by id) report as
// CSV/XLSX/PDF. Mirrors the run-by-id route's "never trust a client-supplied
// definition over the stored one" rule when savedReportId is given — the
// only thing the body may override there is nothing at all; export always
// runs the full stored definition, not a paged slice of it.
//
// Runs at a higher row cap than preview since this is the real output, not
// a sample — see EXPORT_ROW_LIMIT.

const EXPORT_ROW_LIMIT = 50_000;

const notFound = () => NextResponse.json({ error: "Report not found" }, { status: 404 });

const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const EXTENSIONS: Record<string, string> = { csv: "csv", xlsx: "xlsx", pdf: "pdf" };

export async function POST(req: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { definition: rawDefinition, savedReportId, format } =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (format !== "csv" && format !== "xlsx" && format !== "pdf") {
    return NextResponse.json({ error: "format must be one of csv, xlsx, pdf" }, { status: 400 });
  }

  let reportName = "report";
  let validated;

  if (typeof savedReportId === "string" && savedReportId) {
    const report = await prisma.savedReport.findUnique({
      where: { id: savedReportId },
      include: { folder: { select: { isPublic: true } } },
    });
    if (!report || !canViewReport({ userId: user!.userId, role: user!.role }, report)) return notFound();

    reportName = report.name;
    validated = validateDefinition(report.definition, user!.role);
    if (!validated.ok || !validated.definition) {
      return NextResponse.json(
        { error: "This saved report is no longer valid", details: validated.errors, unknownFieldKeys: validated.unknownFieldKeys },
        { status: 409 }
      );
    }
  } else if (rawDefinition !== undefined) {
    validated = validateDefinition(rawDefinition, user!.role);
    if (!validated.ok || !validated.definition) {
      return NextResponse.json(
        { error: "Invalid report definition", details: validated.errors, unknownFieldKeys: validated.unknownFieldKeys },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json({ error: "Either definition or savedReportId is required" }, { status: 400 });
  }

  if (format === "pdf" && validated.definition.columns.length > PDF_MAX_COLUMNS) {
    return NextResponse.json(
      { error: `Narrow this report to ${PDF_MAX_COLUMNS} columns or fewer to export as PDF, or use CSV/XLSX instead.` },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await runReport(validated.definition, { limit: EXPORT_ROW_LIMIT, offset: 0 });
  } catch (error) {
    console.error("Report export error:", error);
    return NextResponse.json({ error: "Failed to run report" }, { status: 500 });
  }

  let bytes: string | Buffer;
  try {
    if (format === "csv") {
      bytes = toCsv(result);
    } else if (format === "xlsx") {
      const workbook = toWorkbook(result);
      bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    } else {
      const settings = await prisma.systemSetting.findMany();
      bytes = Buffer.from(await renderReportPdf(result, { reportName, settings }));
    }
  } catch (error) {
    console.error("Report export serialization error:", error);
    return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
  }

  if (typeof savedReportId === "string" && savedReportId) {
    await audit(user!.userId, "EXPORT", "SavedReport", savedReportId, { format });
  }

  const filename = `${sanitizeFilename(reportName)}.${EXTENSIONS[format]}`;
  const responseBody = typeof bytes === "string" ? bytes : new Uint8Array(bytes);
  return new NextResponse(responseBody, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
