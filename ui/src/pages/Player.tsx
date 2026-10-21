import { Anchor, Badge, Button, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Table } from "../api";
import { DataTable } from "../components/DataTable";
import { Failed, Loading, PlayerLink, Section, Stat } from "../components/ui";
import { money, num } from "../format";

interface Deal { date: string; sides: { team: string; items: { id?: number; label: string }[] }[] }
interface Detail {
  player: Record<string, any>; on_block: boolean; mine: boolean;
  projection: Table; positions: Table; history: Record<string, number>[];
  tables: Record<string, Table>; trades: Deal[]; comps: { title: string; deals: Deal[] };
}

function Deals({ deals }: { deals: Deal[] }) {
  if (!deals.length) return <Text fz="sm" c="dimmed">None.</Text>;
  return (
    <Stack gap={6}>
      {deals.map((d, i) => (
        <Text key={i} fz="sm"><Text span c="dimmed" fz="xs">{d.date}</Text>{"  "}
          {d.sides.map((s, j) => (
            <span key={j}>{j > 0 && " · "}<b>{s.team}</b> gave {s.items.map((it, k) => (
              <span key={k}>{k > 0 && ", "}{it.id ? <PlayerLink id={it.id} name={it.label} /> : it.label}</span>))}</span>
          ))}
          {d.sides.length === 1 && " · nothing listed in return"}
        </Text>
      ))}
    </Stack>
  );
}

// Current (solid) and potential (dashed) rating totals by Jan 1 update.
function History({ rows }: { rows: Record<string, number>[] }) {
  if (rows.length < 2) return null;
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
        <polyline points={line(pot)} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={2} strokeDasharray="5 4" />
        <polyline points={line(cur)} fill="none" stroke="var(--mantine-color-blue-6)" strokeWidth={2.5} />
        {rows.map((r, i) => (i === 0 || i === rows.length - 1 || i % 3 === 0) && (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">{r.yr}</text>
        ))}
      </svg>
      <Text fz="xs" c="dimmed">Solid: current total {cur[cur.length - 1]} · dashed: potential total {pot[pot.length - 1]} (sum of the three core ratings)</Text>
    </div>
  );
}

export function Player() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["player", id], queryFn: () => api.get<Detail>(`/api/player/${id}`) });
  const toggle = useMutation({
    mutationFn: () => (q.data?.on_block ? api.del(`/api/block/${id}`) : api.post("/api/block", { player_id: Number(id) })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["player", id] }); qc.invalidateQueries({ queryKey: ["strategy"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const { player: p, tables: t } = q.data;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{p.name}</Title>
          <Group gap="xs" mt={4}>
            <Text c="dimmed" fz="sm">{p.pos} · age {p.age} · bats {p.b} / throws {p.t} ·{" "}
              {p.org ? <Anchor component={Link} to={`/roster?org=${encodeURIComponent(p.org)}`} fz="sm">{p.org}</Anchor> : "free agent"} {p.lev}</Text>
            {p.prospect_rank && <Badge variant="light">#{p.prospect_rank} prospect</Badge>}
            {p.on40 && <Badge variant="light" color="gray">40-man</Badge>}
          </Group>
        </div>
        <Group gap="xs">
          {q.data.mine ? (
            <>
              <Button variant={q.data.on_block ? "light" : "filled"} onClick={() => toggle.mutate()}>{q.data.on_block ? "Remove from trade block" : "Add to trade block"}</Button>
              <Button component={Link} to={`/trade?mode=shop&give=${id}`} variant="default">Shop him</Button>
            </>
          ) : <Button component={Link} to={`/trade?mode=offer&get=${id}`}>What would it take?</Button>}
          <Button component={Link} to={`/trade?mode=comps&give=${id}`} variant="default">Comparable trades</Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="xWAR next season" value={num(p.xwar_next)} sub={`peak ${num(p.peak_xwar)} · ceiling ${num(p.ceiling_xwar)}`} />
        <Stat label="Value to us" value={money(p.surplus / 1e6)} sub={`${p.control_years ?? 0} controlled seasons at ${money((p.avg_cost ?? 0) / 1e6)} avg`} />
        <Stat label="Other GMs" value={money(p.perceived / 1e6)} sub="how the market likely prices him" />
        <Stat label="Contract" value={money((p.slr ?? 0) / 1e6)} sub={`${p.yl ?? "–"} yr left ${p.yl_status ?? ""} · ${num(p.oy, 0)} option yrs`} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Section title="Projection by season"><DataTable table={q.data.projection} filter={false} /></Section>
        <Section title="Scouting history" right={<Text fz="xs" c="dimmed">OSA, every Jan 1</Text>}>
          <History rows={q.data.history} />
        </Section>
        <Section title="By position" right={<Text fz="xs" c="dimmed">full-season xWAR</Text>}><DataTable table={q.data.positions} filter={false} /></Section>
        <Section title="This season"><DataTable table={t.stats} filter={false} /></Section>
        <Section title="Ratings">
          <Stack gap="md">
            <DataTable table={t.ratings} filter={false} />
            <Text fz="xs" fw={700} c="dimmed" tt="uppercase">Potential</Text>
            <DataTable table={t.potential} filter={false} />
            {t.pitches && (<><Text fz="xs" fw={700} c="dimmed" tt="uppercase">Pitches</Text><DataTable table={t.pitches} filter={false} /></>)}
            {t.fielding && (<><Text fz="xs" fw={700} c="dimmed" tt="uppercase">Fielding</Text><DataTable table={t.fielding} filter={false} /></>)}
            <Text fz="xs" fw={700} c="dimmed" tt="uppercase">Personality</Text>
            <DataTable table={t.personality} filter={false} />
          </Stack>
        </Section>
        <Section title="History">
          <Stack gap="md">
            <Text fz="xs" fw={700} c="dimmed" tt="uppercase">Contracts</Text>
            <DataTable table={t.contracts} filter={false} />
            <Text fz="xs" fw={700} c="dimmed" tt="uppercase">Trades</Text>
            <Deals deals={q.data.trades} />
            <Text fz="xs" fw={700} c="dimmed" tt="uppercase">Recent injuries</Text>
            <DataTable table={t.injuries} filter={false} />
          </Stack>
        </Section>
      </SimpleGrid>
      <Section title="Comparable trades"><Text fz="sm" c="dimmed" mb="sm">{q.data.comps.title}</Text><Deals deals={q.data.comps.deals} /></Section>
    </Stack>
  );
}
