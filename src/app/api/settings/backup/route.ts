import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const execAsync = promisify(exec);

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

    // Try to find pg_dump.exe in the bundled pgsql directory
    // If not found, assume it is in the PATH
    const pgBinPaths = [
      path.join(/* webpackIgnore: true */ /* turbopackIgnore: true */ process.cwd(), 'pgsql', 'bin', 'pg_dump.exe'),
      path.join(/* webpackIgnore: true */ /* turbopackIgnore: true */ process.cwd(), '..', 'pgsql', 'bin', 'pg_dump.exe'),
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

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return NextResponse.json({ error: "DATABASE_URL not configured." }, { status: 500 });
    }

    // Run pg_dump
    const cmd = `"${pgDumpExe}" --dbname="${dbUrl}" --file="${filePath}" --format=c --compress=9`;
    
    // We don't await because it might take a while, but it's okay to await for a small DB
    // To prevent Vercel/Next timeout, we can fire and forget, but local standalone server has no strict timeout.
    await execAsync(cmd);

    return NextResponse.json({ success: true, file: filePath });
  } catch (error: any) {
    console.error("Backup failed:", error);
    return NextResponse.json({ error: "Backup process failed: " + error.message }, { status: 500 });
  }
}
