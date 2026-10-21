import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type FaDeparture, type FaYear } from "../api";
import { ContractEnds } from "../components/ContractEnds";
import { FaTimeline } from "../components/FaTimeline";
import { Button, Combobox, Empty, Failed, Input, Loading, Num, PageTitle, PlayerLink, Section, Table, Td, TextLink, Th, useReadOnly } from "../components/ui";
import { displayName, money } from "../format";

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
    <div className="flex items-center gap-1.5">
      <Combobox className="w-52" width={300} clearable placeholder="Internal replacement" value={rid} onChange={setRid}
        options={pool.map((p) => ({ value: String(p.id), label: `${displayName(p.name)} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` }))} />
      {!rid && <Input className="w-44" placeholder="or FA / trade target" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />}
      <Input className="w-40" placeholder="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}

// The saved plan, as text (read-only demo).
function PlanText({ d }: { d: Departure }) {
  const p = d.plan;
  const rep = p?.replacement_id ? <PlayerLink id={p.replacement_id} name={p.replacement_name ?? ""} /> : p?.replacement_label || null;
  if (!rep && !p?.note) return <span className="text-[13px] font-medium text-bad">No plan</span>;
  return (
    <span className="text-[13px]">
      {rep && <span className="text-muted">→ {rep}</span>}
      {p?.note && <span className="ml-2 text-xs text-muted">{p.note}</span>}
    </span>
  );
}

export function FreeAgency() {
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["fa"], queryFn: () => api.get<{ years: Year[] }>("/api/fa") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;

  return (
    <div className="space-y-4">
      <PageTitle sub={<>Each season lists who's gone before it (contract, extension or team control ends), what he'd be worth if you kept him,
        and your replacement plan. Internal options are the model's best org players under control that season at the same position group.
        See also the <TextLink to="/reports/fa_board">free agent board</TextLink> and <TextLink to="/reports/resign">re-sign or let walk</TextLink>.</>}>
        Free agency planning
      </PageTitle>
      <FaTimeline years={q.data.years} />
      <ContractEnds />
      {q.data.years.map((y) => (
        <Section key={y.year} title={`Gone before ${y.year}`}>
          {y.rows.length === 0 ? <Empty>No regulars leaving.</Empty> : (
            <Table minWidth={1100}>
              <thead><tr><Th>Player</Th><Th>Pos</Th><Th right>Age</Th><Th right>Salary</Th><Th right>xWAR {y.year}</Th><Th right>Worth</Th><Th right>Typical</Th>
                <Th>Internal options</Th><Th>Your plan</Th></tr></thead>
              <tbody>
                {y.rows.map((d) => (
                  <tr key={`${d.id}${d.label}`}>
                    <Td className="whitespace-nowrap"><PlayerLink id={d.id} name={d.name} />{d.lev && d.lev !== "RLB" && <span className="ml-1 text-xs text-faint">{d.lev}</span>}</Td>
                    <Td className="text-muted">{d.pos}</Td><Td right>{d.age ?? ""}</Td><Td right>{money(d.salary)}</Td>
                    <Td right><Num v={d.xwar} /></Td><Td right>{money(d.worth)}</Td><Td right>{money(d.price)}</Td>
                    <Td>
                      <div className="space-y-0.5 whitespace-nowrap">
                        {d.options.map((o) => (
                          <div key={o.id} className="flex items-center gap-1.5"><PlayerLink id={o.id} name={o.name} /><Num v={o.xwar} className="text-xs text-muted" /></div>
                        ))}
                      </div>
                    </Td>
                    <Td>{readOnly ? <PlanText d={d} /> : <PlanCell year={y.year} d={d} pool={y.pool} />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      ))}
    </div>
  );
}
