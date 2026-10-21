import { useState } from "react";
import { Select, Table, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { money, num } from "../format";
import { Loading, PlayerLink, Section } from "./ui";

interface Contract { id: number; name: string; pos: string; age: number; lev: string | null; salary: number | null; yl: number | null;
  status: string; model_last: number; last: number | null; note: string; xwar: number | null }

const REFRESH = ["contracts", "fa", "board", "plans", "forty", "dashboard"];

function Row({ c, years, season }: { c: Contract; years: number[]; season: number }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(c.note);
  const save = useMutation({
    mutationFn: (v: { last: number | null; note: string }) => api.put(`/api/contracts/${c.id}`, { last_season: v.last, note: v.note }),
    onSuccess: () => REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  const label = (y: number) => (y === season ? `${y} (gone after this season)` : `through ${y}`);
  const data = [{ value: "model", label: `Model: ${label(c.model_last)}` }, ...years.filter((y) => y !== c.model_last).map((y) => ({ value: String(y), label: label(y) }))];
  return (
    <Table.Tr bg={c.last !== null ? "var(--mantine-color-blue-light)" : undefined}>
      <Table.Td style={{ whiteSpace: "nowrap" }}><PlayerLink id={c.id} name={c.name} />{c.lev !== "RLB" && <Text span fz="xs" c="dimmed"> {c.lev}</Text>}</Table.Td>
      <Table.Td>{c.pos}</Table.Td><Table.Td>{c.age}</Table.Td>
      <Table.Td ta="right">{money(c.salary)}</Table.Td>
      <Table.Td c="dimmed" fz="xs">{c.yl ? `${c.yl} yr${c.yl > 1 ? "s" : ""} left` : ""} {c.status}</Table.Td>
      <Table.Td ta="right">{num(c.xwar)}</Table.Td>
      <Table.Td w={260}>
        <Select size="xs" data={data} value={c.last === null ? "model" : String(c.last)} allowDeselect={false}
          onChange={(v) => save.mutate({ last: v === "model" || v === null ? null : Number(v), note })} />
      </Table.Td>
      <Table.Td w={240}>
        <TextInput size="xs" placeholder="why (team option declined, release…)" value={note} onChange={(e) => setNote(e.currentTarget.value)}
          onBlur={() => c.last !== null && note !== c.note && save.mutate({ last: c.last, note })} />
      </Table.Td>
    </Table.Tr>
  );
}

// When each player's control ends: the model's read of the contract, or your call (team options aren't in the export).
export function ContractEnds() {
  const q = useQuery({ queryKey: ["contracts"], queryFn: () => api.get<{ season: number; years: number[]; players: Contract[] }>("/api/contracts") });
  if (q.isLoading) return <Loading />;
  if (!q.data) return null;
  const d = q.data;
  return (
    <Section title="Contract end dates" right={<Text fz="xs" c="dimmed">highlighted = your call</Text>}>
      <Text fz="sm" c="dimmed" mb="sm">The export counts team option years as guaranteed. Set when a player's control really ends (declined or
        exercised options, planned releases, extensions) and every page follows: lineups, free agency, the team plan and the 40-man.</Text>
      <Table.ScrollContainer minWidth={900}>
        <Table fz="sm" verticalSpacing={4} highlightOnHover>
          <Table.Thead><Table.Tr><Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th>Age</Table.Th><Table.Th ta="right">Salary</Table.Th>
            <Table.Th>Contract</Table.Th><Table.Th ta="right">xWAR</Table.Th><Table.Th>Under control</Table.Th><Table.Th>Note</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{d.players.map((c) => <Row key={c.id} c={c} years={d.years} season={d.season} />)}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Section>
  );
}
