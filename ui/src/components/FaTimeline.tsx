import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type FaDeparture, type FaYear } from "../api";
import { displayName, num } from "../format";
import { Badge, Button, Combobox, IconButton, Input, Num, PlayerLink, Tip, useReadOnly } from "./ui";

const REPORT_POS: Record<string, string> = { CL: "RP" };
type Pool = FaYear["pool"];

function useRefresh() {
  const qc = useQueryClient();
  return () => ["fa", "board"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

const poolData = (pool: Pool) => pool.map((p) => ({ value: String(p.id), label: `${displayName(p.name)} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` }));

// A small form in a popover, anchored to its trigger.
function PopForm({ open, setOpen, trigger, title, children }: { open: boolean; setOpen: (v: boolean) => void; trigger: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-40 w-72 space-y-2 rounded-xl border border-line bg-surface p-3 shadow-xl shadow-black/10">
          <div className="text-[13px] font-semibold">{title}</div>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Pick an internal replacement (or type a free agent / trade target).
function ReplacementFields({ pool, rid, setRid, label, setLabel }:
  { pool: Pool; rid: string | null; setRid: (v: string | null) => void; label: string; setLabel: (v: string) => void }) {
  return (
    <>
      <Combobox clearable width={280} placeholder="Internal replacement" value={rid} onChange={setRid} options={poolData(pool)} />
      {!rid && <Input placeholder="or a free agent / trade target" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />}
    </>
  );
}

function EditPlan({ year, d, pool }: { year: number; d: FaDeparture; pool: Pool }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [rid, setRid] = useState<string | null>(d.plan?.replacement_id ? String(d.plan.replacement_id) : null);
  const [label, setLabel] = useState(d.plan?.replacement_label ?? "");
  const save = useMutation({
    mutationFn: (v: { rid: string | null; label: string }) => api.put("/api/fa", {
      year, departing_id: d.id ?? 0, departing_label: d.label, replacement_id: v.rid ? Number(v.rid) : null,
      replacement_label: v.rid ? "" : v.label, note: d.plan?.note ?? "" }),
    onSuccess: () => { setOpen(false); refresh(); },
  });
  const next = d.options[0];
  return (
    <PopForm open={open} setOpen={setOpen} title={`Replacing ${displayName(d.name)} in ${year}`}
      trigger={<IconButton label="Edit replacement" className="size-6"><IconPencil size={13} /></IconButton>}>
      <ReplacementFields pool={pool} rid={rid} setRid={setRid} label={label} setLabel={setLabel} />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="xs" variant="primary" disabled={save.isPending} onClick={() => save.mutate({ rid, label })}>Save</Button>
        {next && <Button size="xs" onClick={() => save.mutate({ rid: String(next.id), label: "" })}>Use next up ({displayName(next.name)})</Button>}
      </div>
    </PopForm>
  );
}

function Remove({ year, d }: { year: number; d: FaDeparture }) {
  const refresh = useRefresh();
  const del = useMutation({
    mutationFn: () => d.added
      ? api.del(`/api/fa?year=${year}&departing_id=${d.id ?? 0}&departing_label=${encodeURIComponent(d.label)}`)
      : api.put("/api/fa", { year, departing_id: d.id ?? 0, departing_label: "", replacement_id: d.plan?.replacement_id ?? null,
          replacement_label: d.plan?.replacement_label ?? "", note: d.plan?.note ?? "", hidden: true }),
    onSuccess: refresh,
  });
  return (
    <IconButton label={d.added ? "Delete" : "Hide from the timeline"} className="size-6 hover:text-bad" onClick={() => del.mutate()}>
      <IconTrash size={13} />
    </IconButton>
  );
}

function AddDeparture({ year, pool }: { year: number; pool: Pool }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [whoLabel, setWhoLabel] = useState("");
  const [rid, setRid] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const save = useMutation({
    mutationFn: () => api.put("/api/fa", { year, departing_id: who ? Number(who) : 0, departing_label: who ? "" : whoLabel,
      replacement_id: rid ? Number(rid) : null, replacement_label: rid ? "" : label, note: "" }),
    onSuccess: () => { setOpen(false); setWho(null); setWhoLabel(""); setRid(null); setLabel(""); refresh(); },
  });
  return (
    <PopForm open={open} setOpen={setOpen} title={`Also gone before ${year} (trade, release…)`}
      trigger={<Button size="xs" variant="ghost" className="-mr-1.5"><IconPlus size={13} /> Add</Button>}>
      <Combobox clearable width={280} placeholder="Your player" value={who} onChange={setWho} options={poolData(pool)} />
      {!who && <Input placeholder="or type a name" value={whoLabel} onChange={(e) => setWhoLabel(e.currentTarget.value)} />}
      <div className="pt-1 text-xs text-muted">Replacement (optional)</div>
      <ReplacementFields pool={pool} rid={rid} setRid={setRid} label={label} setLabel={setLabel} />
      <div className="pt-1">
        <Button size="xs" variant="primary" disabled={(!who && !whoLabel) || save.isPending} onClick={() => save.mutate()}>Add</Button>
      </div>
    </PopForm>
  );
}

function Entry({ year, d, pool, editable }: { year: number; d: FaDeparture; pool: Pool; editable: boolean }) {
  const rep = d.plan?.replacement_id ? { id: d.plan.replacement_id, name: d.plan.replacement_name ?? "" }
    : d.plan?.replacement_label ? { id: null, name: d.plan.replacement_label } : null;
  const pos = REPORT_POS[d.pos] ?? d.pos;
  const next = d.options[0];
  return (
    <div className="group relative py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-6 shrink-0 text-[11px] font-semibold text-faint">{d.pos}</span>
        <PlayerLink id={d.id} name={d.name} className="min-w-0 truncate text-[13px] font-medium" />
        <Num v={d.xwar} className="shrink-0 text-xs text-muted" />
        {d.added && <Tip label="You added this one"><Badge className="shrink-0">added</Badge></Tip>}
        {editable && (
          <span className="absolute top-1 right-0 flex rounded-md bg-surface opacity-0 shadow-sm ring-1 ring-line transition-opacity group-hover:opacity-100 focus-within:opacity-100 group-first:top-[-6px]">
            <EditPlan year={year} d={d} pool={pool} />
            <Remove year={year} d={d} />
          </span>
        )}
      </div>
      <div className="mt-0.5 min-w-0 pl-8 text-[13px]">
        {rep ? (
          <div className="flex min-w-0 items-center gap-1.5 text-muted">→ <PlayerLink id={rep.id} name={rep.name} className="truncate" /></div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-bad">No plan</span>
              {pos && (
                <span className="text-xs text-muted">
                  <Link to={`/reports/fa_board?filter=${pos}`} className="text-accent hover:underline">FAs</Link>
                  {" · "}
                  <Link to={`/reports/trade_targets?filter=${pos}`} className="text-accent hover:underline">trades</Link>
                </span>
              )}
            </div>
            {next && (
              <Tip label="Best org player under control that season at the same position group, not already starting or planned">
                <div className="flex min-w-0 items-center gap-1 text-xs text-muted">
                  <span className="shrink-0">next up:</span>
                  <PlayerLink id={next.id} name={next.name} className="truncate" />
                  <span className="num shrink-0">{num(next.xwar)}</span>
                </div>
              </Tip>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// One column per season: the ML regulars gone before it -> your replacement, or the projected next man up.
export function FaTimeline({ years, editable = true }: { years: FaYear[]; editable?: boolean }) {
  const refresh = useRefresh();
  const readOnly = useReadOnly();
  const canEdit = editable && !readOnly;
  const unhide = useMutation({ mutationFn: (year: number) => api.post(`/api/fa/${year}/unhide`, {}), onSuccess: refresh });
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {years.map((y) => (
        <div key={y.year} className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">{y.year} <span className="font-normal text-faint">gone before it</span></div>
            {canEdit && <AddDeparture year={y.year} pool={y.pool} />}
          </div>
          <div className="divide-y divide-line/60">
            {y.rows.length === 0 && <div className="text-[13px] text-muted">No regulars leaving.</div>}
            {y.rows.map((d) => <Entry key={`${d.id}${d.label}`} year={y.year} d={d} pool={y.pool} editable={canEdit} />)}
          </div>
          {y.hidden > 0 && (
            <div className="mt-2 text-xs text-faint">
              {y.hidden} hidden{canEdit && <> · <button type="button" className="text-accent hover:underline" onClick={() => unhide.mutate(y.year)}>restore</button></>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
