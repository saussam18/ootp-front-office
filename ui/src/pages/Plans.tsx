import { useState } from "react";
import { IconArrowBackUp, IconWand } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Plan, type PlanRow, type PlansResponse } from "../api";
import { Badge, Button, Combobox, Failed, IconButton, Input, Loading, Num, PageTitle, PlayerLink, Section, Stat, Table, Td, Th, Tip,
  useReadOnly, type Tone } from "../components/ui";
import { displayName, isNum, money, num } from "../format";

type Players = PlansResponse["players"];

const STATUS: Record<string, { tone: Tone; label: string; tip: string }> = {
  upgrade: { tone: "warn", label: "Upgrade", tip: "At least 0.3 season xWAR below the median MLB team's player in this slot" },
  strong: { tone: "good", label: "Strong", tip: "At least 0.5 season xWAR above the median MLB team's player in this slot" },
  ok: { tone: "neutral", label: "OK", tip: "Within range of the league median" },
  empty: { tone: "bad", label: "Open", tip: "Nobody under control here" },
  leaving: { tone: "bad", label: "Leaving", tip: "Your pick isn't under control that season" },
};

const pct = (s: number) => `${Math.round(s * 100)}%`;

function usePlanSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; slot: string; player_id: number | null }) =>
      api.put<Plan>(`/api/plans/${v.key}/${encodeURIComponent(v.slot)}`, { player_id: v.player_id, label: "" }),
    onSuccess: (plan) => {
      qc.setQueryData<PlansResponse>(["plans"], (old) => (old ? { ...old, plans: { ...old.plans, [plan.key]: plan } } : old));
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

function PlanCard({ plan, players, showMedian }: { plan: Plan; players: Players; showMedian: boolean }) {
  const save = usePlanSave();
  const readOnly = useReadOnly();
  const label = (id: number) => {
    const p = players[String(id)];
    return p ? `${displayName(p.name)} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` : String(id);
  };
  const starters = plan.rows.filter((r) => r.counts);
  const bench = plan.rows.filter((r) => !r.counts);
  const split = plan.share < 1;
  const cols = showMedian ? 6 : 4;

  const row = (r: PlanRow) => {
    const st = STATUS[r.status];
    const diff = isNum(r.value) && isNum(r.median) ? r.value - r.median : null;
    return (
      <tr key={r.slot} className="group">
        <Td className="w-16 text-[11px] font-semibold text-faint">{r.slot}</Td>
        <Td className="w-72">
          <Combobox width={340} clearable disabled={readOnly}
            value={r.player_id ? String(r.player_id) : null}
            placeholder={r.was ? `was ${displayName(r.was.name)}` : r.label ? `${r.label} (not matched)` : "Pick a player…"}
            options={r.options.map((o) => ({ value: String(o.id), label: label(o.id), hint: num(o.value) }))}
            onChange={(v) => save.mutate({ key: plan.key, slot: r.slot, player_id: v ? Number(v) : null })} />
          {r.suggest && (
            <div className="mt-1 text-xs text-muted">
              Next up:{" "}
              <button type="button" disabled={readOnly} className="text-accent hover:underline disabled:text-muted disabled:no-underline"
                onClick={() => save.mutate({ key: plan.key, slot: r.slot, player_id: r.suggest!.id })}>
                {displayName(r.suggest.name)} ({num(r.suggest.value)})
              </button>
            </div>
          )}
        </Td>
        <Td right className="w-16">
          {r.counts
            ? <Tip label={isNum(r.rate) ? `${num(r.rate)} xWAR full-season rate × ${pct(plan.share)} of PAs` : null}><Num v={r.value} /></Tip>
            : <Tip label="His overall xWAR next season (bench and depth don't count toward the total)"><Num v={r.value} className="text-faint" /></Tip>}
        </Td>
        {showMedian && (
          <Td right className="w-20">
            {r.counts && (
              <Tip label={`League median ${num(r.median)}${isNum(r.median_rate) ? ` (${num(r.median_rate)} full-season rate)` : ""}`}>
                <Num v={diff} signed className={diff === null ? "" : diff < 0 ? "text-warn" : "text-good"} />
              </Tip>
            )}
          </Td>
        )}
        {showMedian && (
          <Td className="w-24">
            {r.counts && r.status !== "ok" && (
              <Tip label={r.was ? `${displayName(r.was.name)} isn't under control in ${plan.year}` : st.tip}><Badge tone={st.tone}>{st.label}</Badge></Tip>
            )}
          </Td>
        )}
        <Td className="whitespace-nowrap">
          {r.model && r.counts && (
            <span className="flex items-center gap-1.5">
              <PlayerLink id={r.model.id} name={r.model.name} />
              <Num v={r.model.value} className="text-xs text-muted" />
              {r.model.id !== r.player_id && !readOnly && (
                <IconButton label="Use the model's pick" className="size-6 opacity-60 group-hover:opacity-100"
                  onClick={() => save.mutate({ key: plan.key, slot: r.slot, player_id: r.model!.id })}>
                  <IconWand size={14} />
                </IconButton>
              )}
            </span>
          )}
        </Td>
      </tr>
    );
  };

  return (
    <Section id={plan.key}
      title={<>{plan.title} <span className="font-normal text-faint">{plan.year}{split && ` · ${pct(plan.share)} of PAs`}</span></>}
      right={starters.length > 0 && <span>You <b className="num text-fg">{num(plan.total)}</b> · model <b className="num text-fg">{num(plan.model_total)}</b> xWAR</span>}>
      <Table minWidth={760}>
        {starters.length > 0 && (
          <thead>
            <tr>
              <Th>Slot</Th><Th>Your pick</Th><Th right>{split ? "Season" : "xWAR"}</Th>
              {showMedian && <Th right>vs median</Th>}{showMedian && <Th>Status</Th>}<Th>Model's pick</Th>
            </tr>
          </thead>
        )}
        <tbody>
          {starters.map(row)}
          {bench.length > 0 && (
            <tr><td colSpan={cols} className="pt-4 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              {plan.group === "minors" ? "Watch list" : "Bench / depth"}</td></tr>
          )}
          {bench.map(row)}
        </tbody>
      </Table>
    </Section>
  );
}

function Losing({ data }: { data: PlansResponse }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [pid, setPid] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["plans"] }); qc.invalidateQueries({ queryKey: ["board"] }); };
  const mark = useMutation({ mutationFn: () => api.put(`/api/leaving/${pid}`, { note }), onSuccess: () => { setPid(null); setNote(""); refresh(); } });
  const unmark = useMutation({ mutationFn: (id: number) => api.del(`/api/leaving/${id}`), onSuccess: refresh });
  const options = Object.entries(data.players).filter(([id]) => !data.marked[id])
    .map(([id, p]) => ({ value: id, label: `${displayName(p.name)} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` }));

  return (
    <Section title={`Losing before ${data.next}`} right={`xWAR and worth: what he'd give you in ${data.next} if you kept him`}>
      <Table minWidth={640}>
        <thead><tr><Th>Player</Th><Th>Pos</Th><Th right>Age</Th><Th>Why</Th><Th right>Salary</Th><Th right>xWAR</Th><Th right>Worth</Th><Th right>Typical</Th><Th /></tr></thead>
        <tbody>
          {data.losing.map((l) => (
            <tr key={l.id}>
              <Td><PlayerLink id={l.id} name={l.name} /></Td><Td className="text-muted">{l.pos}</Td><Td right>{l.age}</Td>
              <Td className="text-xs text-muted">{l.why}</Td>
              <Td right>{money(l.salary)}</Td><Td right><Num v={l.xwar} /></Td><Td right>{money(l.worth)}</Td><Td right>{money(l.price)}</Td>
              <Td className="w-8">{data.marked[String(l.id)] !== undefined && !readOnly && (
                <IconButton label="Undo: keep him" onClick={() => unmark.mutate(l.id)}><IconArrowBackUp size={14} /></IconButton>
              )}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Combobox className="w-64" value={pid} onChange={setPid} options={options} placeholder="Also letting go… (declined option, release)" />
          <Input className="w-56" placeholder="Why (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <Button disabled={!pid} onClick={() => mark.mutate()}>Mark as leaving</Button>
        </div>
      )}
    </Section>
  );
}

