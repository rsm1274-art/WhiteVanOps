"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import Modal, { ModalHeader, Field, inputCls } from "../shared/Modal";

interface Props {
  onClose: () => void;
}

/**
 * Shows a QR code pointing at the field module so techs can scan it with
 * their phone camera and install /field as a home-screen app. The URL
 * defaults to this browser's origin but is editable — on the office server
 * the phones reach the app via the Dynamic DNS hostname, not localhost.
 */
export default function FieldAccessModal({ onClose }: Props) {
  // The modal only mounts in the browser (opened by a click), so window and
  // localStorage are safe to read in the initializer.
  const [url, setUrl] = useState(
    () => localStorage.getItem("wvo.fieldAccessUrl") ?? `${window.location.origin}/field`
  );
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    localStorage.setItem("wvo.fieldAccessUrl", url);
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
  }, [url]);

  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url) && !isLocalhost;

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
          onChange={(e) => setUrl(e.target.value)}
          className={inputCls}
          placeholder="http://your-client.duckdns.org:3000/field"
        />
      </Field>

      {isLocalhost && (
        <p className="text-[11px] text-amber-600 leading-relaxed">
          This is a localhost address — phones can&apos;t reach it. Enter the
          server&apos;s public DDNS address (e.g. your{" "}
          <span className="font-mono">http://&lt;client&gt;.duckdns.org:3000/field</span>{" "}
          hostname) so the QR code works from a phone.
        </p>
      )}
      {isPlainHttp && (
        <p className="text-[11px] text-amber-600 leading-relaxed">
          Plain HTTP is fine for local port forwarding with DDNS. However, ensure
          the app is configured to allow plain HTTP cookies, otherwise techs will
          not stay signed in.
        </p>
      )}

      {url && qr ? (
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
      ) : (
        <p className="text-xs text-zinc-400 text-center py-8">Enter a URL to generate a QR code.</p>
      )}
    </Modal>
  );
}
