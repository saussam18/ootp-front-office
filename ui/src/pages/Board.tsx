import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Board as BoardData, type Plan, type PlanRow } from "../api";
import { FaTimeline } from "../components/FaTimeline";
import { Alert, Dot, Failed, Loading, Num, PageTitle, PlayerLink, Section, SectionLabel, Stat, TextLink, Tip, type Tone } from "../components/ui";
import { num } from "../format";

type Players = BoardData["players"];

const FLAG: Record<string, { tone: Tone; tip: string }> = {
  upgrade: { tone: "warn", tip: "Upgrade target: 0.3+ season xWAR below the league median here" },
  strong: { tone: "good", tip: "Strong: 0.5+ season xWAR above the league median here" },
  leaving: { tone: "bad", tip: "Your pick isn't under control this season" },
  empty: { tone: "bad", tip: "Open" },
};

function Flag({ r }: { r: PlanRow }) {
  const f = FLAG[r.status];
  if (!f || !r.counts) return null;
  const tip = r.status === "upgrade" || r.status === "strong" ? `${f.tip} (${num(r.value)} vs ${num(r.median)})` : r.was ? `${r.was.name} leaving` : f.tip;
  return <Tip label={tip}><span className="flex size-4 items-center justify-center"><Dot tone={f.tone} /></span></Tip>;
}

function Who({ r, players, hand }: { r: PlanRow; players: Players; hand: "b" | "t" }) {
  if (r.player_id) {
    const p = players[String(r.player_id)];
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <PlayerLink id={r.player_id} name={p?.name ?? String(r.player_id)} className="truncate" />
        <span className="text-xs text-faint">{p?.[hand]?.[0]}</span>
        {p?.lev && p.lev !== "RLB" && <span className="rounded bg-sunken px-1 text-[10px] font-medium text-muted">{p.lev}</span>}
      </span>
    );
  }
  if (r.was || (r.counts && !r.label)) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="text-bad">{r.was ? `was ${r.was.name}` : "open"}</span>
        {r.suggest && (
          <Tip label="Best player under control who isn't already in this lineup">
            <span className="flex min-w-0 items-center gap-1 text-muted">
              → <PlayerLink id={r.suggest.id} name={r.suggest.name} className="truncate" />
            </span>
          </Tip>
        )}
      </span>
    );
  }
  return <span className="text-muted">{r.label ? `${r.label}?` : "—"}</span>;
}

