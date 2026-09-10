import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/dashboard/Header";
import { MilestoneBar } from "@/components/dashboard/MilestoneBar";
import { MarketCard } from "@/components/dashboard/MarketCard";
import { ActivityLog } from "@/components/dashboard/ActivityLog";
import { PortfolioSummary } from "@/components/dashboard/PortfolioSummary";
import { TradesTable } from "@/components/dashboard/TradesTable";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTrades } from "@/hooks/useTrades";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "APEX — Autonomous Trading System" },
      { name: "description", content: "APEX autonomous multi-agent trading system dashboard — 850 SEK seed capital mission to 1M SEK." },
      { property: "og:title", content: "APEX — Autonomous Trading System" },
      { property: "og:description", content: "Multi-agent trading dashboard. Paper-mode active." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { markets, logs, milestones, totalSek, loading } = usePortfolio();
  const { trades } = useTrades();

  const portfolio = totalSek > 0 ? totalSek : 850;

  return (
    <div className={`min-h-screen transition-opacity duration-500 ${loading ? "opacity-50" : "opacity-100"}`}>
      <Header portfolio={portfolio} />
      <MilestoneBar value={portfolio} milestones={milestones} />

      {loading && (
        <div className="mx-auto max-w-[1600px] px-6 pt-6">
          <div className="panel rounded-lg px-4 py-3 text-xs tracking-[0.3em] text-neon font-mono">
            CONNECTING TO DATABASE...
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {markets.map((m) => <MarketCard key={m.id} m={m} />)}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><ActivityLog logs={logs} /></div>
          <PortfolioSummary markets={markets} />
        </section>

        <TradesTable trades={trades} />

        <footer className="text-center text-[10px] tracking-[0.3em] text-muted-foreground pt-4 pb-8">
          APEX v0.1.0 · PAPER MODE · ALL SYSTEMS NOMINAL
        </footer>
      </main>
    </div>
  );
}
