import { useEffect, useState } from "react";
import { ActionIcon, Anchor, Button, Group, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type BlockRow, type Pick } from "../api";
import { PlayerPicker } from "../components/PlayerPicker";
import { Failed, Loading, PageTitle, PlayerLink, Section } from "../components/ui";
import { money, num } from "../format";

interface Strat { notes: Record<string, string>; block: BlockRow[] }

function Note({ k, label, initial }: { k: string; label: string; initial: string }) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(true);
  useEffect(() => setBody(initial), [initial]);
  const save = useMutation({ mutationFn: () => api.put(`/api/notes/${k}`, { body }), onSuccess: () => setSaved(true) });
  return (
    <Section title={label} right={<Text fz="xs" c={saved ? "dimmed" : "orange"}>{saved ? "saved" : "unsaved"}</Text>}>
      <Textarea autosize minRows={5} value={body} onChange={(e) => { setBody(e.currentTarget.value); setSaved(false); }}
        onBlur={() => !saved && save.mutate()} />
    </Section>
  );
}

export function Strategy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["strategy"], queryFn: () => api.get<Strat>("/api/strategy") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["strategy"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const [blockPick, setBlockPick] = useState<Pick[]>([]);
  const [asking, setAsking] = useState("");
  const [blockNote, setBlockNote] = useState("");
  const addBlock = useMutation({
    mutationFn: () => api.post("/api/block", { player_id: blockPick[0].id, asking, note: blockNote }),
    onSuccess: () => { setBlockPick([]); setAsking(""); setBlockNote(""); refresh(); },
  });
  const delBlock = useMutation({ mutationFn: (id: number) => api.del(`/api/block/${id}`), onSuccess: refresh });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;

  return (
    <Stack gap="lg">
      <PageTitle>Team strategy</PageTitle>
      <Note k="moves" label="Planned moves" initial={d.notes.moves ?? ""} />

      <Section title="Trade block">
        <Table.ScrollContainer minWidth={800}>
          <Table fz="sm" verticalSpacing={4} highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>Player</Table.Th><Table.Th>Pos</Table.Th><Table.Th>Age</Table.Th><Table.Th>Lvl</Table.Th>
              <Table.Th ta="right">Opt yrs</Table.Th><Table.Th ta="right">xWAR</Table.Th><Table.Th ta="right">Value</Table.Th><Table.Th ta="right">Other GMs</Table.Th>
              <Table.Th>≈ pick</Table.Th><Table.Th>Asking</Table.Th><Table.Th>Note</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {d.block.map((b) => (
                <Table.Tr key={b.player_id}>
                  <Table.Td><PlayerLink id={b.player_id} name={b.name} /></Table.Td><Table.Td>{b.pos}</Table.Td><Table.Td>{b.age}</Table.Td><Table.Td>{b.lev ?? "FA"}</Table.Td>
                  <Table.Td ta="right">{num(b.oy, 0)}</Table.Td><Table.Td ta="right">{num(b.xwar_next)}</Table.Td>
                  <Table.Td ta="right">{money(b.surplus)}</Table.Td><Table.Td ta="right">{money(b.perceived)}</Table.Td>
                  <Table.Td>{b.pick}</Table.Td><Table.Td>{b.asking}</Table.Td><Table.Td><Text fz="xs" c="dimmed">{b.note}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Anchor component={Link} to={`/trade?mode=shop&give=${b.player_id}`} fz="xs">shop</Anchor>
                      <Anchor component={Link} to={`/trade?mode=comps&give=${b.player_id}`} fz="xs">comps</Anchor>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => delBlock.mutate(b.player_id)} aria-label="Remove"><IconTrash size={14} /></ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group mt="sm" align="flex-end" gap="xs">
          <div style={{ width: 300 }}><PlayerPicker value={blockPick} onChange={setBlockPick} scope="mine" single placeholder="Add one of your players…" /></div>
          <TextInput placeholder="Asking (e.g. 4th round pick)" value={asking} onChange={(e) => setAsking(e.currentTarget.value)} />
          <TextInput placeholder="Note" value={blockNote} onChange={(e) => setBlockNote(e.currentTarget.value)} />
          <Button disabled={!blockPick.length} onClick={() => addBlock.mutate()}>Add to block</Button>
        </Group>
      </Section>

      <Text fz="sm" c="dimmed">The 40-man fringe (keep / drop, Rule 5 protection) lives on the <Anchor component={Link} to="/forty">40-man page</Anchor>,
        and the moves you've made are logged automatically on <Anchor component={Link} to="/moves">Moves</Anchor>.</Text>
    </Stack>
  );
}
