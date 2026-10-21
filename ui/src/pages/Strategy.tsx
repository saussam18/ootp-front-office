import { useEffect, useState } from "react";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BlockRow, type Pick } from "../api";
import { PlayerPicker } from "../components/PlayerPicker";
import { Button, Empty, Failed, IconButton, Input, Loading, Num, PageTitle, PlayerLink, Section, Table, Td, TextLink, Textarea, Th,
  useReadOnly } from "../components/ui";
import { money } from "../format";

interface Strat { notes: Record<string, string>; block: BlockRow[] }

function Note({ k, label, initial }: { k: string; label: string; initial: string }) {
  const readOnly = useReadOnly();
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(true);
  useEffect(() => setBody(initial), [initial]);
  const save = useMutation({ mutationFn: () => api.put(`/api/notes/${k}`, { body }), onSuccess: () => setSaved(true) });
  return (
    <Section title={label} right={!readOnly && <span className={saved ? "text-faint" : "text-warn"}>{saved ? "Saved" : "Unsaved"}</span>}>
      {readOnly ? (
        body ? <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{body}</div> : <Empty>No notes.</Empty>
      ) : (
        <Textarea rows={6} className="field-sizing-content min-h-28" value={body} onChange={(e) => { setBody(e.currentTarget.value); setSaved(false); }}
          onBlur={() => !saved && save.mutate()} />
      )}
    </Section>
  );
}

export function Strategy({ embedded }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
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
    <div className="space-y-4">
      {!embedded && <PageTitle>Team strategy</PageTitle>}
      <Note k="moves" label="Planned moves" initial={d.notes.moves ?? ""} />

      <Section title="Trade block">
        {d.block.length ? (
          <Table minWidth={800}>
            <thead><tr><Th>Player</Th><Th>Pos</Th><Th right>Age</Th><Th>Lvl</Th>
              <Th right>Opt yrs</Th><Th right>xWAR</Th><Th right>Value</Th><Th right>Other GMs</Th>
              <Th>≈ pick</Th><Th>Asking</Th><Th>Note</Th><Th /></tr></thead>
            <tbody>
              {d.block.map((b) => (
                <tr key={b.player_id} className="hover:bg-sunken/60">
                  <Td><PlayerLink id={b.player_id} name={b.name} /></Td><Td className="text-muted">{b.pos}</Td><Td right>{b.age}</Td>
                  <Td className="text-muted">{b.lev ?? "FA"}</Td>
                  <Td right><Num v={b.oy} digits={0} /></Td><Td right><Num v={b.xwar_next} /></Td>
                  <Td right>{money(b.surplus)}</Td><Td right>{money(b.perceived)}</Td>
                  <Td>{b.pick}</Td><Td>{b.asking}</Td><Td className="text-xs text-muted">{b.note}</Td>
                  <Td>
                    <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                      <TextLink to={`/market?tab=trade&mode=shop&give=${b.player_id}`}>Shop</TextLink>
                      <TextLink to={`/market?tab=trade&mode=comps&give=${b.player_id}`}>Comps</TextLink>
                      {!readOnly && (
                        <IconButton label="Remove" className="size-6 hover:bg-bad-soft hover:text-bad" onClick={() => delBlock.mutate(b.player_id)}>
                          <IconTrash size={14} />
                        </IconButton>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty>Nobody on the block.</Empty>}
        {!readOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="w-72"><PlayerPicker value={blockPick} onChange={setBlockPick} scope="mine" single placeholder="Add one of your players…" /></div>
            <Input className="w-56" placeholder="Asking (e.g. 4th round pick)" value={asking} onChange={(e) => setAsking(e.currentTarget.value)} />
            <Input className="w-56" placeholder="Note" value={blockNote} onChange={(e) => setBlockNote(e.currentTarget.value)} />
            <Button variant="primary" disabled={!blockPick.length} onClick={() => addBlock.mutate()}>Add to block</Button>
          </div>
        )}
      </Section>

      <p className="text-[13px] text-muted">The 40-man fringe (keep / drop, Rule 5 protection) lives on the <TextLink to="/">Plan</TextLink>,
        and the moves you've made are logged automatically on <TextLink to="/log">Moves</TextLink>.</p>
    </div>
  );
}
