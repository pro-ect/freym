import { useEffect, useState } from "react";
import { fetchBalance, startCoinCheckout, usd, type CoinPack } from "./lib/balance";

const PACKS: { pack: CoinPack; label: string }[] = [
  { pack: "freym-2500", label: "Top up $5" },
  { pack: "freym-7500", label: "Top up $15" },
  { pack: "freym-15000", label: "Top up $30" },
];

/**
 * Coin balance + buy-coins modal, mounted on both the projects screen and the
 * canvas top bar. Refreshes on `fc-balance-refresh` (jobs settling) and opens
 * the modal on `fc-buy-coins` (runner's insufficient-balance signal). Handles
 * the ?checkout=coins_success|cancel return from Stripe.
 */
export default function BalancePill() {
  const [balance, setBalance] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CoinPack | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => fetchBalance().then(setBalance);

  useEffect(() => {
    void refresh();

    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout) {
      params.delete("checkout");
      const qs = params.toString();
      history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      if (checkout === "coins_success") {
        setToast("Payment received — adding your coins…");
        // The stripe-webhook credit can land a few seconds after the redirect.
        const t1 = setTimeout(refresh, 2500);
        const t2 = setTimeout(() => { void refresh(); setToast(null); }, 8000);
        return () => { clearTimeout(t1); clearTimeout(t2); };
      }
    }

    const onRefresh = () => void refresh();
    const onBuy = () => setOpen(true);
    window.addEventListener("fc-balance-refresh", onRefresh);
    window.addEventListener("fc-buy-coins", onBuy);
    return () => {
      window.removeEventListener("fc-balance-refresh", onRefresh);
      window.removeEventListener("fc-buy-coins", onBuy);
    };
  }, []);

  const buy = async (pack: CoinPack) => {
    if (busy) return;
    setBusy(pack);
    setErr(null);
    const { error } = await startCoinCheckout(pack);
    if (error) {
      setErr(error);
      setBusy(null);
    } // on success the page navigates to Stripe
  };

  return (
    <>
      <button className="fc-balance" title="Balance — click to top up" onClick={() => setOpen(true)}>
        {balance == null ? "…" : usd(balance)}
      </button>
      {toast && <span className="fc-toast">{toast}</span>}
      {open && (
        <div className="fc-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="fc-modal">
            <h2>Top up</h2>
            <p className="fc-modal-sub">
              $1 in equals $1 of generations — every model shows its price
              before you run it. One-time payment, no subscription, credit
              never expires. Checkout runs on Stripe.
            </p>
            {PACKS.map(({ pack, label }) => (
              <button key={pack} className="fc-primary fc-pack" disabled={busy !== null} onClick={() => buy(pack)}>
                {busy === pack ? "Opening checkout…" : label}
              </button>
            ))}
            {err && <div className="fc-error">{err}</div>}
            <button className="fc-signout" onClick={() => setOpen(false)}>close</button>
          </div>
        </div>
      )}
    </>
  );
}
