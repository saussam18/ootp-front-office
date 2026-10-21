import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Forty as FortyData, type FortyPlayer } from "../api";
import { Badge, Failed, Loading, Num, PageTitle, PlayerLink, Section, Segmented, Stat, Switch, Table, Td, Th, Tip, cn, useReadOnly,
  type Tone } from "../components/ui";
import { money } from "../format";

const ADVICE: Record<string, { tone: Tone; label: string; tip: string }> = {
  protect: { tone: "warn", label: "Protect", tip: "Worth $5M+ to you, a 1.5+ xWAR peak, or a ranked prospect: someone will take him" },
  consider: { tone: "accent", label: "Consider", tip: "Some value ($2M+ or a 1+ xWAR peak)" },
  expose: { tone: "neutral", label: "Expose", tip: "Little risk in leaving him off" },
};

function PlanToggle({ p, labels }: { p: FortyPlayer; labels: [string, string] }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const save = useMutation({
    mutationFn: (status: string) => api.put(`/api/forty/${p.id}`, { status: status === "undecided" ? null : status, note: p.note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["forty"] }); qc.invalidateQueries({ queryKey: ["plan"] }); },
  });
  if (readOnly) {
    return p.plan ? <Badge tone={p.plan === "on" ? "accent" : "neutral"}>{p.plan === "on" ? labels[0] : labels[1]}</Badge> : <span className="text-faint">–</span>;
  }
  return (
    <Segmented size="xs" value={p.plan ?? "undecided"} onChange={(v) => save.mutate(v)}
      options={[{ value: "on", label: labels[0] }, { value: "undecided", label: "–" }, { value: "off", label: labels[1] }]} />
  );
}

function Head({ extra }: { extra?: string[] }) {
  return (
    <thead>
      <tr>
        <Th>Player</Th><Th>Pos</Th><Th>Lvl</Th><Th right>Age</Th>
        {extra?.map((e, i) => <Th key={i}>{e}</Th>)}
        <Th right>xWAR</Th><Th right>Peak</Th><Th right>Value</Th>
        <Th right><Tip label="OOTP's OPT and OY columns (Financial Info view)"><span className="underline decoration-dotted underline-offset-2">OPT / OY</span></Tip></Th>
        <Th>Plan</Th>
      </tr>
    </thead>
  );
}

function AdviceBadge({ p, tip = true }: { p: FortyPlayer; tip?: boolean }) {
  const a = ADVICE[p.advice!];
  const badge = <Badge tone={a.tone}>{a.label}</Badge>;
  return tip ? <Tip label={a.tip}>{badge}</Tip> : badge;
}

export function Forty({ embedded }: { embedded?: boolean } = {}) {
  const q = useQuery({ queryKey: ["forty"], queryFn: () => api.get<FortyData>("/api/forty") });
  const [showAll, setShowAll] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;
  const eligibleNow = d.exposed.filter((p) => p.eligible_now);
  const now = showAll ? eligibleNow : eligibleNow.filter((p) => p.advice !== "expose" || p.plan);
  const later = d.exposed.filter((p) => !p.eligible_now);
  const signed = (p: FortyPlayer) => <Td className="whitespace-nowrap text-xs text-muted">{p.signed?.slice(0, 4)} {p.how === "drafted" ? "draft" : "intl"}</Td>;
  const row = (p: FortyPlayer, extra: ReactNode, labels: [string, string]) => (
    <tr key={p.id} className={cn(p.leaving && "opacity-50")}>
      <Td className="whitespace-nowrap"><PlayerLink id={p.id} name={p.name} />{p.prospect_rank && <span className="ml-1 text-xs text-faint">#{p.prospect_rank}</span>}</Td>
      <Td className="text-muted">{p.pos}</Td><Td className="text-muted">{p.lev}</Td><Td right>{p.age}</Td>
      {extra}
      <Td right><Num v={p.xwar} /></Td><Td right><Num v={p.peak} /></Td><Td right>{money(p.surplus)}</Td>
      <Td right className="text-muted"><Num v={p.opt} digits={0} /> / <Num v={p.oy} digits={0} /></Td>
      <Td>{p.leaving ? <span className="text-xs text-muted">leaving</span> : <PlanToggle p={p} labels={labels} />}</Td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {!embedded && <PageTitle sub={<>Rule 5 eligibility from each player's first pro contract (draft or international signing): eligible for the December draft
        after his 4th season if he signed at 18 or younger, after his 3rd if older. That matches every Rule 5 pick in the league's history.
        Plans you set here (keep/drop, protect/expose) feed the projected count.</>}>40-man roster</PageTitle>}
      {!embedded && (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="On the 40-man" value={<>{d.count}<span className="text-base font-normal text-faint">/40</span></>} />
        <Stat label="Leaving after the season" value={d.leaving} sub="contracts ending or marked as leaving" />
        <Stat label="Planned" value={`−${d.planned_drops} / +${d.planned_adds}`} sub="drops / Rule 5 protections" />
        <Stat label="Projected" value={<>{d.projected}<span className="text-base font-normal text-faint">/40</span></>} sub={`${40 - d.projected} open spots for free agents and trades`} />
      </div>
      )}

      <Section title={`Rule 5 eligible this December (${d.rule5_year}), not on the 40-man`}
        right={<Switch checked={showAll} onChange={setShowAll}
          label={`Show all ${eligibleNow.length} (${eligibleNow.length - eligibleNow.filter((p) => p.advice !== "expose").length} safe to expose)`} />}>
        <Table minWidth={900}>
          <Head extra={["Signed", "Advice"]} />
          <tbody>
            {now.map((p) => row(p, <>{signed(p)}<Td><AdviceBadge p={p} /></Td></>, ["Protect", "Expose"]))}
          </tbody>
        </Table>
      </Section>

      <Section title="Current 40-man" right="Dimmed = leaving · ⚠ = drop candidate (little value, low peak)">
        <Table minWidth={900}>
          <Head extra={[""]} />
          <tbody>
            {d.current.map((p) => row(p, (
              <Td className="w-6">{p.drop_candidate && <Tip label="Drop candidate: under $1M of value and a peak under 1 xWAR"><span className="text-warn">⚠</span></Tip>}</Td>
            ), ["Keep", "Drop"]))}
          </tbody>
        </Table>
      </Section>

      {later.length > 0 && (
        <Section title={`Eligible next December (${d.rule5_year + 1})`}>
          <Table minWidth={900}>
            <Head extra={["Signed", "Advice"]} />
            <tbody>
              {later.map((p) => row(p, <>{signed(p)}<Td><AdviceBadge p={p} tip={false} /></Td></>, ["Protect", "Expose"]))}
            </tbody>
          </Table>
        </Section>
      )}
      <p className="text-xs text-muted">Value = our surplus value in $M over his controlled seasons.</p>
    </div>
  );
}
