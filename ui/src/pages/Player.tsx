import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Table } from "../api";
import { DataTable } from "../components/DataTable";
import { Badge, Button, Failed, Loading, PlayerLink, Section, SectionLabel, Stat, cn, useReadOnly } from "../components/ui";
import { displayName, money, num } from "../format";

interface Deal { date: string; sides: { team: string; items: { id?: number; label: string }[] }[] }
interface Detail {
  player: Record<string, any>; on_block: boolean; mine: boolean;
  projection: Table; positions: Table; history: Record<string, number>[];
  tables: Record<string, Table>; trades: Deal[]; comps: { title: string; deals: Deal[] };
}

function LinkButton({ to, children, primary }: { to: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link to={to} className={cn("inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors",
      primary ? "bg-accent text-white hover:bg-accent/90 dark:text-bg" : "border border-line bg-surface text-fg hover:bg-sunken")}>
      {children}
    </Link>
  );
}

function Deals({ deals }: { deals: Deal[] }) {
  if (!deals.length) return <p className="text-[13px] text-muted">None.</p>;
  return (
    <div className="divide-y divide-line/70">
      {deals.map((d, i) => (
        <div key={i} className="flex gap-3 py-1.5 text-[13px]">
          <span className="num w-20 shrink-0 pt-px text-xs text-faint">{d.date}</span>
          <span className="min-w-0">
            {d.sides.map((s, j) => (
              <span key={j}>{j > 0 && <span className="text-faint"> · </span>}<b className="font-semibold">{s.team}</b> gave {s.items.map((it, k) => (
                <span key={k}>{k > 0 && ", "}{it.id ? <PlayerLink id={it.id} name={it.label} /> : it.label}</span>))}</span>
            ))}
            {d.sides.length === 1 && <span className="text-muted"> · nothing listed in return</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// Current (solid) and potential (dashed) rating totals by Jan 1 update.
function History({ rows }: { rows: Record<string, number>[] }) {
  if (rows.length < 2) return <p className="text-[13px] text-muted">Not enough Jan 1 updates yet.</p>;
  const keys = Object.keys(rows[0]).filter((k) => k !== "yr");
  const cur = rows.map((r) => keys.filter((k) => !k.endsWith("_p")).reduce((s, k) => s + (r[k] ?? 0), 0));
  const pot = rows.map((r) => keys.filter((k) => k.endsWith("_p")).reduce((s, k) => s + (r[k] ?? 0), 0));
  const lo = Math.min(...cur, ...pot) - 5, hi = Math.max(...cur, ...pot) + 5;
  const w = 600, h = 160;
  const x = (i: number) => 30 + (i / (rows.length - 1)) * (w - 50);
  const y = (v: number) => h - 24 - ((v - lo) / (hi - lo)) * (h - 40);
  const line = (s: number[]) => s.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Rating history">
        <line x1={30} x2={w - 20} y1={h - 24} y2={h - 24} stroke="var(--line)" />
        <polyline points={line(pot)} fill="none" stroke="var(--faint)" strokeWidth={2} strokeDasharray="5 4" />
        <polyline points={line(cur)} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />
        {rows.map((r, i) => (i === 0 || i === rows.length - 1 || i % 3 === 0) && (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize={11} fill="var(--faint)">{r.yr}</text>
        ))}
      </svg>
      <p className="mt-1 text-xs text-muted">Solid: current total {cur[cur.length - 1]} · dashed: potential total {pot[pot.length - 1]} (sum of the three core ratings)</p>
    </div>
  );
}

export function Player() {
  const { id } = useParams();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["player", id], queryFn: () => api.get<Detail>(`/api/player/${id}`) });
  const toggle = useMutation({
    mutationFn: () => (q.data?.on_block ? api.del(`/api/block/${id}`) : api.post("/api/block", { player_id: Number(id) })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["player", id] }); qc.invalidateQueries({ queryKey: ["strategy"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const { player: p, tables: t } = q.data;

  return (
    <div className="space-y-4">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{displayName(p.name)}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>{p.pos} · age {p.age} · bats {p.b} / throws {p.t} ·{" "}
              {p.org ? <Link to={`/roster?org=${encodeURIComponent(p.org)}`} className="text-accent hover:underline underline-offset-2">{p.org}</Link> : "free agent"} {p.lev}</span>
            {p.prospect_rank && <Badge tone="accent">#{p.prospect_rank} prospect</Badge>}
            {p.on40 && <Badge>40-man</Badge>}
            {q.data.on_block && readOnly && <Badge tone="warn">On the trade block</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {q.data.mine ? (
            <>
              {!readOnly && (
                <Button variant={q.data.on_block ? "secondary" : "primary"} onClick={() => toggle.mutate()} disabled={toggle.isPending}>
                  {q.data.on_block ? "Remove from trade block" : "Add to trade block"}
                </Button>
              )}
              <LinkButton to={`/trade?mode=shop&give=${id}`}>Shop him</LinkButton>
            </>
          ) : <LinkButton to={`/trade?mode=offer&get=${id}`} primary>What would it take?</LinkButton>}
          <LinkButton to={`/trade?mode=comps&give=${id}`}>Comparable trades</LinkButton>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="xWAR next season" value={num(p.xwar_next)} sub={`peak ${num(p.peak_xwar)} · ceiling ${num(p.ceiling_xwar)}`} />
        <Stat label="Value to us" value={money(p.surplus / 1e6)} sub={`${p.control_years ?? 0} controlled seasons at ${money((p.avg_cost ?? 0) / 1e6)} avg`} />
        <Stat label="Other GMs" value={money(p.perceived / 1e6)} sub="how the market likely prices him" />
        <Stat label="Contract" value={money((p.slr ?? 0) / 1e6)} sub={`${p.yl ?? "–"} yr left ${p.yl_status ?? ""} · ${num(p.oy, 0)} option yrs`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Projection by season"><DataTable table={q.data.projection} filter={false} /></Section>
        <Section title="Scouting history" right="OSA, every Jan 1"><History rows={q.data.history} /></Section>
        <Section title="By position" right="Full-season xWAR"><DataTable table={q.data.positions} filter={false} /></Section>
        <Section title="This season"><DataTable table={t.stats} filter={false} /></Section>
        <Section title="Ratings">
          <div className="space-y-4">
            <DataTable table={t.ratings} filter={false} />
            <div><SectionLabel className="mb-1">Potential</SectionLabel><DataTable table={t.potential} filter={false} /></div>
            {t.pitches && <div><SectionLabel className="mb-1">Pitches</SectionLabel><DataTable table={t.pitches} filter={false} /></div>}
            {t.fielding && <div><SectionLabel className="mb-1">Fielding</SectionLabel><DataTable table={t.fielding} filter={false} /></div>}
            <div><SectionLabel className="mb-1">Personality</SectionLabel><DataTable table={t.personality} filter={false} /></div>
          </div>
        </Section>
        <Section title="History">
          <div className="space-y-4">
            <div><SectionLabel className="mb-1">Contracts</SectionLabel><DataTable table={t.contracts} filter={false} /></div>
            <div><SectionLabel className="mb-1">Trades</SectionLabel><Deals deals={q.data.trades} /></div>
            <div><SectionLabel className="mb-1">Recent injuries</SectionLabel><DataTable table={t.injuries} filter={false} /></div>
          </div>
        </Section>
      </div>
      <Section title="Comparable trades">
        <p className="mb-2 text-[13px] text-muted">{q.data.comps.title}</p>
        <Deals deals={q.data.comps.deals} />
      </Section>
    </div>
  );
}
