import { useQuery } from "@tanstack/react-query";
import { api, type BlockRow, type Losing, type Table as T } from "../api";
import { DataTable } from "../components/DataTable";
import { Empty, Failed, Loading, Num, PageTitle, PlayerLink, Section, Stat, Table, Td, TextLink, Th, cn } from "../components/ui";
import { money, num } from "../format";

interface Dash {
  record: { w: number; l: number; rank: number; teams: number } | null;
  projection: { total: number; rank: number; teams: number };
  payroll: { committed: number; pre_arb: number };
  holes: T; losing: Losing[]; block: BlockRow[];
  standings: { team: string; org: string | null; w: number; l: number; pct: number }[];
}

export function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dash>("/api/dashboard") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageTitle>Dashboard</PageTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Record" value={d.record ? `${d.record.w}–${d.record.l}` : "–"} sub={d.record && `${d.record.rank} of ${d.record.teams} in the league`} />
        <Stat label="Next season" value={`${num(d.projection.total)} xWAR`} sub={`rank ${d.projection.rank} of ${d.projection.teams}, players under control, before free agency`} />
        <Stat label="Next season payroll" value={money(d.payroll.committed + d.payroll.pre_arb)}
          sub={`${money(d.payroll.committed)} committed incl. projected arbitration + ${money(d.payroll.pre_arb)} pre-arb`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Holes for next season" right={<TextLink to="/plans">Lineups →</TextLink>}>
          <DataTable table={d.holes} filter={false} />
          <p className="mt-3 text-xs text-muted">Cheap fixes: <TextLink to="/reports/platoons">platoon upgrades</TextLink> ·{" "}
            <TextLink to="/reports/trade_targets">trade targets</TextLink> · <TextLink to="/reports/fa_board">free agents</TextLink></p>
        </Section>
        <Section title="Losing after this season" right={<TextLink to="/fa">Free agency →</TextLink>}>
          <Table>
            <thead><tr><Th>Player</Th><Th>Pos</Th><Th>Why</Th><Th right>xWAR if kept</Th></tr></thead>
            <tbody>
              {d.losing.map((l) => (
                <tr key={l.id}><Td><PlayerLink id={l.id} name={l.name} /></Td><Td className="text-muted">{l.pos}</Td>
                  <Td className="text-xs text-muted">{l.why}</Td><Td right><Num v={l.xwar} /></Td></tr>
              ))}
            </tbody>
          </Table>
        </Section>
        <Section title="Trade block" right={<TextLink to="/strategy">Edit →</TextLink>}>
          {d.block.length ? (
            <Table>
              <thead><tr><Th>Player</Th><Th>Pos</Th><Th right>Value</Th><Th right>Other GMs</Th><Th>≈ pick</Th><Th>Asking</Th></tr></thead>
              <tbody>
                {d.block.map((b) => (
                  <tr key={b.player_id}><Td><PlayerLink id={b.player_id} name={b.name} /></Td><Td className="text-muted">{b.pos}</Td>
                    <Td right>{money(b.surplus)}</Td><Td right>{money(b.perceived)}</Td>
                    <Td>{b.pick}</Td><Td>{b.asking}</Td></tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty>Nobody on the block.</Empty>}
        </Section>
      </div>
      <Section title="Standings" right="From the latest box scores">
        <div className="grid gap-x-8 md:grid-cols-2">
          {[d.standings.slice(0, 16), d.standings.slice(16)].map((half, h) => (
            <table key={h} className="w-full border-collapse text-[13px]">
              <tbody>
                {half.map((s, i) => {
                  const mine = s.org === "Halifax";
                  return (
                    <tr key={s.team} className={cn("hover:bg-sunken/60", mine && "bg-accent-soft font-semibold hover:bg-accent-soft")}>
                      <td className="num w-8 border-b border-line/70 py-1.5 pl-1 text-faint">{h * 16 + i + 1}</td>
                      <td className="border-b border-line/70 py-1.5">
                        {s.org ? <TextLink to={`/roster?org=${encodeURIComponent(s.org)}`} className="text-fg hover:text-accent">{s.team}</TextLink> : s.team}
                      </td>
                      <td className="num border-b border-line/70 py-1.5 text-right">{s.w}–{s.l}</td>
                      <td className="num w-16 border-b border-line/70 py-1.5 pr-1 text-right text-muted">{s.pct.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      </Section>
    </div>
  );
}
