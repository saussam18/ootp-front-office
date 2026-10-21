// Market: who you could add from outside: free agents, trade targets, the trade lab, cheap upgrades, and the standings.
import { useSearchParams } from "react-router-dom";
import { PageTitle, Segmented } from "../components/ui";
import { Standings } from "./Standings";
import { Report } from "./Reports";
import { TradeLab } from "./TradeLab";

/** The page's tab, kept in the URL as ?tab=; switching tabs drops the previous tab's own params. */
export function useTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const t = params.get("tab") as T | null;
  return [t && tabs.includes(t) ? t : fallback, (next: T) => setParams(next === fallback ? {} : { tab: next })];
}

const TABS = ["fa", "targets", "trade", "gems", "standings"] as const;
type Tab = (typeof TABS)[number];

export function Market() {
  const [tab, setTab] = useTab<Tab>(TABS, "fa");
  return (
    <div className="space-y-4">
      <PageTitle sub="Players you could add from outside the organization: who's available, who's worth trading for, and what a deal would cost.">
        Market
      </PageTitle>
      <div className="max-w-full overflow-x-auto">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "fa", label: "Free agents" }, { value: "targets", label: "Trade targets" }, { value: "trade", label: "Trade lab" },
          { value: "gems", label: "Platoons & gems" }, { value: "standings", label: "Standings" },
        ]} />
      </div>
      {tab === "fa" && <Report reportKey="fa_board" embedded />}
      {tab === "targets" && <Report reportKey="trade_targets" embedded />}
      {tab === "trade" && <TradeLab embedded />}
      {tab === "gems" && (
        <div className="space-y-8">
          {["platoons", "gems_fa", "gems_blocked", "gems_buylow"].map((k) => <Report key={k} reportKey={k} embedded />)}
        </div>
      )}
      {tab === "standings" && <Standings />}
    </div>
  );
}
