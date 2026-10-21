import { Alert, Anchor, Box, Group, SimpleGrid, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Board as BoardData, type Plan, type PlanRow } from "../api";
import { FaTimeline } from "../components/FaTimeline";
import { Failed, Loading, PlayerLink, Section } from "../components/ui";
import { isNum, num } from "../format";

type Players = BoardData["players"];

const DOT: Record<string, { color: string; tip: string }> = {
  upgrade: { color: "var(--mantine-color-orange-6)", tip: "Upgrade target: 0.3+ season xWAR below the league median here" },
  strong: { color: "var(--mantine-color-teal-6)", tip: "Strong: 0.5+ season xWAR above the league median here" },
  leaving: { color: "var(--mantine-color-red-6)", tip: "Your pick isn't under control this season" },
  empty: { color: "var(--mantine-color-red-6)", tip: "Open" },
};

function Flag({ r }: { r: PlanRow }) {
  const d = DOT[r.status];
  if (!d || !r.counts) return null;
  return (
    <Tooltip label={r.status === "upgrade" ? `${d.tip} (${num(r.value)} vs ${num(r.median)})` : r.was ? `${r.was.name} leaving` : d.tip} withArrow>
      <Box w={8} h={8} style={{ borderRadius: 8, background: d.color, flexShrink: 0 }} />
    </Tooltip>
  );
}

// A compact read-only plan block, like a section of the old notes sheet.
function Block({ plan, players, hand, title }: { plan: Plan; players: Players; hand: "b" | "t"; title?: string }) {
  const starters = plan.rows.filter((r) => r.counts);
  const bench = plan.rows.filter((r) => !r.counts && (r.player_id || r.label));
  const name = (r: PlanRow) => {
    if (r.player_id) {
      const p = players[String(r.player_id)];
      return (
        <Group gap={6} wrap="nowrap">
          <PlayerLink id={r.player_id} name={p?.name ?? String(r.player_id)} />
          <Text fz="xs" c="dimmed">{p?.[hand]?.[0]}</Text>
          {p?.lev && p.lev !== "RLB" && <Text fz="xs" c="dimmed">{p.lev}</Text>}
        </Group>
      );
    }
    const next = r.suggest && (
      <Tooltip label="Best player under control who isn't already in this lineup" withArrow>
        <Group gap={4} wrap="nowrap">
          <Text fz="sm" c="dimmed">→</Text>
          <PlayerLink id={r.suggest.id} name={r.suggest.name} />
          <Text fz="xs" c="dimmed">{players[String(r.suggest.id)]?.[hand]?.[0]} {num(r.suggest.value)}</Text>
        </Group>
      </Tooltip>
    );
    if (r.was || (r.counts && !r.label)) return (
      <Group gap={8} wrap="nowrap">
        <Text fz="sm" c="red">{r.was ? `was ${r.was.name}` : "open"}</Text>
        {next}
      </Group>
    );
    if (r.label) return <Text fz="sm" c="dimmed">{r.label}?</Text>;
    return <Text fz="sm" c="red">—</Text>;
  };
  return (
    <Section title={<>{title ?? plan.title}</>} right={<Anchor component={Link} to={`/plans#${plan.key}`} fz="xs">edit</Anchor>}>
      <Table verticalSpacing={2} fz="sm" withRowBorders={false}>
        <Table.Tbody>
          {starters.map((r) => (
            <Table.Tr key={r.slot}>
              <Table.Td w={44} fw={700} c="dimmed" fz="xs">{r.slot}</Table.Td>
              <Table.Td>{name(r)}</Table.Td>
              <Table.Td w={40} ta="right" fz="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                {isNum(r.rate) ? <Tooltip label={`${num(r.rate)} full-season rate × ${Math.round(plan.share * 100)}% of PAs`} withArrow><span>{num(r.value)}</span></Tooltip> : num(r.value)}
              </Table.Td>
              <Table.Td w={16}><Flag r={r} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {bench.length > 0 && (
        <>
          <Text fz="xs" fw={700} c="dimmed" tt="uppercase" mt="xs" mb={2}>{plan.group === "minors" ? "" : "Bench"}</Text>
          <Stack gap={2}>
            {bench.map((r) => <div key={r.slot}>{name(r)}</div>)}
          </Stack>
        </>
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

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Halifax team plan</Title>
          <Text c="dimmed" fz="sm">Next season ({d.next}) from your lineups & staff plans, free agency by year, and the {d.core_year} core.
            Dots: <Text span c="orange">upgrade</Text> · <Text span c="teal">strong</Text> · <Text span c="red">leaving / open</Text>.</Text>
        </div>
      </Group>

      {d.must_protect.length > 0 && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title={`Rule 5: protect before the December ${d.season} draft`}>
          {d.must_protect.map((m, i) => <span key={m.id}>{i > 0 && ", "}<PlayerLink id={m.id} name={m.name} /> ({m.pos}, {m.lev}, worth {num(m.surplus)}M)</span>)}
          {" "}is eligible and not on the 40-man. <Anchor component={Link} to="/forty" fz="sm">40-man roster →</Anchor>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Section title="40-man" right={<Anchor component={Link} to="/forty" fz="xs">manage</Anchor>}>
          <Text fz={28} fw={700} lh={1.2}>{f.count}<Text span c="dimmed" fz="md">/40</Text></Text>
          <Text fz="xs" c="dimmed">{f.leaving} leaving · {f.planned_drops} planned drops · {f.planned_adds} planned adds → <b>{f.projected}</b> after the offseason</Text>
        </Section>
        <Section title={`Leaving after ${d.season}`} right={<Anchor component={Link} to="/fa" fz="xs">contract end dates</Anchor>}>
          <Text fz="sm">{d.losing.map((l, i) => <span key={l.id}>{i > 0 && ", "}<PlayerLink id={l.id} name={l.name} /></span>)}</Text>
          <Text fz="xs" c="dimmed" mt={4}>Team options aren't in the export: set declined or exercised options on the Free agency page.</Text>
        </Section>
      </SimpleGrid>

      <Title order={4} mt="xs">{d.next} lineups</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Block plan={p.lineup_vr} players={d.players} hand="b" title={`vs RHP · ${Math.round(p.lineup_vr.share * 100)}% of PAs`} />
        <Block plan={p.lineup_vl} players={d.players} hand="b" title={`vs LHP · ${Math.round(p.lineup_vl.share * 100)}% of PAs`} />
      </SimpleGrid>

      <Title order={4} mt="xs">{d.next} pitching staff</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Block plan={p.rotation} players={d.players} hand="t" />
        <Block plan={p.bullpen} players={d.players} hand="t" />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Block plan={p.minors_hit} players={d.players} hand="b" title="Minors: hitters" />
        <Block plan={p.minors_pit} players={d.players} hand="t" title="Minors: pitchers" />
      </SimpleGrid>

      <Group justify="space-between" mt="xs">
        <Title order={4}>Free agency by year</Title>
        <Anchor component={Link} to="/fa" fz="sm">plan replacements →</Anchor>
      </Group>
      <FaTimeline years={d.fa} />

      <Title order={4} mt="xs">{d.core_year} core</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Block plan={p.core_lineup} players={d.players} hand="b" title="Lineup" />
        <Block plan={p.core_rotation} players={d.players} hand="t" title="Rotation" />
      </SimpleGrid>
    </Stack>
  );
}
