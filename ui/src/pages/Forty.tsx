import { useState } from "react";
import { Badge, Group, SegmentedControl, SimpleGrid, Stack, Switch, Table, Text, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Forty as FortyData, type FortyPlayer } from "../api";
import { Failed, Loading, PageTitle, PlayerLink, Section, Stat } from "../components/ui";
import { money, num } from "../format";

const ADVICE = {
  protect: { color: "orange", label: "Protect", tip: "Worth $5M+ to you, a 1.5+ xWAR peak, or a ranked prospect: someone will take him" },
  consider: { color: "yellow", label: "Consider", tip: "Some value ($2M+ or a 1+ xWAR peak)" },
  expose: { color: "gray", label: "Expose", tip: "Little risk in leaving him off" },
};

function PlanToggle({ p, labels }: { p: FortyPlayer; labels: [string, string] }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (status: string) => api.put(`/api/forty/${p.id}`, { status: status === "undecided" ? null : status, note: p.note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["forty"] }); qc.invalidateQueries({ queryKey: ["board"] }); },
  });
  return (
    <SegmentedControl size="xs" value={p.plan ?? "undecided"} onChange={(v) => save.mutate(v)}
      data={[{ value: "on", label: labels[0] }, { value: "undecided", label: "–" }, { value: "off", label: labels[1] }]} />
  );
}

function Cols({ extra }: { extra?: string[] }) {
  return (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th>Lvl</Table.Th><Table.Th>Age</Table.Th>
        {extra?.map((e) => <Table.Th key={e}>{e}</Table.Th>)}
        <Table.Th ta="right">xWAR</Table.Th><Table.Th ta="right">Peak</Table.Th><Table.Th ta="right">Value</Table.Th>
        <Table.Th ta="right"><Tooltip label="OOTP's OPT and OY columns (Financial Info view)" withArrow><span>OPT / OY</span></Tooltip></Table.Th>
        <Table.Th>Plan</Table.Th>
      </Table.Tr>
    </Table.Thead>
  );
}

export function Forty() {
  const q = useQuery({ queryKey: ["forty"], queryFn: () => api.get<FortyData>("/api/forty") });
  const [showAll, setShowAll] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;
  const eligibleNow = d.exposed.filter((p) => p.eligible_now);
  const now = showAll ? eligibleNow : eligibleNow.filter((p) => p.advice !== "expose" || p.plan);
  const later = d.exposed.filter((p) => !p.eligible_now);
  const row = (p: FortyPlayer, extra: React.ReactNode, labels: [string, string]) => (
    <Table.Tr key={p.id} opacity={p.leaving ? 0.55 : 1}>
      <Table.Td style={{ whiteSpace: "nowrap" }}><PlayerLink id={p.id} name={p.name} />{p.prospect_rank && <Text span fz="xs" c="dimmed"> #{p.prospect_rank}</Text>}</Table.Td>
      <Table.Td>{p.pos}</Table.Td><Table.Td>{p.lev}</Table.Td><Table.Td>{p.age}</Table.Td>
      {extra}
      <Table.Td ta="right">{num(p.xwar)}</Table.Td><Table.Td ta="right">{num(p.peak)}</Table.Td><Table.Td ta="right">{money(p.surplus)}</Table.Td>
      <Table.Td ta="right" c="dimmed">{num(p.opt, 0)} / {num(p.oy, 0)}</Table.Td>
      <Table.Td>{p.leaving ? <Text fz="xs" c="dimmed">leaving</Text> : <PlanToggle p={p} labels={labels} />}</Table.Td>
    </Table.Tr>
  );

  return (
    <Stack gap="lg">
      <PageTitle sub={<>Rule 5 eligibility from each player's first pro contract (draft or international signing): eligible for the December draft
        after his 4th season if he signed at 18 or younger, after his 3rd if older. That matches every Rule 5 pick in the league's history.
        Plans you set here (keep/drop, protect/expose) feed the projected count.</>}>40-man roster</PageTitle>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="On the 40-man" value={`${d.count}/40`} />
        <Stat label="Leaving after the season" value={d.leaving} sub="contracts ending or marked as leaving" />
        <Stat label="Planned" value={`−${d.planned_drops} / +${d.planned_adds}`} sub="drops / Rule 5 protections" />
        <Stat label="Projected" value={`${d.projected}/40`} sub={`${40 - d.projected} open spots for free agents and trades`} />
      </SimpleGrid>

      <Section title={`Rule 5 eligible this December (${d.rule5_year}), not on the 40-man`}
        right={<Switch size="xs" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)}
          label={`Show all ${eligibleNow.length} (${eligibleNow.length - eligibleNow.filter((p) => p.advice !== "expose").length} safe to expose)`} />}>
        <Table.ScrollContainer minWidth={900}>
          <Table fz="sm" verticalSpacing={4} highlightOnHover>
            <Cols extra={["Signed", "Advice"]} />
            <Table.Tbody>
              {now.map((p) => row(p, (
                <>
                  <Table.Td c="dimmed" fz="xs" style={{ whiteSpace: "nowrap" }}>{p.signed?.slice(0, 4)} {p.how === "drafted" ? "draft" : "intl"}</Table.Td>
                  <Table.Td><Tooltip label={ADVICE[p.advice!].tip} withArrow multiline w={260}><Badge size="sm" variant="light" color={ADVICE[p.advice!].color}>{ADVICE[p.advice!].label}</Badge></Tooltip></Table.Td>
                </>
              ), ["Protect", "Expose"]))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <Section title="Current 40-man" right={<Text fz="xs" c="dimmed">dimmed = leaving · ⚠ = drop candidate (little value, low peak)</Text>}>
        <Table.ScrollContainer minWidth={900}>
          <Table fz="sm" verticalSpacing={4} highlightOnHover>
            <Cols extra={[""]} />
            <Table.Tbody>
              {d.current.map((p) => row(p, (
                <Table.Td>{p.drop_candidate && <Tooltip label="Drop candidate: under $1M of value and a peak under 1 xWAR" withArrow><Text span c="orange">⚠</Text></Tooltip>}</Table.Td>
              ), ["Keep", "Drop"]))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      {later.length > 0 && (
        <Section title={`Eligible next December (${d.rule5_year + 1})`}>
          <Table.ScrollContainer minWidth={900}>
            <Table fz="sm" verticalSpacing={4}>
              <Cols extra={["Signed", "Advice"]} />
              <Table.Tbody>
                {later.map((p) => row(p, (
                  <>
                    <Table.Td c="dimmed" fz="xs">{p.signed?.slice(0, 4)} {p.how === "drafted" ? "draft" : "intl"}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={ADVICE[p.advice!].color}>{ADVICE[p.advice!].label}</Badge></Table.Td>
                  </>
                ), ["Protect", "Expose"]))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}
      <Group><Text fz="xs" c="dimmed">Value = our surplus value in $M over his controlled seasons.</Text></Group>
    </Stack>
  );
}