// A compact read-only plan: slot, player, season value, flag; the bench as one line.
function Block({ plan, players, hand, title, sub }: { plan: Plan; players: Players; hand: "b" | "t"; title?: string; sub?: string }) {
  const starters = plan.rows.filter((r) => r.counts);
  const bench = plan.rows.filter((r) => !r.counts && r.player_id);
  return (
    <Section title={<>{title ?? plan.title}{sub && <span className="ml-1.5 font-normal text-faint">{sub}</span>}</>}
      right={<TextLink to={`/plans#${plan.key}`}>Edit</TextLink>}>
      {starters.length > 0 && (
        <div className="divide-y divide-line/60">
          {starters.map((r) => (
            <div key={r.slot} className="flex h-8 items-center gap-3">
              <span className="w-9 shrink-0 text-[11px] font-semibold text-faint">{r.slot}</span>
              <span className="min-w-0 flex-1 text-[13px]"><Who r={r} players={players} hand={hand} /></span>
              <Tip label={r.rate !== null && r.rate !== undefined ? `${num(r.rate)} full-season rate × ${Math.round(plan.share * 100)}% of PAs` : null}>
                <span className="w-9 text-right text-xs text-muted"><Num v={r.value} /></span>
              </Tip>
              <span className="w-4"><Flag r={r} /></span>
            </div>
          ))}
        </div>
      )}
      {bench.length > 0 && (
        <div className={starters.length ? "mt-3" : ""}>
          {starters.length > 0 && <SectionLabel className="mb-1">Bench</SectionLabel>}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            {bench.map((r) => {
              const p = players[String(r.player_id)];
              return (
                <span key={r.slot} className="flex items-center gap-1">
                  <PlayerLink id={r.player_id} name={p?.name ?? ""} />
                  <span className="text-xs text-faint">{p?.[hand]?.[0]}</span>
                  {p?.lev && p.lev !== "RLB" && <span className="text-[10px] text-faint">{p.lev}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

export function Board() {
  const q = useQuery({ queryKey: ["board"], queryFn: () => api.get<BoardData>("/api/board") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;
  const p = d.plans;
  const f = d.forty;
  const lineup = p.lineup_vr.total + p.lineup_vl.total;
  const pct = (s: number) => `${Math.round(s * 100)}% of PAs`;

  return (
    <div className="space-y-6">
      <PageTitle sub={<>Next season ({d.next}) from your lineup and staff plans, free agency by year, and the {d.core_year} core.
        Values are season xWAR. <span className="inline-flex items-center gap-1"><Dot tone="warn" /> upgrade</span>{" "}
        <span className="ml-1 inline-flex items-center gap-1"><Dot tone="good" /> strong</span>{" "}
        <span className="ml-1 inline-flex items-center gap-1"><Dot tone="bad" /> leaving or open</span></>}>
        Team plan
      </PageTitle>

      {d.must_protect.length > 0 && (
        <Alert tone="warn" title={`Rule 5: protect before the December ${d.season} draft`}>
          {d.must_protect.map((m, i) => <span key={m.id}>{i > 0 && ", "}<PlayerLink id={m.id} name={m.name} className="font-medium" /> ({m.pos}, {m.lev}, worth ${num(m.surplus)}M)</span>)}
          {d.must_protect.length === 1 ? " is" : " are"} eligible and not on the 40-man. <Link to="/forty" className="font-medium underline">40-man roster →</Link>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lineup" value={num(lineup)} sub={`vs RHP ${num(p.lineup_vr.total)} + vs LHP ${num(p.lineup_vl.total)}`} />
        <Stat label="Rotation + bullpen" value={num(p.rotation.total + p.bullpen.total)} sub={`${num(p.rotation.total)} + ${num(p.bullpen.total)} (leverage-weighted)`} />
        <Stat label="40-man" value={<>{f.count}<span className="text-base font-normal text-faint">/40</span></>}
          sub={<>{f.leaving} leaving · {f.planned_drops} drops · {f.planned_adds} adds → <b className="text-fg">{f.projected}</b></>} />
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Leaving after {d.season}</div>
            <TextLink to="/fa" className="text-xs">Dates</TextLink>
          </div>
          <div className="mt-1.5 text-[13px] leading-relaxed">
            {d.losing.length ? d.losing.map((l, i) => <span key={l.id}>{i > 0 && <span className="text-faint">, </span>}<PlayerLink id={l.id} name={l.name} /></span>)
              : <span className="text-muted">Nobody</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">{d.next} lineups</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Block plan={p.lineup_vr} players={d.players} hand="b" title="vs RHP" sub={pct(p.lineup_vr.share)} />
          <Block plan={p.lineup_vl} players={d.players} hand="b" title="vs LHP" sub={pct(p.lineup_vl.share)} />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">{d.next} pitching staff</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Block plan={p.rotation} players={d.players} hand="t" />
          <Block plan={p.bullpen} players={d.players} hand="t" />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Block plan={p.minors_hit} players={d.players} hand="b" title="Minors: hitters to watch" />
        <Block plan={p.minors_pit} players={d.players} hand="t" title="Minors: pitchers to watch" />
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Free agency by year</h2>
          <TextLink to="/fa" className="text-[13px]">Plan replacements →</TextLink>
        </div>
        <FaTimeline years={d.fa} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">{d.core_year} core</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Block plan={p.core_lineup} players={d.players} hand="b" title="Lineup" />
          <Block plan={p.core_rotation} players={d.players} hand="t" title="Rotation" />
        </div>
      </div>
    </div>
  );
}
