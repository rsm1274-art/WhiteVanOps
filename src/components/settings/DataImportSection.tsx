import { useState } from "react";
import { Upload, AlertTriangle, Play, RefreshCw, FileSpreadsheet, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { ENTITY_META, type EntityName, type Mapping, type FileMapping } from "@/lib/import/mappingSchema";

export function DataImportSection({
  onShowToast,
}: {
  onShowToast: (text: string, isError?: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [proposedMapping, setProposedMapping] = useState<Mapping | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [filesMetadata, setFilesMetadata] = useState<any[]>([]);
  
  // Mapper configuration states
  const [expandedFileIndex, setExpandedFileIndex] = useState<number | null>(0);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [clearDatabase, setClearDatabase] = useState(false);
  const [skipRejected, setSkipRejected] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [confirmingExecute, setConfirmingExecute] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      onShowToast("Please select files to upload", true);
      return;
    }

    setLoading(true);
    setValidationResult(null);
    setImportResult(null);
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));

    try {
      const res = await fetch("/api/settings/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze files");
      
      setProposedMapping(data.mapping);
      setNotes(data.notes || []);
      setFilesMetadata(data.files || []);
      onShowToast("Files successfully analyzed and proposed mappings generated!");
    } catch (err: any) {
      onShowToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleEntityChange = (fileIndex: number, entity: string) => {
    if (!proposedMapping) return;
    const nextMapping = { ...proposedMapping };
    
    if (entity === "skip") {
      // Remove from active files mapping list or mark as skipped
      nextMapping.files = nextMapping.files.filter((_, idx) => idx !== fileIndex);
      // Re-align metadata index
      const nextMeta = [...filesMetadata];
      nextMeta.splice(fileIndex, 1);
      setFilesMetadata(nextMeta);
    } else {
      const fm = nextMapping.files[fileIndex];
      fm.entity = entity as EntityName;
      // Reset columns when changing entity
      fm.columns = {};
      fm.unresolved = Object.entries(ENTITY_META[fm.entity].fields)
        .filter(([_, f]) => f.required)
        .map(([field]) => field);
    }
    
    setProposedMapping(nextMapping);
    setValidationResult(null);
  };

  const handleColumnMappingChange = (fileIndex: number, columnName: string, targetField: string) => {
    if (!proposedMapping) return;
    const nextMapping = { ...proposedMapping };
    const fm = nextMapping.files[fileIndex];
    const meta = ENTITY_META[fm.entity];

    if (targetField === "skip") {
      delete fm.columns[columnName];
    } else if (targetField === "sourceKey") {
      fm.columns[columnName] = { role: "sourceKey" };
    } else {
      const f = meta.fields[targetField];
      const resolveBy = f.resolvesTo
        ? f.resolvesTo === "Job"
          ? "Job.sourceKey"
          : `${f.resolvesTo}.${(ENTITY_META[f.resolvesTo].naturalKey ?? []).join("+")}`
        : undefined;

      fm.columns[columnName] = {
        field: targetField,
        ...(resolveBy ? { resolveBy } : {}),
      };
    }

    // Recompute unresolved fields
    const covered = new Set(Object.values(fm.columns).map((c) => c.field).filter(Boolean) as string[]);
    Object.keys(fm.defaults ?? {}).forEach((d) => covered.add(d));
    fm.unresolved = Object.entries(meta.fields)
      .filter(([name, f]) => f.required && !covered.has(name))
      .map(([name]) => name);

    setProposedMapping(nextMapping);
    setValidationResult(null);
  };

  const handleDefaultChange = (fileIndex: number, fieldName: string, value: string) => {
    if (!proposedMapping) return;
    const nextMapping = { ...proposedMapping };
    const fm = nextMapping.files[fileIndex];
    
    fm.defaults = fm.defaults || {};
    if (value === "") {
      delete fm.defaults[fieldName];
    } else {
      fm.defaults[fieldName] = value;
    }

    // Recompute unresolved
    const covered = new Set(Object.values(fm.columns).map((c) => c.field).filter(Boolean) as string[]);
    Object.keys(fm.defaults).forEach((d) => covered.add(d));
    fm.unresolved = Object.entries(ENTITY_META[fm.entity].fields)
      .filter(([name, f]) => f.required && !covered.has(name))
      .map(([name]) => name);

    setProposedMapping(nextMapping);
    setValidationResult(null);
  };

  const handleValueMapChange = (targetKey: string, sourceValue: string, targetValue: string) => {
    if (!proposedMapping) return;
    const nextMapping = { ...proposedMapping };
    nextMapping.valueMaps = nextMapping.valueMaps || {};
    nextMapping.valueMaps[targetKey] = nextMapping.valueMaps[targetKey] || {};
    nextMapping.valueMaps[targetKey][sourceValue] = targetValue;
    setProposedMapping(nextMapping);
    setValidationResult(null);
  };

  const handleValidate = async () => {
    if (!proposedMapping) return;
    setLoading(true);
    setValidationResult(null);

    try {
      const res = await fetch("/api/settings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", mapping: proposedMapping }),
      });
      const data = await res.json();
      setValidationResult(data);
      if (data.ok) {
        onShowToast("Mapping validation successful! Ready to import.");
      } else {
        onShowToast("Validation failed. Please resolve mapping issues first.", true);
      }
    } catch (err: any) {
      onShowToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!proposedMapping) return;
    setConfirmingExecute(false);

    setLoading(true);
    try {
      const res = await fetch("/api/settings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          mapping: proposedMapping,
          clearDatabase,
          skipRejected,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to execute import");

      setImportResult(data);
      onShowToast("Data successfully imported!");
      // Reset config
      setProposedMapping(null);
      setFiles([]);
    } catch (err: any) {
      onShowToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded shadow-sm border border-zinc-200 mt-6">
      <div className="border-b border-zinc-100 p-6 flex items-center gap-3">
        <div className="p-2 bg-blue-50 text-blue-600 rounded">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-800">Onboarding Data Import</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Import existing data files (CSV, Excel) and map columns to WhiteVanOps tables.
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Upload Files Section */}
        <div className="border border-dashed border-zinc-300 rounded p-6 bg-zinc-50 flex flex-col items-center justify-center gap-4 text-center">
          <Upload className="h-8 w-8 text-zinc-400" />
          <div>
            <p className="text-sm font-semibold text-zinc-700">Select files to upload for import</p>
            <p className="text-xs text-zinc-400 mt-1">Supports multiple CSV (.csv) or Excel (.xlsx) files</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="file"
              multiple
              accept=".csv,.xlsx"
              onChange={handleFileChange}
              className="hidden"
              id="import-file-input"
            />
            <label
              htmlFor="import-file-input"
              className="px-4 py-2 bg-white hover:bg-zinc-100 border border-zinc-300 rounded text-xs font-semibold text-zinc-700 transition-colors uppercase tracking-wider cursor-pointer"
            >
              Choose Files
            </label>
            {files.length > 0 && (
              <button
                onClick={handleUpload}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 transition-colors uppercase tracking-wider disabled:opacity-50"
              >
                {loading ? "Analyzing..." : "Analyze & Map"}
              </button>
            )}
          </div>
          {files.length > 0 && (
            <div className="text-xs text-zinc-500 font-mono mt-2">
              Selected: {files.map((f) => f.name).join(", ")}
            </div>
          )}
        </div>

        {/* Notes / Warnings from Analysis */}
        {notes.length > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 space-y-1.5">
            <div className="flex items-center gap-2 font-bold mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Analysis Notes & Warnings
            </div>
            <ul className="list-disc pl-5 text-xs space-y-1">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Mapping proposals & Mapper Forms */}
        {proposedMapping && proposedMapping.files.map((fm, fileIdx) => {
          const isExpanded = expandedFileIndex === fileIdx;
          const meta = filesMetadata.find(m => m.file === fm.file && m.sheet === fm.sheet);
          
          return (
            <div key={fileIdx} className="border border-zinc-200 rounded overflow-hidden">
              <button
                onClick={() => setExpandedFileIndex(isExpanded ? null : fileIdx)}
                className="w-full flex items-center justify-between p-4 bg-zinc-50 border-b border-zinc-200 text-left hover:bg-zinc-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-zinc-500" />
                  <div>
                    <span className="font-semibold text-sm text-zinc-800">
                      {fm.file}{fm.sheet ? ` (#${fm.sheet})` : ""}
                    </span>
                    <span className="ml-3 px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded uppercase">
                      Maps to: {fm.entity}
                    </span>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
              </button>

              {isExpanded && (
                <div className="p-6 space-y-6">
                  {/* Entity selector */}
                  <div className="flex items-center gap-4 border-b border-zinc-100 pb-4">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Map to Entity:</label>
                    <select
                      value={fm.entity}
                      onChange={(e) => handleEntityChange(fileIdx, e.target.value)}
                      className="border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-sm p-1.5 border bg-white"
                    >
                      {Object.keys(ENTITY_META).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      <option value="skip">-- Skip this File/Sheet --</option>
                    </select>
                  </div>

                  {/* Column mappings */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600">Column Mapping</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {meta && meta.headers.map((header: string) => {
                        const colMapping = fm.columns[header];
                        const selectedVal = colMapping?.role === "sourceKey"
                          ? "sourceKey"
                          : colMapping?.field || "skip";
                        
                        return (
                          <div key={header} className="flex items-center justify-between p-3 bg-zinc-50 border border-zinc-200 rounded text-xs">
                            <span className="font-mono font-bold text-zinc-700 truncate" title={header}>{header}</span>
                            <select
                              value={selectedVal}
                              onChange={(e) => handleColumnMappingChange(fileIdx, header, e.target.value)}
                              className="border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-xs p-1 border bg-white"
                            >
                              <option value="skip">-- Skip Column --</option>
                              {fm.entity === "Job" && <option value="sourceKey">Source Key (Job ID/Ticket)</option>}
                              {Object.entries(ENTITY_META[fm.entity].fields).map(([name, field]) => (
                                <option key={name} value={name}>
                                  {name} {field.required ? "*" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Defaults section if unresolved required fields exist */}
                  {fm.unresolved.length > 0 && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-800">Missing Required Fields (Provide Defaults)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {fm.unresolved.map((field) => (
                          <div key={field} className="space-y-1">
                            <label className="block text-xs font-semibold text-blue-700">{field}:</label>
                            <input
                              type="text"
                              value={fm.defaults?.[field] || ""}
                              onChange={(e) => handleDefaultChange(fileIdx, field, e.target.value)}
                              placeholder={`Default value for ${field}...`}
                              className="w-full border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-xs p-2 border bg-white"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Value maps configurations */}
        {proposedMapping && proposedMapping.valueMaps && Object.keys(proposedMapping.valueMaps).length > 0 && (
          <div className="border border-zinc-200 rounded p-6 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800 border-b border-zinc-100 pb-2">
              Value Mapping Transformations
            </h3>
            <p className="text-xs text-zinc-500">
              Transform unrecognized text categories in your source data into correct WhiteVanOps database enum formats.
            </p>
            <div className="space-y-4">
              {Object.entries(proposedMapping.valueMaps).map(([targetKey, mappings]) => {
                const [entity, field] = targetKey.split(".");
                const allowedValues = ENTITY_META[entity as EntityName]?.fields?.[field]?.enumValues || [];
                
                return (
                  <div key={targetKey} className="space-y-2 p-3 bg-zinc-50 border border-zinc-200 rounded">
                    <span className="text-xs font-bold text-zinc-700">{entity} - {field}</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(mappings).map(([sourceValue, targetValue]) => (
                        <div key={sourceValue} className="flex items-center justify-between text-xs bg-white p-2 border border-zinc-200 rounded">
                          <span className="font-mono text-zinc-600 shrink-0 pr-2">"{sourceValue}" →</span>
                          <select
                            value={targetValue}
                            onChange={(e) => handleValueMapChange(targetKey, sourceValue, e.target.value)}
                            className="border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 text-xs p-1 border bg-white font-semibold text-zinc-800"
                          >
                            <option value="UNRESOLVED">-- Select Allowed Value --</option>
                            {allowedValues.map((val) => (
                              <option key={val} value={val}>{val}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Dry run / Execute block */}
        {proposedMapping && (
          <div className="border-t border-zinc-100 pt-6 space-y-4">
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearDatabase}
                    onChange={(e) => setClearDatabase(e.target.checked)}
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                  />
                  Wipe Transactional DB First
                </label>
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipRejected}
                    onChange={(e) => setSkipRejected(e.target.checked)}
                    className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                  />
                  Skip Rejected Rows
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleValidate}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 border border-zinc-300 hover:bg-zinc-100 text-zinc-700 text-xs font-bold uppercase tracking-wider rounded transition-colors"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Dry Run (Validate)
                </button>
                <button
                  onClick={() => setConfirmingExecute(true)}
                  disabled={loading || (validationResult && !validationResult.ok)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  Commit Import
                </button>
              </div>
            </div>

            {/* Commit confirmation — an in-app banner, not window.confirm(): a native
                dialog that returns false (a stray click, a webview quirk, focus loss)
                leaves the user with zero feedback and looks like the button did nothing. */}
            {confirmingExecute && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded flex items-center justify-between gap-4">
                <span className="text-sm text-amber-800 font-semibold">
                  Commit these imported records to the database? This cannot be undone.
                </span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmingExecute(false)}
                    className="px-3 py-1.5 border border-zinc-300 hover:bg-zinc-100 text-zinc-700 text-xs font-bold uppercase tracking-wider rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecute}
                    disabled={loading}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-50"
                  >
                    Yes, Commit
                  </button>
                </div>
              </div>
            )}

            {/* Validation Dry-Run Result summary */}
            {validationResult && (
              <div className={`p-5 rounded border ${validationResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"} space-y-4`}>
                <div className="flex items-center gap-2 font-bold text-sm">
                  {validationResult.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
                  {validationResult.ok ? "Dry Run Succeeded" : "Dry Run Failed (Errors Found)"}
                </div>
                
                {validationResult.errors && validationResult.errors.length > 0 && (
                  <ul className="list-disc pl-5 text-xs space-y-1 font-mono">
                    {validationResult.errors.map((e: string, i: number) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}

                {validationResult.summary && (
                  <div className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Planned Imports:</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {Object.entries(validationResult.summary).map(([entity, sum]: any) => (
                        <div key={entity} className="bg-white p-2.5 rounded border border-zinc-200 text-xs flex flex-col">
                          <span className="font-bold text-zinc-800">{entity}</span>
                          <span className="text-zinc-500 mt-1">Planned: <span className="font-semibold text-zinc-700">{sum.planned}</span></span>
                          <span className="text-zinc-500">Rejected: <span className="font-semibold text-red-600">{sum.rejected}</span></span>
                          <span className="text-zinc-500">Skipped: <span className="font-semibold text-amber-600">{sum.skipped}</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {validationResult.rejected && validationResult.rejected.length > 0 && (
                  <div className="space-y-1.5 border-t border-zinc-200/50 pt-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-red-800">Rejected Rows Details:</span>
                    <ul className="list-decimal pl-5 text-xs font-mono max-h-40 overflow-y-auto space-y-1 bg-white border border-red-100 rounded p-2">
                      {validationResult.rejected.map((r: any, i: number) => (
                        <li key={i} className="text-red-700">
                          {r.file}:{r.row} [{r.entity}] - {r.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Execute Import Result */}
            {importResult && importResult.ok && (
              <div className="p-5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded space-y-4">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Import Execution Succeeded!
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Successfully Created Records:</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {Object.entries(importResult.created).map(([entity, count]: any) => (
                      <div key={entity} className="bg-white p-2.5 rounded border border-emerald-200 text-xs flex flex-col text-emerald-900">
                        <span className="font-bold">{entity}</span>
                        <span className="font-bold text-lg mt-1">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
