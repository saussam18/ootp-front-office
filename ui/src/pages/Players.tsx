// Players: any organization's roster, your contracts, and the model's reports on your team and the league.
import { useSearchParams } from "react-router-dom";
import { ContractEnds } from "../components/ContractEnds";
import { PageTitle, Segmented, TextLink } from "../components/ui";
import { useTab } from "./Market";
import { MARKET_TAB, Report, Reports } from "./Reports";
import { Roster } from "./Roster";

const TABS = ["roster", "contracts", "reports"] as const;
type Tab = (typeof TABS)[number];

export function Players() {
  const [tab, setTab] = useTab<Tab>(TABS, "roster");
  const [params] = useSearchParams();
  const report = params.get("report");
  return (
    <div className="space-y-4">
      <PageTitle sub="Rosters for any organization, the contract end dates the plan works from, and the model's reports. Search any player from the header.">
        Players
      </PageTitle>
      <div className="max-w-full overflow-x-auto">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "roster", label: "Roster" }, { value: "contracts", label: "Contracts" }, { value: "reports", label: "Reports" },
        ]} />
      </div>
      {tab === "roster" && <Roster embedded />}
      {tab === "contracts" && <ContractEnds />}
      {tab === "reports" && (report ? (
        <Report reportKey={report} embedded back={{ to: "/players?tab=reports", label: "All reports" }} />
      ) : (
        <div className="space-y-3">
          <Reports embedded include={(k) => !MARKET_TAB[k]} relabel={{ Market: "Potential jumps elsewhere" }} />
          <p className="text-[13px] text-muted">
            Free agents, trade targets, platoon upgrades and gems are on <TextLink to="/market">Market</TextLink>.
          </p>
        </div>
      ))}
    </div>
  );
}
