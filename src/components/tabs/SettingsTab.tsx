import { useState, useEffect } from "react";
import { Save, Server, AlertCircle, BadgeCheck } from "lucide-react";
import { formatDate, dateToLocalStr } from "@/lib/dateUtils";

interface LicenseResponse {
  tier: "base" | "plus";
  licenseKey: string | null;
  notes: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  plus: boolean;
}

function LicenseSection({
  isSuperuser,
  onShowToast,
  onLicenseChanged,
}: {
  isSuperuser: boolean;
  onShowToast: (text: string, isError?: boolean) => void;
  onLicenseChanged: () => void;
}) {
  const [license, setLicense] = useState<LicenseResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [tier, setTier] = useState<"base" | "plus">("base");
  const [licenseKey, setLicenseKey] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    fetch("/api/license")
      .then((res) => res.json())
      .then((data: LicenseResponse) => {
        setLicense(data);
        setTier(data.tier);
        setLicenseKey(data.licenseKey ?? "");
        setNotes(data.notes ?? "");
        setExpiresAt(data.expiresAt ? dateToLocalStr(data.expiresAt) : "");
      })
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, licenseKey, notes, expiresAt: expiresAt || null }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to update license");
      setLicense(result);
      onShowToast(
        result.plus
          ? "Plus plan activated — Analytics, Invoicing, and CRM follow-ups are now available."
          : "Plan set to Base. Plus features are hidden; existing Plus data is kept."
      );
      onLicenseChanged();
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : "Failed to update license", true);
    } finally {
      setSaving(false);
    }
  };

  if (!license) return null;

  return (
    <div className="bg-white rounded shadow-sm border border-zinc-200">
      <div className="border-b border-zinc-100 p-6 flex items-center gap-3">
        <div className={`p-2 rounded ${license.plus ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"}`}>
          <BadgeCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-zinc-800">License & Plan</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Current plan:{" "}
            <span className="font-bold text-zinc-800">{license.plus ? "WhiteVanOps Plus" : "WhiteVanOps Base"}</span>
            {license.tier === "plus" && license.expiresAt && (
              <> · {license.plus ? "renews/expires" : "expired"} {formatDate(license.expiresAt)}</>
            )}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="p-4 bg-zinc-50 border border-zinc-200 rounded text-sm text-zinc-600 flex gap-3">
          <AlertCircle className="h-5 w-5 text-zinc-400 shrink-0" />
          <p>
            <strong>Plus</strong>&nbsp;adds CRM notes &amp; follow-up reminders, the Business Analytics tab, and
            internal Invoicing with PDF generation and payment tracking. Downgrading hides these features
            but never deletes existing notes, invoices, or payment records.
          </p>
        </div>

        {isSuperuser ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide text-zinc-700 mb-1">Plan</label>
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value as "base" | "plus")}
                  className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border bg-white"
                >
                  <option value="base">Base</option>
                  <option value="plus">Plus</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide text-zinc-700 mb-1">
                  License Key (Optional)
                </label>
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="Provided by your vendor"
                  className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide text-zinc-700 mb-1">
                  Expiry (Optional)
                </label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold uppercase tracking-wide text-zinc-700 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Activated per support agreement, June 2026"
                className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-zinc-800 transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Plan"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            Only a superuser can change the plan. Contact your system administrator or vendor to upgrade.
          </p>
        )}
      </div>
    </div>
  );
}

export default function SettingsTab({
  onShowToast,
  isSuperuser = false,
  onLicenseChanged = () => {},
}: {
  onShowToast: (text: string, isError?: boolean) => void;
  isSuperuser?: boolean;
  onLicenseChanged?: () => void;
}) {
  const [backupDir, setBackupDir] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings?key=backup_target_dir")
      .then(res => res.json())
      .then(data => {
        if (data.value) setBackupDir(data.value);
      })
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "backup_target_dir", value: backupDir }),
      });
      if (!res.ok) throw new Error("Failed to save setting");
      onShowToast("Backup directory saved successfully!");
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : "Failed to save setting", true);
    } finally {
      setLoading(false);
    }
  };

  const handleRunBackup = async () => {
    if (!backupDir) {
      onShowToast("Please save a backup directory first.", true);
      return;
    }
    try {
      const res = await fetch("/api/settings/backup", { method: "POST" });
      if (!res.ok) throw new Error("Backup failed to start");
      onShowToast("Backup started successfully! Check your target directory.");
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : "Backup failed to start", true);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <LicenseSection isSuperuser={isSuperuser} onShowToast={onShowToast} onLicenseChanged={onLicenseChanged} />

      <div className="bg-white rounded shadow-sm border border-zinc-200">
        <div className="border-b border-zinc-100 p-6 flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-800">Database Backup & Recovery</h2>
            <p className="text-sm text-zinc-500 mt-1">Configure physical redundancy for your database.</p>
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="p-4 bg-zinc-50 border border-zinc-200 rounded text-sm text-zinc-600 flex gap-3">
            <AlertCircle className="h-5 w-5 text-zinc-400 shrink-0" />
            <p>
              Your data never leaves your infrastructure. By configuring a Target Directory Mirror, the application will automatically run a cron-style backup every night at 2:00 AM using PostgreSQL&apos;s native `pg_dump` binary. 
              We recommend selecting an external USB drive, a local NAS, or a synchronized drive folder (like OneDrive or Google Drive).
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold uppercase tracking-wide text-zinc-700 mb-1">
                Target Directory Mirror
              </label>
              <input
                type="text"
                value={backupDir}
                onChange={(e) => setBackupDir(e.target.value)}
                placeholder="e.g. D:\WVO_Backups"
                className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
              />
            </div>
            
            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-zinc-800 transition-colors"
              >
                <Save className="h-4 w-4" />
                {loading ? "Saving..." : "Save Settings"}
              </button>
              
              <button
                onClick={handleRunBackup}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-blue-700 transition-colors"
              >
                Run Backup Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
