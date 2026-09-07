"use client";

import { use, useEffect, useState } from "react";

// Customer-facing quote approval page. Reached from the link in a quote, by
// someone with no account and no session — so it must explain itself with no
// prior context, and it must never assume the reader knows what this app is.

interface PublicLineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface PublicQuote {
  quoteNumber: string;
  status: string;
  issueDate: string;
  expiryDate: string;
  notes: string | null;
  respondedAt: string | null;
  respondedName: string | null;
  company: { name: string; address: string; phone: string; email: string };
  client: { name: string; contactName: string; locationAddress: string; paymentTerms: string };
  lineItems: PublicLineItem[];
  total: number;
  canRespond: boolean;
}

const money = (n: number) => `$${n.toFixed(2)}`;

const INPUT_CLASS =
  "w-full px-3 py-2 bg-white border border-zinc-300 rounded text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700";
const LABEL_CLASS = "text-xs font-semibold uppercase tracking-wider text-zinc-500";

export default function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"idle" | "approving" | "declining">("idle");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch is inlined here (rather than an async helper called from the effect
  // body) so no state is set on the synchronous path, and `cancelled` drops a
  // late response if the token changes mid-flight.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/quotes/${token}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            res.status === 404
              ? "We could not find this quote. The link may be incorrect or no longer active."
              : "We could not load this quote. Please try again shortly."
          );
          return;
        }
        setQuote(await res.json());
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("We could not reach the server. Please check your connection and try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(action: "approve" | "decline") {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/quotes/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "We could not record your response. Please try again.");
        return;
      }
      setQuote(data);
      setMode("idle");
    } catch {
      setSubmitError("We could not reach the server. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-500">Loading quote…</p>
      </main>
    );
  }

  if (loadError || !quote) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
        <div className="w-full max-w-md bg-white border border-zinc-300 rounded p-8 text-center">
          <h1 className="text-lg font-bold text-zinc-900 mb-2">Quote unavailable</h1>
          <p className="text-sm text-zinc-600">{loadError}</p>
        </div>
      </main>
    );
  }

  const decided = quote.status === "Approved" || quote.status === "Converted" || quote.status === "Declined";

  return (
    <main className="min-h-screen bg-zinc-50 py-8 px-4">
      <div className="w-full max-w-2xl mx-auto space-y-4">
        {/* Who this is from */}
        <header className="bg-white border border-zinc-300 rounded p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-zinc-900">{quote.company.name}</h1>
              <p className="text-sm text-zinc-500">{quote.company.address}</p>
              {(quote.company.phone || quote.company.email) && (
                <p className="text-xs text-zinc-500 mt-1">
                  {[quote.company.phone, quote.company.email].filter(Boolean).join("  ·  ")}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className={LABEL_CLASS}>Quote</p>
              <p className="text-lg font-bold text-zinc-900">{quote.quoteNumber}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-zinc-200">
            <div>
              <p className={LABEL_CLASS}>Prepared for</p>
              <p className="text-sm font-semibold text-zinc-900 mt-1">{quote.client.name}</p>
              <p className="text-xs text-zinc-500">{quote.client.contactName}</p>
            </div>
            <div>
              <p className={LABEL_CLASS}>Issued</p>
              <p className="text-sm text-zinc-900 mt-1">{quote.issueDate}</p>
            </div>
            <div>
              <p className={LABEL_CLASS}>Valid until</p>
              <p className="text-sm text-zinc-900 mt-1">{quote.expiryDate}</p>
            </div>
          </div>
        </header>

        {/* What is being quoted */}
        <section className="bg-white border border-zinc-300 rounded p-6 sm:p-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className={`${LABEL_CLASS} text-left pb-2`}>Description</th>
                  <th className={`${LABEL_CLASS} text-right pb-2 w-16`}>Qty</th>
                  <th className={`${LABEL_CLASS} text-right pb-2 w-24`}>Rate</th>
                  <th className={`${LABEL_CLASS} text-right pb-2 w-28`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.lineItems.map((li, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="py-2.5 text-zinc-900">{li.description}</td>
                    <td className="py-2.5 text-right text-zinc-600">{li.quantity}</td>
                    <td className="py-2.5 text-right text-zinc-600">{money(li.rate)}</td>
                    <td className="py-2.5 text-right text-zinc-900">{money(li.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end items-baseline gap-6 mt-4">
            <span className={LABEL_CLASS}>Total</span>
            <span className="text-xl font-bold text-zinc-900">{money(quote.total)}</span>
          </div>

          {quote.notes && (
            <div className="mt-6 pt-4 border-t border-zinc-200">
              <p className={LABEL_CLASS}>Notes</p>
              <p className="text-sm text-zinc-700 mt-1 whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          <p className="text-xs text-zinc-500 mt-6">
            Payment terms on acceptance: {quote.client.paymentTerms}. This quote is valid until {quote.expiryDate}.
          </p>
        </section>

        {/* The decision */}
        <section className="bg-white border border-zinc-300 rounded p-6 sm:p-8">
          {decided ? (
            <div className="text-center">
              <p className="text-sm font-semibold text-zinc-900">
                {quote.status === "Declined" ? "You declined this quote." : "Thank you — you accepted this quote."}
              </p>
              {quote.respondedAt && (
                <p className="text-xs text-zinc-500 mt-1">
                  Recorded on {quote.respondedAt}
                  {quote.respondedName ? ` by ${quote.respondedName}` : ""}.
                </p>
              )}
              <p className="text-xs text-zinc-500 mt-3">
                Any questions? Contact {quote.company.name}
                {quote.company.phone ? ` on ${quote.company.phone}` : ""}.
              </p>
            </div>
          ) : !quote.canRespond ? (
            <div className="text-center">
              <p className="text-sm font-semibold text-zinc-900">This quote is no longer open for a response.</p>
              <p className="text-xs text-zinc-500 mt-1">
                Please contact {quote.company.name}
                {quote.company.phone ? ` on ${quote.company.phone}` : ""} for an updated price.
              </p>
            </div>
          ) : mode === "idle" ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setMode("approving");
                  setSubmitError(null);
                }}
                className="flex-1 py-3 bg-blue-700 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-800 transition-colors"
              >
                Accept this quote
              </button>
              <button
                onClick={() => {
                  setMode("declining");
                  setSubmitError(null);
                }}
                className="flex-1 py-3 bg-white border border-zinc-300 text-zinc-700 text-xs font-bold uppercase tracking-widest rounded hover:bg-zinc-50 transition-colors"
              >
                Decline
              </button>
            </div>
          ) : mode === "approving" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className={LABEL_CLASS} htmlFor="approver-name">
                  Type your full name to accept
                </label>
                <input
                  id="approver-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  maxLength={100}
                  className={INPUT_CLASS}
                />
                <p className="text-xs text-zinc-500">
                  Accepting records your name and the date against this quote as your approval of the price above.
                </p>
              </div>
              {submitError && <p className="text-xs text-red-600 font-medium">{submitError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => submit("approve")}
                  disabled={submitting || name.trim().length < 2}
                  className="flex-1 py-3 bg-blue-700 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Sending…" : "Confirm acceptance"}
                </button>
                <button
                  onClick={() => setMode("idle")}
                  disabled={submitting}
                  className="px-5 py-3 bg-white border border-zinc-300 text-zinc-700 text-xs font-bold uppercase tracking-widest rounded hover:bg-zinc-50 transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className={LABEL_CLASS} htmlFor="decline-reason">
                  Reason (optional)
                </label>
                <textarea
                  id="decline-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Anything you would like us to know"
                  className={INPUT_CLASS}
                />
              </div>
              {submitError && <p className="text-xs text-red-600 font-medium">{submitError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => submit("decline")}
                  disabled={submitting}
                  className="flex-1 py-3 bg-zinc-800 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-zinc-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Sending…" : "Confirm decline"}
                </button>
                <button
                  onClick={() => setMode("idle")}
                  disabled={submitting}
                  className="px-5 py-3 bg-white border border-zinc-300 text-zinc-700 text-xs font-bold uppercase tracking-widest rounded hover:bg-zinc-50 transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
