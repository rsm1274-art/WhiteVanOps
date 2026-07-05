import { useState, useEffect } from "react";
import { Save, Server, AlertCircle } from "lucide-react";

export default function SettingsTab({ 
  onShowToast
}: { 
  onShowToast: (text: string, isError?: boolean) => void 
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
    } catch (err: any) {
      onShowToast(err.message, true);
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
    } catch (err: any) {
      onShowToast(err.message, true);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
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
