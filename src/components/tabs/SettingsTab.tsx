import { useState, useEffect } from "react";
import { Save, Server, AlertCircle, BadgeCheck, Building2 } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";
import { TrialUnlockForm } from "@/components/trial/TrialUnlockForm";
import { DataImportSection } from "@/components/settings/DataImportSection";
import { RecoverFieldWorkSection } from "@/components/settings/RecoverFieldWorkSection";

interface LicenseResponse {
  licenseKey: string | null;
  notes: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  activeBaseKey: string | null;
  trial: {
    isTrial: boolean;
    daysRemaining: number;
    isLocked: boolean;
    machineId: string | null;
  };
}

// v2.0: there is no Base/Plus plan any more — every activated install runs
// the full feature set. This card is activation status only: the key, when
// it was activated, and when (if ever) it expires. The trial mechanism
// (30-day demo installers) is unrelated and still applies.
function LicenseSection() {
  const [license, setLicense] = useState<LicenseResponse | null>(null);

  const fetchLicense = () => {
    fetch("/api/license")
      .then((res) => res.json())
      .then((data: LicenseResponse) => {
        setLicense(data);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchLicense();
  }, []);

  if (!license) return null;

  return (
    <div className="bg-white rounded shadow-sm border border-zinc-200">
      <div className="border-b border-zinc-100 p-6 flex items-center gap-3">
        <div className="p-2 rounded bg-emerald-50 text-emerald-600">
          <BadgeCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-zinc-800">License & Activation</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {license.licenseKey ? "This install is activated." : "This install is not activated."}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {license.trial.isTrial && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded space-y-3">
            <p className="text-sm font-semibold text-blue-800">
              Trial: {license.trial.daysRemaining} day{license.trial.daysRemaining === 1 ? "" : "s"} remaining
            </p>
            <p className="text-xs text-blue-700">
              Purchased? Enter your activation key below to convert this install permanently.
            </p>
            <TrialUnlockForm machineId={license.trial.machineId} onUnlocked={fetchLicense} />
          </div>
        )}

        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">License Key</span>
            <p className="text-sm font-mono text-zinc-800 font-medium mt-0.5">
              {license.licenseKey || license.activeBaseKey || "Not activated"}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Expires / Renews</span>
            <p className="text-sm text-zinc-800 font-medium mt-0.5">
              {license.expiresAt ? formatDate(license.expiresAt) : "Perpetual (Never Expires)"}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Activated On</span>
            <p className="text-sm text-zinc-800 font-medium mt-0.5">
              {license.activatedAt ? formatDate(license.activatedAt) : "N/A"}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Notes</span>
            <p className="text-sm text-zinc-600 mt-0.5">{license.notes || "No notes recorded"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsTab({
  onShowToast,
  isSuperuser = false,
  onDataImported = () => {},
}: {
  onShowToast: (text: string, isError?: boolean) => void;
  isSuperuser?: boolean;
  /** Reloads the dashboard so imported records appear in the other tabs. */
  onDataImported?: () => void;
}) {
  const [backupDir, setBackupDir] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyRemittance, setCompanyRemittance] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: { key: string; value: string }[]) => {
        if (Array.isArray(data)) {
          data.forEach((s: { key: string; value: string }) => {
            if (s.key === "backup_target_dir") setBackupDir(s.value);
            if (s.key === "company_name") setCompanyName(s.value);
            if (s.key === "company_address") setCompanyAddress(s.value);
            if (s.key === "company_phone") setCompanyPhone(s.value);
            if (s.key === "company_email") setCompanyEmail(s.value);
            if (s.key === "company_remittance") setCompanyRemittance(s.value);
          });
        }
      })
      .catch(console.error);
  }, []);

  const handleSaveBackup = async () => {
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

  const handleSaveBusiness = async () => {
    setSavingBusiness(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            company_name: companyName,
            company_address: companyAddress,
            company_phone: companyPhone,
            company_email: companyEmail,
            company_remittance: companyRemittance,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save business settings");
      onShowToast("Business & Invoicing profile saved successfully!");
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : "Failed to save setting", true);
    } finally {
      setSavingBusiness(false);
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
      <LicenseSection />

      {/* Business & Invoicing Profile */}
      <div className="bg-white rounded shadow-sm border border-zinc-200">
        <div className="border-b border-zinc-100 p-6 flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-800">Business & Invoicing Profile</h2>
            <p className="text-sm text-zinc-500 mt-1">Configure company contact details and remittance instructions printed on invoice PDFs.</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-zinc-700 mb-1">
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Service Vans (defaults to WHITE VAN OPS)"
                className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-zinc-700 mb-1">
                Company Address / Subtitle
              </label>
              <input
                type="text"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="e.g. 123 Main St, Anytown, US"
                className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-zinc-700 mb-1">
                Contact Phone
              </label>
              <input
                type="text"
                value={companyPhone}
                onChange={(e) => setCompanyPhone(e.target.value)}
                placeholder="e.g. 555-0199"
                className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-zinc-700 mb-1">
                Contact Email
              </label>
              <input
                type="email"
                value={companyEmail}
                onChange={(e) => setCompanyEmail(e.target.value)}
                placeholder="e.g. billing@acmevans.com"
                className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-zinc-700 mb-1">
              Remittance Instructions / Payment Terms Notes
            </label>
            <textarea
              value={companyRemittance}
              onChange={(e) => setCompanyRemittance(e.target.value)}
              placeholder="e.g. Please send ACH payments to Routing: XXXXX, Account: XXXXX. Or mail checks to address above."
              rows={3}
              className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-2 border"
            />
            <p className="text-[10px] text-zinc-400 mt-1">This message will be printed at the bottom of generated invoice PDFs.</p>
          </div>

          <div className="pt-2">
            <button
              onClick={handleSaveBusiness}
              disabled={savingBusiness}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {savingBusiness ? "Saving..." : "Save Business Profile"}
            </button>
          </div>
        </div>
      </div>

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
                onClick={handleSaveBackup}
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

      <RecoverFieldWorkSection onShowToast={onShowToast} onImported={onDataImported} />

      {isSuperuser && (
        <DataImportSection onShowToast={onShowToast} onImported={onDataImported} />
      )}
    </div>
  );
}
