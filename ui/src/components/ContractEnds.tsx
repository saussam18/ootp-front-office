import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { money } from "../format";
import { Input, Loading, Num, PlayerLink, Section, Select, Table, Td, Th, cn, useReadOnly } from "./ui";

interface Contract { id: number; name: string; pos: string; age: number; lev: string | null; salary: number | null; yl: number | null;
  status: string; model_last: number; last: number | null; note: string; xwar: number | null }

const REFRESH = ["contracts", "plan", "forty"];

function Row({ c, years, season, readOnly }: { c: Contract; years: number[]; season: number; readOnly: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(c.note);
  const save = useMutation({
    mutationFn: (v: { last: number | null; note: string }) => api.put(`/api/contracts/${c.id}`, { last_season: v.last, note: v.note }),
    onSuccess: () => REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  const label = (y: number) => (y === season ? `${y} (gone after this season)` : `through ${y}`);
  const data = [{ value: "model", label: `Model: ${label(c.model_last)}` }, ...years.filter((y) => y !== c.model_last).map((y) => ({ value: String(y), label: label(y) }))];
  const mine = c.last !== null;
  return (
    <tr className={cn(mine && "bg-accent-soft/60")}>
      <Td className="whitespace-nowrap"><PlayerLink id={c.id} name={c.name} />{c.lev !== "RLB" && <span className="ml-1 text-xs text-faint">{c.lev}</span>}</Td>
      <Td className="text-muted">{c.pos}</Td><Td right>{c.age}</Td>
      <Td right>{money(c.salary)}</Td>
      <Td className="whitespace-nowrap text-xs text-muted">{c.yl ? `${c.yl} yr${c.yl > 1 ? "s" : ""} left` : ""} {c.status}</Td>
      <Td right><Num v={c.xwar} /></Td>
      <Td className="w-64">
        {readOnly ? (
          <span className={cn("text-[13px]", mine ? "font-medium text-accent" : "text-muted")}>{mine ? label(c.last!) : `Model: ${label(c.model_last)}`}</span>
        ) : (
          <Select value={c.last === null ? "model" : String(c.last)}
            onChange={(e) => { const v = e.currentTarget.value; save.mutate({ last: v === "model" ? null : Number(v), note }); }}>
            {data.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}
      </Td>
      <Td className="w-60">
        {readOnly ? <span className="text-xs text-muted">{c.note}</span> : (
          <Input placeholder="why (team option declined, release…)" value={note} onChange={(e) => setNote(e.currentTarget.value)}
            onBlur={() => c.last !== null && note !== c.note && save.mutate({ last: c.last, note })} />
        )}
      </Td>
    </tr>
  );
}

// When each player's control ends: the model's read of the contract, or your call (team options aren't in the export).
export function ContractEnds() {
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["contracts"], queryFn: () => api.get<{ season: number; years: number[]; players: Contract[] }>("/api/contracts") });
  if (q.isLoading) return <Loading />;
  if (!q.data) return null;
  const d = q.data;
  return (
    <Section title="Contract end dates" right={<span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent-soft ring-1 ring-accent/30" /> your call</span>}>
      <p className="mb-3 max-w-3xl text-[13px] text-muted">The export counts team option years as guaranteed. Set when a player's control really ends (declined or
        exercised options, planned releases, extensions) and the plan follows: who is on each season's roster, the lineup and staff built from it, and the 40-man.</p>
      <Table minWidth={900}>
        <thead><tr><Th>Player</Th><Th>Pos</Th><Th right>Age</Th><Th right>Salary</Th><Th>Contract</Th><Th right>xWAR</Th><Th>Under control</Th><Th>Note</Th></tr></thead>
        <tbody>{d.players.map((c) => <Row key={c.id} c={c} years={d.years} season={d.season} readOnly={readOnly} />)}</tbody>
      </Table>
    </Section>
  );
}
