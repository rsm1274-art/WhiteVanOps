import { useState, useEffect } from "react";
import { Save, Server, AlertCircle, BadgeCheck, Building2 } from "lucide-react";
import { formatDate } from "@/lib/dateUtils";

interface LicenseResponse {
  tier: "base" | "plus";
  licenseKey: string | null;
  notes: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  activeBaseKey: string | null;
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
  const [pastedPayload, setPastedPayload] = useState("");
  const [uploadedPayload, setUploadedPayload] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showConfirmDowngrade, setShowConfirmDowngrade] = useState(false);

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

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const readAndApplyFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        // Verify it is JSON
        JSON.parse(content);
        setUploadedPayload(content);
        onShowToast(`Loaded license file: ${file.name}`);
      } catch (err) {
        onShowToast("Invalid license file format. Must be JSON.", true);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readAndApplyFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readAndApplyFile(file);
  };

  const handleUpgrade = async () => {
    const payloadStr = (pastedPayload || uploadedPayload).trim();
    if (!payloadStr) {
      onShowToast("Please paste a license code or upload a license file first.", true);
      return;
    }

    let payloadObj;
    try {
      payloadObj = JSON.parse(payloadStr);
    } catch (err) {
      onShowToast("Invalid license code format. Must be a valid JSON block.", true);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "plus", licensePayload: payloadObj }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to upgrade license");
      setLicense(result);
      setPastedPayload("");
      setUploadedPayload("");
      onShowToast("Plus plan activated — Analytics, Invoicing, and CRM follow-ups are now available.");
      onLicenseChanged();
    } catch (err: unknown) {
      onShowToast(err instanceof Error ? err.message : "Failed to update license", true);
    } finally {
      setSaving(false);
    }
  };

  const handleDowngrade = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "base" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to downgrade license");
      setLicense(result);
      setShowConfirmDowngrade(false);
      onShowToast("Plan set to Base. Plus features are hidden; existing Plus data is kept.");
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
            <strong>Plus</strong> adds CRM notes &amp; follow-up reminders, the Business Analytics tab, and
            internal Invoicing with PDF generation and payment tracking. Downgrading hides these features
            but never deletes existing notes, invoices, or payment records.
          </p>
        </div>

        {isSuperuser ? (
          <div className="space-y-6">
            {!license.plus ? (
              /* Upgrade Flow */
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800">1. Copy Active License Key</h3>
                  <p className="text-xs text-zinc-500">
                    To purchase the Plus Upgrade, copy the active Base License Key below and send it to your vendor.
                  </p>
                  {license.activeBaseKey ? (
                    <div className="flex items-center gap-2 max-w-xl">
                      <input
                        type="text"
                        readOnly
                        value={license.activeBaseKey}
                        className="flex-1 font-mono text-xs bg-zinc-50 border border-zinc-300 rounded p-2 text-zinc-600 focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(license.activeBaseKey || "");
                          onShowToast("License key copied to clipboard!");
                        }}
                        className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded text-xs font-semibold text-zinc-700 transition-colors uppercase tracking-wider"
                      >
                        Copy Key
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 rounded p-2 max-w-xl">
                      Warning: Base activation key not found. Please activate the application in Electron first.
                    </p>
                  )}
                </div>

                <div className="border-t border-zinc-100 pt-6 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800">2. Apply Upgrade License</h3>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Paste Text Area */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase text-zinc-700">Paste License Code</label>
                      <textarea
                        value={pastedPayload}
                        onChange={(e) => {
                          setPastedPayload(e.target.value);
                          setUploadedPayload("");
                        }}
                        placeholder="Paste the cryptographically signed JSON block here..."
                        className="w-full h-32 text-xs font-mono border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 p-2 border bg-white placeholder-zinc-400"
                      />
                    </div>

                    {/* Drag and Drop File Zone */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase text-zinc-700">Or Upload License File</label>
                      <div
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        className={`w-full h-32 border-2 border-dashed rounded flex flex-col items-center justify-center p-4 text-center transition-colors ${
                          dragActive ? "border-blue-500 bg-blue-50" : "border-zinc-300 hover:bg-zinc-50"
                        }`}
                      >
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleFileChange}
                          id="license-file-upload"
                          className="hidden"
                        />
                        <label
                          htmlFor="license-file-upload"
                          className="cursor-pointer text-xs font-semibold text-blue-600 hover:text-blue-700 underline"
                        >
                          Choose a file
                        </label>
                        <span className="text-[11px] text-zinc-500 mt-1">or drag and drop it here (.json)</span>
                        {uploadedPayload && (
                          <div className="mt-2 text-xs text-emerald-600 font-semibold flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            License file loaded successfully
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleUpgrade}
                    disabled={saving || (!pastedPayload.trim() && !uploadedPayload)}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Verifying..." : "Apply Plus Upgrade"}
                  </button>
                </div>
              </div>
            ) : (
              /* Upgrade Details & Downgrade Flow */
              <div className="space-y-6">
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">License Key</span>
                    <p className="text-sm font-mono text-zinc-800 font-medium mt-0.5">{license.licenseKey}</p>
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
                    <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Upgrade Notes</span>
                    <p className="text-sm text-zinc-600 mt-0.5">{license.notes || "No notes recorded"}</p>
                  </div>
                </div>

                {!showConfirmDowngrade ? (
                  <button
                    onClick={() => setShowConfirmDowngrade(true)}
                    className="px-4 py-2 border border-red-200 text-red-600 text-xs font-bold uppercase tracking-wider rounded hover:bg-red-50 hover:text-red-700 transition-colors"
                  >
                    Downgrade to Base Plan
                  </button>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-red-800 uppercase tracking-wide">Confirm Downgrade to Base</p>
                      <p className="text-xs text-red-600 mt-1">
                        This will hide Invoicing, Analytics, and CRM notes. Your existing data will be kept but hidden.
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={handleDowngrade}
                        disabled={saving}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors"
                      >
                        {saving ? "Downgrading..." : "Yes, Downgrade"}
                      </button>
                      <button
                        onClick={() => setShowConfirmDowngrade(false)}
                        className="px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
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
      <LicenseSection isSuperuser={isSuperuser} onShowToast={onShowToast} onLicenseChanged={onLicenseChanged} />

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
    </div>
  );
}
