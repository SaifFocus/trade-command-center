import { describe, it, expect } from "vitest";
import { taxRows, k4Summary, taxCsv, invoTicket, type ClosedLive } from "./extras";

const trades: ClosedLive[] = [
  { exit_t: "2026-10-10T12:00:00Z", coin: "SOL", side: "long", init_size: 0.14, entry_px: 150, exit_px: 159, realized_pnl_usd: 0.64, fees_usd: 0.02, funding_usd: 0, net_usd: 0.62, usd_sek_at_exit: 10, network: "mainnet" },
  { exit_t: "2026-10-11T12:00:00Z", coin: "ETH", side: "short", init_size: 0.004, entry_px: 3000, exit_px: 3100, realized_pnl_usd: -0.4, fees_usd: 0.01, funding_usd: -0.01, net_usd: -0.42, usd_sek_at_exit: 10, network: "mainnet" },
  { exit_t: "2026-10-12T12:00:00Z", coin: "BTC", side: "long", init_size: 0.0001, entry_px: 1e5, exit_px: 1e5, realized_pnl_usd: 0, fees_usd: 0.01, funding_usd: 0, net_usd: -0.01, usd_sek_at_exit: 10, network: "testnet" },
  { exit_t: "2025-12-31T23:30:00Z", coin: "SOL", side: "long", init_size: 1, entry_px: 1, exit_px: 2, realized_pnl_usd: 1, fees_usd: 0, funding_usd: 0, net_usd: 1, usd_sek_at_exit: 10, network: "mainnet" },
];

describe("tax export", () => {
  it("keeps mainnet closes in the year by Stockholm date", () => {
    const rows = taxRows(trades, 2026);
    expect(rows.map((r) => r.coin)).toEqual(["SOL", "SOL", "ETH"]); // 2025-12-31 23:30Z is 00:30 on 2026-01-01 in Stockholm
    expect(rows[1].net_sek).toBeCloseTo(6.2, 6);
  });
  it("summarises gains, 70% deductible losses and a 30% estimate", () => {
    const s = k4Summary(taxRows(trades, 2026));
    expect(s).toMatchObject({ trades: 3, gains_sek: 16, losses_sek: 4, deductible_losses_sek: 3, net_sek: 13, tax_estimate_sek: 4 });
  });
  it("writes Swedish CSV", () => {
    const csv = taxCsv(taxRows(trades, 2026));
    expect(csv.split("\r\n")[0]).toMatch(/^Datum;Coin;/);
    expect(csv).toContain("2026-10-10;SOL;Lång;0,140000");
  });
});

describe("invo ticket", () => {
  it("includes the stop instruction and sizes from the Invo budget", () => {
    const t = invoTicket({ coin: "SOL", side: "long", setup: "pullback_long", ref_px: 150, stop_px: 144, t1_px: 159, t2_px: 168, status: "executed", created_at: "" }, 2000, 10);
    expect(t.fits).toBe(true);
    expect(t.text).toMatch(/STOP-LOSS 144\.00 — set it yourself/);
    expect(t.text).toMatch(/3x isolated/);
    expect(t.text).toMatch(/Risk ≈ 30 SEK/);
  });
});