function Targets({ plans }: { plans: Plan[] }) {
  const flagged = plans.flatMap((p) => p.rows.filter((r) => r.counts && (r.status === "upgrade" || r.status === "leaving" || r.status === "empty"))
    .map((r) => ({ plan: p, r })));
  if (!flagged.length) return null;
  return (
    <Section title="Where to upgrade" right="Season xWAR vs the league median">
      <div className="flex flex-wrap gap-2">
        {flagged.map(({ plan, r }) => (
          <a key={plan.key + r.slot} href={`#${plan.key}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[13px] transition-colors hover:border-line-strong hover:bg-sunken">
            <span className={STATUS[r.status].tone === "bad" ? "text-bad" : "text-warn"}>●</span>
            <span className="text-muted">{plan.title.replace("Lineup ", "")}</span>
            <span className="font-medium">{r.slot}</span>
            <span className="num text-muted">{r.player_id ? `${num(r.value)} vs ${num(r.median)}` : r.was ? `was ${displayName(r.was.name)}` : "open"}</span>
          </a>
        ))}
      </div>
    </Section>
  );
}

export function Plans() {
  const q = useQuery({ queryKey: ["plans"], queryFn: () => api.get<PlansResponse>("/api/plans") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;
  const p = d.plans;
  const next = [p.lineup_vr, p.lineup_vl, p.rotation, p.bullpen];

  return (
    <div className="space-y-4">
      <PageTitle sub={<>Only players under contract or team control in {d.next} can be picked. Each slot is compared to the median MLB team's
        player in that slot: <b className="font-medium text-fg">Upgrade</b> means at least {d.upgrade_gap} season xWAR below it. Lineup values
        count only the PAs vs that hand ({pct(p.lineup_vr.share)} vs RHP, {pct(p.lineup_vl.share)} vs LHP), so they add up to one season;
        hover a value for the full-season rate. Relievers are weighted by the leverage of the role.</>}>
        {d.next} lineups & staff
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Lineup" value={num(p.lineup_vr.total + p.lineup_vl.total)}
          sub={`vs RHP ${num(p.lineup_vr.total)} + vs LHP ${num(p.lineup_vl.total)} · model's best ${num(p.lineup_vr.model_total + p.lineup_vl.model_total)}`} />
        {[p.rotation, p.bullpen].map((pl) => (
          <Stat key={pl.key} label={pl.title} value={num(pl.total)} sub={`model's best ${num(pl.model_total)} xWAR`} />
        ))}
      </div>
      <Targets plans={next} />
      <Losing data={d} />
      <PlanCard plan={p.lineup_vr} players={d.players} showMedian />
      <PlanCard plan={p.lineup_vl} players={d.players} showMedian />
      <PlanCard plan={p.rotation} players={d.players} showMedian />
      <PlanCard plan={p.bullpen} players={d.players} showMedian />
      <div className="grid gap-4 xl:grid-cols-2">
        <PlanCard plan={p.minors_hit} players={d.players} showMedian={false} />
        <PlanCard plan={p.minors_pit} players={d.players} showMedian={false} />
      </div>
      <div className="pt-4">
        <h2 className="text-base font-semibold tracking-tight">Core for {d.core_year}</h2>
        <p className="mt-0.5 text-[13px] text-muted">Three seasons out: only players under control in {d.core_year}, valued at their projected {d.core_year} xWAR. Bullpen arms aren't part of the core.</p>
      </div>
      <PlanCard plan={p.core_lineup} players={d.players} showMedian={false} />
      <PlanCard plan={p.core_rotation} players={d.players} showMedian={false} />
    </div>
  );
}
