"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import Modal, { ModalHeader, Field, inputCls } from "../shared/Modal";
import { classifyFieldUrl } from "@/lib/fieldAccessUrl";

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
 * Field access is served over an HTTPS tunnel, so the working shape is
 * `https://<customer-host>/field` with no port. QR generation is refused
 * while the URL is localhost so a broken code is never handed to a tech.
 */
export default function FieldAccessModal({ onClose }: Props) {
  // The modal only mounts in the browser (opened by a click), so window and
  // localStorage are safe to read in the initializer. This is just the
  // first-paint guess — the server value (fetched below) is authoritative.
  const [url, setUrl] = useState(
    () => localStorage.getItem("wvo.fieldAccessUrl") ?? `${window.location.origin}/field`
  );
  const [qr, setQr] = useState<string | null>(null);
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

  const { isLocalhost, isPlainHttp } = classifyFieldUrl(url);

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
          placeholder="https://acme.whitevanops.com/field"
        />
      </Field>

      {isLocalhost && (
        <p className="text-[11px] text-red-600 leading-relaxed font-medium">
          This is a localhost address — a phone scanning it will get
          &quot;localhost is unreachable,&quot; not the field module. Enter
          the tunnel address instead (e.g.{" "}
          <span className="font-mono">https://acme.whitevanops.com/field</span>
          ) — the QR code below is disabled until this is fixed.
        </p>
      )}
      {isPlainHttp && (
        <p className="text-[11px] text-amber-600 leading-relaxed">
          This is a plain <span className="font-mono">http://</span> address —
          credentials would travel unencrypted over the public internet. Field
          access is served over an HTTPS tunnel; use the{" "}
          <span className="font-mono">https://</span> address so logins are
          encrypted and the session cookie is accepted.
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
