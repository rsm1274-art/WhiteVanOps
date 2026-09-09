import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function POST() {
  const user = await getSessionUser();
  if (!user || (user.role !== "superuser" && user.role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "backup_target_dir" },
    });

    if (!setting || !setting.value) {
      return NextResponse.json({ error: "No backup directory configured." }, { status: 400 });
    }

    const targetDir = setting.value;
    if (!fs.existsSync(targetDir)) {
      return NextResponse.json({ error: "Configured backup directory does not exist." }, { status: 400 });
    }

    // Try to find pg_dump in the bundled pgsql directory
    // If not found, assume it is in the PATH
    const isWin = process.platform === "win32";
    const pgDumpName = isWin ? "pg_dump.exe" : "pg_dump";
    const pgBinPaths = [
      path.join(/* webpackIgnore: true */ /* turbopackIgnore: true */ process.cwd(), 'pgsql', 'bin', pgDumpName),
      path.join(/* webpackIgnore: true */ /* turbopackIgnore: true */ process.cwd(), '..', 'pgsql', 'bin', pgDumpName),
    ];
    
    let pgDumpExe = 'pg_dump';
    for (const p of pgBinPaths) {
      if (fs.existsSync(p)) {
        pgDumpExe = p;
        break;
      }
    }

    const now = new Date();
    const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
    const fileName = `WhiteVanOps_Backup_${dateStr}.sql`;
    const filePath = path.join(targetDir, fileName);

    const rawDbUrl = process.env.DATABASE_URL;
    if (!rawDbUrl) {
      return NextResponse.json({ error: "DATABASE_URL not configured." }, { status: 500 });
    }

    // Prisma's DATABASE_URL includes a `?schema=` query param that libpq/pg_dump
    // doesn't understand ("invalid URI query parameter"). Strip it before use.
    const dbUrl = new URL(rawDbUrl);
    dbUrl.searchParams.delete("schema");

    // Run pg_dump with args passed as an array (not a shell string) so nothing
    // in targetDir/dbUrl/filePath can be interpreted as shell syntax.
    await execFileAsync(pgDumpExe, [
      "--dbname",
      dbUrl.toString(),
      "--file",
      filePath,
      "--format=c",
      "--compress=9",
    ]);

    return NextResponse.json({ success: true, file: filePath });
  } catch (error) {
    console.error("Backup failed:", error);
    return NextResponse.json({ error: "Backup process failed. Check server logs for details." }, { status: 500 });
  }
}
