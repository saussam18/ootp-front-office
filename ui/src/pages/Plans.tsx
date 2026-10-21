import { useState } from "react";
import { ActionIcon, Anchor, Badge, Button, Group, Select, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconWand } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Plan, type PlanRow, type PlansResponse } from "../api";
import { Failed, Loading, PageTitle, PlayerLink, Section, Stat } from "../components/ui";
import { money, num, signed, isNum } from "../format";

type Players = PlansResponse["players"];

const STATUS: Record<string, { color: string; label: string; tip: string }> = {
  upgrade: { color: "orange", label: "Upgrade", tip: "At least 0.3 season xWAR below the median MLB team's player in this slot" },
  strong: { color: "teal", label: "Strong", tip: "At least 0.5 season xWAR above the median MLB team's player in this slot" },
  ok: { color: "gray", label: "OK", tip: "Within range of the league median" },
  empty: { color: "red", label: "Open", tip: "Nobody under control here" },
  leaving: { color: "red", label: "Leaving", tip: "Your pick isn't under control that season" },
};

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
  const label = (id: number) => {
    const p = players[String(id)];
    return p ? `${p.name} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` : String(id);
  };
  const starters = plan.rows.filter((r) => r.counts);
  const bench = plan.rows.filter((r) => !r.counts);

  const row = (r: PlanRow) => {
    const data = r.options.map((o) => ({ value: String(o.id), label: label(o.id), xwar: o.value }));
    const st = STATUS[r.status];
    const diff = isNum(r.value) && isNum(r.median) ? r.value - r.median : null;
    return (
      <Table.Tr key={r.slot}>
        <Table.Td fw={700} w={90} style={{ whiteSpace: "nowrap" }}>{r.slot}</Table.Td>
        <Table.Td w={300}>
          <Select size="xs" w={280} searchable clearable data={data} value={r.player_id ? String(r.player_id) : null}
            placeholder={r.was ? `was ${r.was.name}` : r.label ? `${r.label} (not matched)` : "— pick —"}
            onChange={(v) => save.mutate({ key: plan.key, slot: r.slot, player_id: v ? Number(v) : null })}
            renderOption={({ option }) => {
              const x = (option as unknown as { xwar: number | null }).xwar;
              return <Group justify="space-between" w="100%" wrap="nowrap"><Text fz="sm">{option.label}</Text><Text fz="xs" c="dimmed">{num(x)}</Text></Group>;
            }}
            comboboxProps={{ width: 320, position: "bottom-start" }} />
          {r.suggest && (
            <Group gap={4} mt={2} wrap="nowrap">
              <Text fz="xs" c="dimmed">next up:</Text>
              <Anchor fz="xs" onClick={() => save.mutate({ key: plan.key, slot: r.slot, player_id: r.suggest!.id })}>{r.suggest.name} ({num(r.suggest.value)})</Anchor>
            </Group>
          )}
        </Table.Td>
        <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
          {isNum(r.rate) ? (
            <Tooltip label={`${num(r.rate)} xWAR full-season rate × ${Math.round(plan.share * 100)}% of PAs`} withArrow><span>{num(r.value)}</span></Tooltip>
          ) : num(r.value)}
        </Table.Td>
        {showMedian && r.counts && (
          <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
            <Tooltip label={`League median ${num(r.median)}${isNum(r.median_rate) ? ` (${num(r.median_rate)} full-season rate)` : ""}`} withArrow>
              <Text fz="sm" c={diff === null ? "dimmed" : diff < 0 ? "orange" : "teal"}>{signed(diff)}</Text>
            </Tooltip>
          </Table.Td>
        )}
        {showMedian && !r.counts && <Table.Td />}
        <Table.Td w={100}>
          {r.counts && r.status !== "ok" && (
            <Tooltip label={r.was ? `${r.was.name} isn't under control in ${plan.year}` : st.tip} withArrow multiline w={240}>
              <Badge size="sm" variant="light" color={st.color} style={{ flexShrink: 0, overflow: "visible" }}>{st.label}</Badge>
            </Tooltip>
          )}
        </Table.Td>
        <Table.Td style={{ whiteSpace: "nowrap" }}>
          {r.model && r.counts && (
            <Group gap={4} wrap="nowrap">
              <PlayerLink id={r.model.id} name={r.model.name} />
              <Text fz="xs" c="dimmed">{num(r.model.value)}</Text>
              {r.model.id !== r.player_id && (
                <Tooltip label="Use the model's pick" withArrow>
                  <ActionIcon size="sm" variant="subtle" onClick={() => save.mutate({ key: plan.key, slot: r.slot, player_id: r.model!.id })}>
                    <IconWand size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          )}
        </Table.Td>
      </Table.Tr>
    );
  };

  return (
    <Section id={plan.key} title={<>{plan.title} <Text span c="dimmed" fz="sm" fw={500}>{plan.year}{plan.share < 1 && ` · ${Math.round(plan.share * 100)}% of PAs`}</Text></>}
      right={starters.length > 0 && (
        <Text fz="sm" c="dimmed">You <b>{num(plan.total)}</b> · model <b>{num(plan.model_total)}</b> xWAR</Text>
      )}>
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing={4} fz="sm">
          {starters.length > 0 && (
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={90}>Slot</Table.Th><Table.Th w={300}>Your pick</Table.Th><Table.Th w={70} ta="right">{plan.share < 1 ? "Season" : "xWAR"}</Table.Th>
                {showMedian && <Table.Th w={100} ta="right" style={{ whiteSpace: "nowrap" }}>vs median</Table.Th>}<Table.Th w={110}>Status</Table.Th><Table.Th>Model's pick</Table.Th>
              </Table.Tr>
            </Table.Thead>
          )}
          <Table.Tbody>
            {starters.map(row)}
            {bench.length > 0 && (
              <Table.Tr><Table.Td colSpan={6}><Text fz="xs" fw={700} c="dimmed" tt="uppercase" mt={starters.length ? 6 : 0}>
                {plan.group === "minors" ? "Watch list" : "Bench / depth"}</Text></Table.Td></Table.Tr>
            )}
            {bench.map(row)}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Section>
  );
}

function Losing({ data }: { data: PlansResponse }) {
  const qc = useQueryClient();
  const [pid, setPid] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["plans"] }); qc.invalidateQueries({ queryKey: ["board"] }); };
  const mark = useMutation({ mutationFn: () => api.put(`/api/leaving/${pid}`, { note }), onSuccess: () => { setPid(null); setNote(""); refresh(); } });
  const unmark = useMutation({ mutationFn: (id: number) => api.del(`/api/leaving/${id}`), onSuccess: refresh });
  const options = Object.entries(data.players).filter(([id]) => !data.marked[id])
    .map(([id, p]) => ({ value: id, label: `${p.name} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` }));

  return (
    <Section title={`Losing before ${data.next}`}
      right={<Text fz="xs" c="dimmed">xWAR / worth = what he'd give you in {data.next} if you kept him</Text>}>
      <Table verticalSpacing={4} fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th>Age</Table.Th><Table.Th>Why</Table.Th>
          <Table.Th ta="right">Salary</Table.Th><Table.Th ta="right">xWAR</Table.Th><Table.Th ta="right">Worth</Table.Th><Table.Th ta="right">Typical</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {data.losing.map((l) => (
            <Table.Tr key={l.id}>
              <Table.Td><PlayerLink id={l.id} name={l.name} /></Table.Td><Table.Td>{l.pos}</Table.Td><Table.Td>{l.age}</Table.Td>
              <Table.Td><Text fz="xs" c="dimmed">{l.why}</Text></Table.Td>
              <Table.Td ta="right">{money(l.salary)}</Table.Td><Table.Td ta="right">{num(l.xwar)}</Table.Td>
              <Table.Td ta="right">{money(l.worth)}</Table.Td><Table.Td ta="right">{money(l.price)}</Table.Td>
              <Table.Td>{data.marked[String(l.id)] !== undefined && (
                <Tooltip label="Undo: keep him" withArrow><ActionIcon size="sm" variant="subtle" onClick={() => unmark.mutate(l.id)}><IconArrowBackUp size={14} /></ActionIcon></Tooltip>
              )}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group mt="sm" gap="xs" align="flex-end">
        <Select size="xs" w={260} searchable data={options} value={pid} onChange={setPid} placeholder="Also letting go… (declined option, release)" />
        <TextInput size="xs" w={220} placeholder="Why (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Button size="xs" disabled={!pid} onClick={() => mark.mutate()}>Mark as leaving</Button>
      </Group>
    </Section>
  );
}

function Targets({ plans }: { plans: Plan[] }) {
  const flagged = plans.flatMap((p) => p.rows.filter((r) => r.counts && (r.status === "upgrade" || r.status === "leaving" || r.status === "empty"))
    .map((r) => ({ plan: p, r })));
  if (!flagged.length) return null;
  return (
    <Section title="Where to upgrade" right={<Text fz="xs" c="dimmed">from your picks above</Text>}>
      <Group gap="xs">
        {flagged.map(({ plan, r }) => (
          <Tooltip key={plan.key + r.slot} withArrow multiline w={260}
            label={r.status === "upgrade" ? `${num(r.value)} xWAR vs league median ${num(r.median)}` : r.was ? `${r.was.name} leaving` : "Nobody picked"}>
            <Badge component="a" href={`#${plan.key}`} variant="light" color={STATUS[r.status].color} size="lg" style={{ cursor: "pointer", textTransform: "none" }}>
              {plan.title.replace("Lineup ", "")} · {r.slot}: {r.player_id ? `${num(r.value)} vs ${num(r.median)}` : r.was ? `was ${r.was.name}` : "open"}
            </Badge>
          </Tooltip>
        ))}
      </Group>
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
    <Stack gap="lg">
      <PageTitle sub={<>Only players under contract or team control in {d.next} can be picked. Each slot is compared to the median MLB team's
        player in that slot (vs that hand for hitters): <b>Upgrade</b> means at least {d.upgrade_gap} xWAR below it over a season. Lineup
        values count only the PAs vs that hand ({Math.round(p.lineup_vr.share * 100)}% vs RHP, {Math.round(p.lineup_vl.share * 100)}% vs LHP),
        so they add up to one season; hover a value for the full-season rate. Relievers are weighted by the leverage of the role.</>}>
        {d.next} lineups & staff
      </PageTitle>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Stat label="Lineup" value={num(p.lineup_vr.total + p.lineup_vl.total)}
          sub={`vs RHP ${num(p.lineup_vr.total)} + vs LHP ${num(p.lineup_vl.total)} · model's best ${num(p.lineup_vr.model_total + p.lineup_vl.model_total)}`} />
        {[p.rotation, p.bullpen].map((pl) => (
          <Stat key={pl.key} label={pl.title} value={num(pl.total)} sub={`model's best ${num(pl.model_total)} xWAR`} />
        ))}
      </SimpleGrid>
      <Targets plans={next} />
      <Losing data={d} />
      <PlanCard plan={p.lineup_vr} players={d.players} showMedian />
      <PlanCard plan={p.lineup_vl} players={d.players} showMedian />
      <PlanCard plan={p.rotation} players={d.players} showMedian />
      <PlanCard plan={p.bullpen} players={d.players} showMedian />
      <SimpleGrid cols={{ base: 1, xl: 2 }}>
        <PlanCard plan={p.minors_hit} players={d.players} showMedian={false} />
        <PlanCard plan={p.minors_pit} players={d.players} showMedian={false} />
      </SimpleGrid>
      <Title order={3} mt="md">Core for {d.core_year}</Title>
      <Text c="dimmed" fz="sm" mt={-10}>Three seasons out: only players under control in {d.core_year}, valued at their projected {d.core_year} xWAR. Bullpen arms aren't part of the core.</Text>
      <PlanCard plan={p.core_lineup} players={d.players} showMedian={false} />
      <PlanCard plan={p.core_rotation} players={d.players} showMedian={false} />
    </Stack>
  );
}
