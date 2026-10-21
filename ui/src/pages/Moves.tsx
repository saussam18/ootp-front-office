import { useMemo, useState } from "react";
import { Badge, Group, SegmentedControl, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type Move } from "../api";
import { Failed, Loading, PageTitle, PlayerLink, Section } from "../components/ui";

const COLORS: Record<string, string> = { trade: "grape", signing: "teal", release: "red", draft: "blue", roster: "gray", injury: "orange", staff: "gray", other: "gray" };

function Note({ m }: { m: Move }) {
  const [v, setV] = useState(m.note);
  const save = useMutation({ mutationFn: () => api.put(`/api/moves/${m.key}`, { body: v }) });
  return <TextInput size="xs" variant="unstyled" placeholder="add a note…" value={v} onChange={(e) => setV(e.currentTarget.value)}
    onBlur={() => v !== m.note && save.mutate()} />;
}

export function Moves() {
  const q = useQuery({ queryKey: ["moves"], queryFn: () => api.get<{ moves: Move[] }>("/api/moves") });
  const [view, setView] = useState("key");
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const all = q.data?.moves ?? [];
    const s = search.toLowerCase();
    return all.filter((m) => (view === "all" || (view === "key" ? m.key_move : m.kind === view))
      && (!s || m.parts.map((p) => p.text).join("").toLowerCase().includes(s) || m.note.toLowerCase().includes(s)));
  }, [q.data, view, search]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;

  return (
    <Stack gap="lg">
      <PageTitle sub="Read from the league's transaction logs every refresh (trades from the player histories). Add your own notes to any move.">Moves</PageTitle>
      <Group>
        <SegmentedControl value={view} onChange={setView} data={[
          { value: "key", label: "Key moves" }, { value: "trade", label: "Trades" }, { value: "signing", label: "Signings" },
          { value: "release", label: "Releases & claims" }, { value: "draft", label: "Draft" }, { value: "roster", label: "Roster" },
          { value: "injury", label: "Injuries" }, { value: "all", label: "Everything" }]} />
        <TextInput leftSection={<IconSearch size={14} />} placeholder="Search…" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
      </Group>
      <Section title={`${shown.length} moves`}>
        <Table fz="sm" verticalSpacing={4} highlightOnHover>
          <Table.Tbody>
            {shown.slice(0, 500).map((m) => (
              <Table.Tr key={m.key}>
                <Table.Td w={100} c="dimmed" fz="xs" style={{ whiteSpace: "nowrap" }}>{m.date}</Table.Td>
                <Table.Td w={90}><Badge size="sm" variant="light" color={COLORS[m.kind] ?? "gray"}>{m.kind}</Badge></Table.Td>
                <Table.Td>
                  <Text fz="sm">{m.parts.map((p, i) => p.player_id ? <PlayerLink key={i} id={p.player_id} name={p.text} /> : <span key={i}>{p.text}</span>)}</Text>
                </Table.Td>
                <Table.Td w={260}><Note m={m} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {shown.length > 500 && <Text fz="xs" c="dimmed" mt="xs">Showing the latest 500; narrow it with the filters.</Text>}
      </Section>
    </Stack>
  );
}
