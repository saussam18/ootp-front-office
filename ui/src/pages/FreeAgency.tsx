import { useState } from "react";
import { Anchor, Button, Group, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type FaDeparture, type FaYear } from "../api";
import { ContractEnds } from "../components/ContractEnds";
import { FaTimeline } from "../components/FaTimeline";
import { Failed, Loading, PageTitle, PlayerLink, Section } from "../components/ui";
import { money, num } from "../format";

type Departure = FaDeparture;
type Year = FaYear;

function PlanCell({ year, d, pool }: { year: number; d: Departure; pool: Year["pool"] }) {
  const qc = useQueryClient();
  const [rid, setRid] = useState<string | null>(d.plan?.replacement_id ? String(d.plan.replacement_id) : null);
  const [label, setLabel] = useState(d.plan?.replacement_label ?? "");
  const [note, setNote] = useState(d.plan?.note ?? "");
  const dirty = (rid ?? null) !== (d.plan?.replacement_id ? String(d.plan.replacement_id) : null)
    || label !== (d.plan?.replacement_label ?? "") || note !== (d.plan?.note ?? "");
  const save = useMutation({
    mutationFn: () => api.put("/api/fa", { year, departing_id: d.id ?? 0, departing_label: d.label, replacement_id: rid ? Number(rid) : null,
      replacement_label: rid ? "" : label, note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fa"] }); qc.invalidateQueries({ queryKey: ["board"] }); },
  });
  return (
    <Group gap={6} wrap="nowrap">
      <Select size="xs" w={210} searchable clearable placeholder="Internal replacement" value={rid} onChange={setRid}
        data={pool.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` }))} />
      {!rid && <TextInput size="xs" w={170} placeholder="or FA / trade target" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />}
      <TextInput size="xs" w={160} placeholder="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Button size="xs" variant={dirty ? "filled" : "default"} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </Group>
  );
}

export function FreeAgency() {
  const q = useQuery({ queryKey: ["fa"], queryFn: () => api.get<{ years: Year[] }>("/api/fa") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;

  return (
    <Stack gap="lg">
      <PageTitle sub={<>Each season lists who's gone before it (contract, extension or team control ends), what he'd be worth if you kept him,
        and your replacement plan. Internal options are the model's best org players under control that season at the same position group.
        See also the <Anchor component={Link} to="/reports/fa_board">free agent board</Anchor> and <Anchor component={Link} to="/reports/resign">re-sign or let walk</Anchor>.</>}>
        Free agency planning
      </PageTitle>
      <FaTimeline years={q.data.years} />
      <ContractEnds />
      {q.data.years.map((y) => (
        <Section key={y.year} title={`Gone before ${y.year}`}>
          <Table.ScrollContainer minWidth={1100}>
            <Table fz="sm" verticalSpacing={6}>
              <Table.Thead><Table.Tr><Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th>Age</Table.Th><Table.Th ta="right">Salary</Table.Th>
                <Table.Th ta="right" style={{ whiteSpace: "nowrap" }}>xWAR {y.year}</Table.Th><Table.Th ta="right">Worth</Table.Th><Table.Th ta="right">Typical</Table.Th>
                <Table.Th>Internal options</Table.Th><Table.Th>Your plan</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {y.rows.map((d) => (
                  <Table.Tr key={`${d.id}${d.label}`}>
                    <Table.Td style={{ whiteSpace: "nowrap" }}><PlayerLink id={d.id} name={d.name} />{d.lev && d.lev !== "RLB" && <Text span fz="xs" c="dimmed"> {d.lev}</Text>}</Table.Td>
                    <Table.Td>{d.pos}</Table.Td><Table.Td>{d.age}</Table.Td><Table.Td ta="right">{money(d.salary)}</Table.Td>
                    <Table.Td ta="right">{num(d.xwar)}</Table.Td><Table.Td ta="right">{money(d.worth)}</Table.Td><Table.Td ta="right">{money(d.price)}</Table.Td>
                    <Table.Td>
                      <Stack gap={0} style={{ whiteSpace: "nowrap" }}>{d.options.map((o) => <Group key={o.id} gap={4} wrap="nowrap"><PlayerLink id={o.id} name={o.name} /><Text fz="xs" c="dimmed">{num(o.xwar)}</Text></Group>)}</Stack>
                    </Table.Td>
                    <Table.Td><PlanCell year={y.year} d={d} pool={y.pool} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      ))}
    </Stack>
  );
}
