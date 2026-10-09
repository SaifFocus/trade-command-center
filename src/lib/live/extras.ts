// Pure helpers for the K4 tax export and Invo mirror tickets. No I/O.

export type ClosedLive = {
  exit_t: string; coin: string; side: string; init_size: number | string | null; entry_px: number | string | null; exit_px: number | string | null;
  realized_pnl_usd: number | string | null; fees_usd: number | string | null; funding_usd: number | string | null; net_usd: number | string | null;
  usd_sek_at_exit: number | string | null; network?: string;
};

export type TaxRow = {
  date: string; coin: string; side: string; size: number; entry_px: number; exit_px: number;
  realized_usd: number; fees_usd: number; funding_usd: number; net_usd: number; usd_sek: number; net_sek: number;
};

const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v)) || 0;

/** One row per closed mainnet trade in `year` (Stockholm date of the close). */
export function taxRows(positions: ClosedLive[], year: number): TaxRow[] {
  return positions
    .filter((p) => (p.network ?? "mainnet") === "mainnet" && p.exit_t)
    .map((p) => {
      const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(p.exit_t));
      const usdSek = n(p.usd_sek_at_exit);
      return {
        date, coin: p.coin, side: p.side, size: n(p.init_size), entry_px: n(p.entry_px), exit_px: n(p.exit_px),
        realized_usd: n(p.realized_pnl_usd), fees_usd: n(p.fees_usd), funding_usd: n(p.funding_usd), net_usd: n(p.net_usd),
        usd_sek: usdSek, net_sek: n(p.net_usd) * usdSek,
      };
    })
    .filter((r) => r.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Totals for K4 section D (other assets). An estimate to check against Skatteverket's rules, not tax advice. */
export function k4Summary(rows: TaxRow[]) {
  const gains = rows.filter((r) => r.net_sek > 0).reduce((a, r) => a + r.net_sek, 0);
  const losses = rows.filter((r) => r.net_sek < 0).reduce((a, r) => a - r.net_sek, 0);
  const deductible = losses * 0.7;
  const taxable = gains - deductible;
  return {
    trades: rows.length,
    gains_sek: Math.round(gains),
    losses_sek: Math.round(losses),
    deductible_losses_sek: Math.round(deductible),
    net_sek: Math.round(taxable),
    tax_estimate_sek: Math.round(Math.max(0, taxable) * 0.3),
  };
}

/** Semicolon-separated CSV with decimal commas, which Swedish Excel opens directly. */
export function taxCsv(rows: TaxRow[]): string {
  const dec = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
  const head = ["Datum", "Coin", "Riktning", "Storlek", "Ingångspris USD", "Utgångspris USD", "Resultat USD", "Avgifter USD", "Funding USD", "Netto USD", "USD/SEK", "Netto SEK"];
  const lines = rows.map((r) => [
    r.date, r.coin, r.side === "long" ? "Lång" : "Kort", dec(r.size, 6), dec(r.entry_px, 6), dec(r.exit_px, 6),
    dec(r.realized_usd, 4), dec(r.fees_usd, 4), dec(r.funding_usd, 4), dec(r.net_usd, 4), dec(r.usd_sek, 4), dec(r.net_sek, 2),
  ].join(";"));
  return [head.join(";"), ...lines].join("\r\n");
}

export type TicketSignal = { coin: string; side: string; setup: string; ref_px: number | string; stop_px: number | string; t1_px: number | string; t2_px: number | string; status: string; created_at: string };

/**
 * A ready-to-copy ticket for placing the same trade by hand in Invo, sized for a separate Invo budget.
 * Invo's Mimic copies take-profit, leverage and size but NOT the stop, so the ticket says to set it by hand.
 */
export function invoTicket(s: TicketSignal, invoBudgetSek: number, usdSek: number, riskPct = 1.5) {
  const ref = n(s.ref_px), stop = n(s.stop_px), dir = s.side === "long" ? 1 : -1;
  const lev = s.coin === "BTC" || s.coin === "ETH" ? 5 : 3;
  const stopDist = Math.abs(ref - stop) / ref;
  const budgetUsd = usdSek > 0 ? invoBudgetSek / usdSek : 0;
  const riskUsd = (budgetUsd * riskPct) / 100;
  const notional = stopDist > 0 ? Math.max(10, riskUsd / stopDist) : 0;
  const margin = notional / lev;
  const p = (x: number) => (x >= 1000 ? x.toFixed(1) : x.toPrecision(5));
  const fits = margin <= budgetUsd;
  return {
    fits,
    text: [
      `${s.coin} ${s.side.toUpperCase()} (${s.setup})`,
      `Entry: market now, only if price is ${dir > 0 ? "at or below" : "at or above"} ${p(ref * (1 + dir * 0.003))}`,
      `Leverage: ${lev}x isolated · margin ≈ $${margin.toFixed(2)} (${(margin * usdSek).toFixed(0)} SEK) · position ≈ $${notional.toFixed(2)}`,
      `STOP-LOSS ${p(stop)} — set it yourself in Invo (Mimic does not copy stops)`,
      `Take profit: half at ${p(n(s.t1_px))}, rest at ${p(n(s.t2_px))}; after the first, move the stop to your entry`,
      `Risk ≈ ${(riskUsd * usdSek).toFixed(0)} SEK (${riskPct}% of ${invoBudgetSek.toFixed(0)} SEK)${fits ? "" : " · NOTE: the $10 minimum makes this larger than your Invo budget allows; skip it"}`,
    ].join("\n"),
  };
}
