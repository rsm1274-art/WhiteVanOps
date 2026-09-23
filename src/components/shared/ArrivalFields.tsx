import { Field, inputCls } from "@/components/shared/Modal";

/** Optional within-day arrival time + free-text window for the job modals. */
export default function ArrivalFields({
  time,
  window: win,
  onTime,
  onWindow,
}: {
  time: string;
  window: string;
  onTime: (v: string) => void;
  onWindow: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Arrival Time (optional)">
        <input type="time" value={time} onChange={(e) => onTime(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Arrival Window (optional)">
        <input
          type="text"
          maxLength={40}
          placeholder="e.g. 8–10 AM, PM"
          value={win}
          onChange={(e) => onWindow(e.target.value)}
          className={inputCls}
        />
      </Field>
    </div>
  );
}
