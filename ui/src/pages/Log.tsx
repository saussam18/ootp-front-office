// Log: what's happened (your transaction log) and what you're thinking (notes, trade block).
import { PageTitle, Segmented } from "../components/ui";
import { useTab } from "./Market";
import { Moves } from "./Moves";
import { Strategy } from "./Strategy";

const TABS = ["moves", "notes"] as const;
type Tab = (typeof TABS)[number];

export function Log() {
  const [tab, setTab] = useTab<Tab>(TABS, "moves");
  return (
    <div className="space-y-4">
      <PageTitle sub="Every move your organization has made, read from the league's logs at each refresh, plus your notes and trade block.">Log</PageTitle>
      <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: "moves", label: "Moves" }, { value: "notes", label: "Notes & trade block" }]} />
      {tab === "moves" && <Moves embedded />}
      {tab === "notes" && <Strategy embedded />}
    </div>
  );
}
