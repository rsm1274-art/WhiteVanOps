"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import Modal, { ModalHeader, Field, inputCls } from "../shared/Modal";
import { fieldUrlVerdict } from "@/lib/fieldAccessUrl";

interface Props {
  onClose: () => void;
}

const SETTING_KEY = "field_access_url";

/**
 * Shows a QR code pointing at the field module so techs can scan it with
 * their phone camera and install /field as a home-screen app. The URL is
 * persisted server-side (SystemSetting), not just this browser's
 * localStorage — otherwise a fresh browser/profile/device falls back to
 * `window.location.origin`, which on the Electron desktop app is always
 * `http://localhost:3000` and produces a QR code that only "works" on the
 * machine running the dashboard, never on a phone (ERR_CONNECTION_FAILED).
 *
 * WhiteVanOps v2.0 syncs the field module over the office LAN only, so
 * `http://<office-lan-ip>:3000/field` is right and must NOT be warned about as
 * insecure — it never leaves the building. QR generation is refused only
 * while the URL is localhost, so a broken code is never handed to a tech.
 */
export default function FieldAccessModal({ onClose }: Props) {
  // The modal only mounts in the browser (opened by a click), so window and
  // localStorage are safe to read in the initializer. This is just the
  // first-paint guess — the server value (fetched below) is authoritative.
  const [url, setUrl] = useState(
    () => localStorage.getItem("wvo.fieldAccessUrl") ?? `${window.location.origin}/field`
  );
  const [qr, setQr] = useState<string | null>(null);
  const [detected, setDetected] = useState<string[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settings?key=${SETTING_KEY}`)
      .then((res) => res.json())
      .then((setting: { value?: string }) => {
        if (!cancelled && setting?.value) {
          setUrl(setting.value);
          localStorage.setItem("wvo.fieldAccessUrl", setting.value);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/field-access/lan-address")
      .then((res) => res.json())
      .then((data: { addresses?: string[] }) => {
        if (!cancelled && Array.isArray(data?.addresses)) setDetected(data.addresses);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function handleUrlChange(next: string) {
    setUrl(next);
    localStorage.setItem("wvo.fieldAccessUrl", next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SETTING_KEY, value: next }),
      }).catch(() => {});
    }, 500);
  }

  const verdict = fieldUrlVerdict(url);
  const isLocalhost = verdict === "localhost";

  useEffect(() => {
    // Render guards on `!isLocalhost` too, so no need to clear `qr` here —
    // avoids a synchronous setState-in-effect on the localhost branch.
    if (!url || isLocalhost) return;
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#18181b", light: "#ffffff" },
    })
      .then((dataUrl) => { if (!cancelled) setQr(dataUrl); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [url, isLocalhost]);

  return (
    <Modal onClose={onClose} maxWidth="sm">
      <ModalHeader
        title="Field Tech Access"
        subtitle="Scan to open the field module on a phone"
        onClose={onClose}
      />

      <Field label="Field Module URL">
        <input
          type="url"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          className={inputCls}
          placeholder="http://192.168.1.20:3000/field"
        />
      </Field>

      {detected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span>Use detected address:</span>
          {detected.map((addr) => (
            <button
              key={addr}
              type="button"
              onClick={() => {
                const port = window.location.port || "3000";
                handleUrlChange(`http://${addr}:${port}/field`);
              }}
              className="font-mono px-2 py-1 rounded border border-zinc-300 hover:bg-zinc-100"
            >
              {addr}
            </button>
          ))}
        </div>
      )}

      {verdict === "localhost" && (
        <p className="text-[11px] text-red-600 leading-relaxed font-medium">
          This is a localhost address — a phone scanning it will get
          &quot;localhost is unreachable,&quot; not the field module. Use this
          machine&apos;s office-network address instead — the QR code below is
          disabled until this is fixed.
        </p>
      )}
      {verdict === "ok-lan" && (
        <p className="text-[11px] text-emerald-700 leading-relaxed">
          Office-network address. Techs sync while on your WiFi; work done away
          from the building is held on the phone and saved when they return.
        </p>
      )}
      {verdict === "not-lan" && (
        <p className="text-[11px] text-amber-600 leading-relaxed">
          This is not an office-network address. WhiteVanOps serves the field
          module over your office WiFi only, so a phone will not be able to
          reach it here. Use the detected address above.
        </p>
      )}

      {url && qr && !isLocalhost ? (
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for field module" className="w-60 h-60 border border-zinc-200 rounded" />
          <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
            <Smartphone className="inline h-3 w-3 mr-1 -mt-0.5" />
            Scan with the phone camera, sign in, then use the browser&apos;s{" "}
            <span className="font-semibold">&quot;Add to Home Screen&quot;</span>{" "}
            (iPhone: Share → Add to Home Screen · Android: menu → Install app)
            to install it like an app.
          </p>
        </div>
      ) : isLocalhost ? (
        <p className="text-xs text-zinc-400 text-center py-8">Fix the address above to generate a working QR code.</p>
      ) : (
        <p className="text-xs text-zinc-400 text-center py-8">Enter a URL to generate a QR code.</p>
      )}
    </Modal>
  );
}
