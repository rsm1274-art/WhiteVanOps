"use client";

import Modal, { ModalHeader } from "@/components/shared/Modal";
import { Job, TimeEntry } from "@/types";
import { formatDate } from "@/lib/dateUtils";

interface Props {
  job: Job;
  timeEntries: TimeEntry[];
  onClose: () => void;
}

export default function JobCostsModal({ job, timeEntries, onClose }: Props) {
  const jobTime = timeEntries.filter((e) => e.jobId === job.id);
  const materialsTotal = job.lineItems.reduce((acc, item) => acc + item.quantity * item.rate, 0);

  return (
    <Modal onClose={onClose} maxWidth="lg">
      <ModalHeader
        title="Job Cost Allocation Ledger"
        subtitle={`JOB ID: #${job.id}`}
        onClose={onClose}
      />

      {/* Notes */}
      {job.notes && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          <span className="font-bold uppercase tracking-wider block mb-1">Scope of Work</span>
          {job.notes}
        </div>
      )}

      {/* Header info */}
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="p-3 bg-zinc-50 border border-zinc-200 rounded">
          <span className="text-[9px] font-bold uppercase text-zinc-400">Client Details</span>
          <h4 className="font-bold text-sm mt-0.5">{job.client.name}</h4>
          <p className="text-zinc-600 mt-1">{job.client.locationAddress}</p>
          <p className="text-zinc-500 text-[10px] mt-2">Billing Terms: {job.client.paymentTerms}</p>
        </div>
        <div className="p-3 bg-zinc-50 border border-zinc-200 rounded flex flex-col justify-between">
          <div>
            <span className="text-[9px] font-bold uppercase text-zinc-400">Operations Schedule</span>
            <p className="font-bold text-sm mt-0.5">Scheduled: {formatDate(job.scheduledDate)}</p>
            {job.completionDate && (
              <p className="text-emerald-700 font-semibold mt-1">
                Completed: {formatDate(job.completionDate)}
              </p>
            )}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Status: {job.status}
          </span>
        </div>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {/* Materials */}
        <div className="border border-zinc-200 rounded p-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-3 border-b border-zinc-100 pb-2">
            Materials & Parts Credited
          </h4>
          {job.lineItems.length === 0 ? (
            <p className="text-xs text-zinc-500 py-1">No materials billed to this job.</p>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-[9px] font-bold uppercase text-zinc-400 border-b border-zinc-100">
                  <th className="pb-2">Material Item</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Rate</th>
                  <th className="pb-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {job.lineItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-zinc-700">{item.inventoryItem.name}</span>
                      <span className="text-[9px] text-zinc-400 block">{item.inventoryItem.category}</span>
                    </td>
                    <td className="py-2 pr-2 font-mono">{item.quantity}</td>
                    <td className="py-2 pr-2 font-mono">${item.rate.toFixed(2)}</td>
                    <td className="py-2 text-right font-mono font-semibold text-zinc-800">
                      ${(item.quantity * item.rate).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Labor */}
        <div className="border border-zinc-200 rounded p-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-3 border-b border-zinc-100 pb-2">
            Labor Hours Credited
          </h4>
          {jobTime.length === 0 ? (
            <p className="text-xs text-zinc-500 py-1">No technician hours logged for this job yet.</p>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-[9px] font-bold uppercase text-zinc-400 border-b border-zinc-100">
                  <th className="pb-2">Technician</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Payroll Item</th>
                  <th className="pb-2 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {jobTime.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-2 pr-2 font-semibold text-zinc-700">
                      {entry.personnel.firstName} {entry.personnel.lastName}
                    </td>
                    <td className="py-2 pr-2">{formatDate(entry.date)}</td>
                    <td className="py-2 pr-2 text-zinc-500">
                      {entry.payrollItem} ({entry.serviceItem})
                    </td>
                    <td className="py-2 text-right font-mono font-bold text-zinc-800">{entry.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Equipment */}
        <div className="border border-zinc-200 rounded p-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-3 border-b border-zinc-100 pb-2">
            Equipment Assets Dispatched
          </h4>
          <div className="space-y-2">
            {job.vehicle && (
              <div className="flex justify-between items-center text-xs p-2 bg-zinc-50 border border-zinc-100 rounded">
                <div>
                  <span className="font-semibold text-zinc-700">Fleet Service Van</span>
                  <span className="text-[9px] text-zinc-400 block">Transport & mobile inventory</span>
                </div>
                <div className="text-right">
                  <span className="font-bold">{job.vehicle.make} {job.vehicle.model}</span>
                  <span className="text-[9px] font-mono text-zinc-400 block">
                    VIN: {job.vehicle.vin.substring(0, 6)}...
                  </span>
                </div>
              </div>
            )}
            {job.equipment.length === 0 && !job.vehicle ? (
              <p className="text-xs text-zinc-500 py-1">No equipment assigned to this job.</p>
            ) : (
              job.equipment.map((je) => (
                <div key={je.id} className="flex justify-between items-center text-xs p-2 bg-zinc-50 border border-zinc-100 rounded">
                  <div>
                    <span className="font-semibold text-zinc-700">{je.equipment.name}</span>
                    <span className="text-[9px] text-zinc-400 block">Specialized Tool Asset</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-zinc-700">S/N: {je.equipment.serialNumber}</span>
                    <span className="text-[9px] uppercase font-bold text-emerald-600 block">
                      {je.equipment.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-zinc-200 flex justify-between items-center text-sm font-bold">
        <span>Materials Billing Total:</span>
        <span className="text-lg font-bold text-zinc-800">${materialsTotal.toFixed(2)}</span>
      </div>
    </Modal>
  );
}
