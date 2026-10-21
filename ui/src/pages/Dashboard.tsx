import { Anchor, Group, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type BlockRow, type Losing, type Table as T } from "../api";
import { DataTable } from "../components/DataTable";
import { Failed, Loading, PageTitle, PlayerLink, Section, Stat } from "../components/ui";
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
    <Stack gap="lg">
      <PageTitle>Dashboard</PageTitle>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Stat label="Record" value={d.record ? `${d.record.w}–${d.record.l}` : "–"} sub={d.record && `${d.record.rank} of ${d.record.teams} in the league`} />
        <Stat label="Next season" value={`${num(d.projection.total)} xWAR`} sub={`rank ${d.projection.rank} of ${d.projection.teams}, players under control, before free agency`} />
        <Stat label="Next season payroll" value={money(d.payroll.committed + d.payroll.pre_arb)}
          sub={`${money(d.payroll.committed)} committed incl. projected arbitration + ${money(d.payroll.pre_arb)} pre-arb`} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Section title="Holes for next season" right={<Anchor component={Link} to="/plans" fz="sm">lineups →</Anchor>}>
          <DataTable table={d.holes} filter={false} />
          <Text fz="sm" c="dimmed" mt="xs">Cheap fixes: <Anchor component={Link} to="/reports/platoons">platoon upgrades</Anchor> ·{" "}
            <Anchor component={Link} to="/reports/trade_targets">trade targets</Anchor> · <Anchor component={Link} to="/reports/fa_board">free agents</Anchor></Text>
        </Section>
        <Section title="Losing after this season" right={<Anchor component={Link} to="/fa" fz="sm">free agency →</Anchor>}>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Thead><Table.Tr><Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th>Why</Table.Th><Table.Th ta="right">xWAR if kept</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {d.losing.map((l) => (
                <Table.Tr key={l.id}><Table.Td><PlayerLink id={l.id} name={l.name} /></Table.Td><Table.Td>{l.pos}</Table.Td>
                  <Table.Td><Text fz="xs" c="dimmed">{l.why}</Text></Table.Td><Table.Td ta="right">{num(l.xwar)}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
        <Section title="Trade block" right={<Anchor component={Link} to="/strategy" fz="sm">edit →</Anchor>}>
          {d.block.length ? (
            <Table fz="sm" verticalSpacing={4}>
              <Table.Thead><Table.Tr><Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th ta="right">Value</Table.Th>
                <Table.Th ta="right">Other GMs</Table.Th><Table.Th>≈ pick</Table.Th><Table.Th>Asking</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {d.block.map((b) => (
                  <Table.Tr key={b.player_id}><Table.Td><PlayerLink id={b.player_id} name={b.name} /></Table.Td><Table.Td>{b.pos}</Table.Td>
                    <Table.Td ta="right">{money(b.surplus)}</Table.Td><Table.Td ta="right">{money(b.perceived)}</Table.Td>
                    <Table.Td>{b.pick}</Table.Td><Table.Td>{b.asking}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Text c="dimmed" fz="sm">Empty.</Text>}
        </Section>
      </SimpleGrid>
      <Section title="Standings">
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {[d.standings.slice(0, 16), d.standings.slice(16)].map((half, h) => (
            <Table key={h} fz="sm" verticalSpacing={3} highlightOnHover>
              <Table.Tbody>
                {half.map((s, i) => (
                  <Table.Tr key={s.team} fw={s.org === "Halifax" ? 700 : undefined} bg={s.org === "Halifax" ? "var(--mantine-color-blue-light)" : undefined}>
                    <Table.Td w={30} c="dimmed">{h * 16 + i + 1}</Table.Td>
                    <Table.Td>{s.org ? <Anchor component={Link} to={`/roster?org=${encodeURIComponent(s.org)}`} fz="sm">{s.team}</Anchor> : s.team}</Table.Td>
                    <Table.Td ta="right">{s.w}–{s.l}</Table.Td><Table.Td ta="right" c="dimmed">{s.pct.toFixed(3)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ))}
        </SimpleGrid>
        <Group mt="xs"><Text fz="xs" c="dimmed">From the latest box scores.</Text></Group>
      </Section>
    </Stack>
  );
}
