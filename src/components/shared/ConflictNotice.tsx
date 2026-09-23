import { ClientConflicts } from "@/lib/clientJobConflicts";

/** Live availability notice for the job modals: red = will be refused, amber = allowed after confirm. */
export default function ConflictNotice({ conflicts }: { conflicts: ClientConflicts }) {
  const { blocking, advisory } = conflicts;
  return (
    <>
      {blocking.length > 0 && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-900 space-y-1">
          <p className="font-bold uppercase tracking-wider text-[10px]">Unavailable — can&apos;t be booked</p>
          {blocking.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      {advisory.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
          <p className="font-bold uppercase tracking-wider text-[10px]">Already booked this day — you&apos;ll be asked to confirm</p>
          {advisory.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
    </>
  );
}
