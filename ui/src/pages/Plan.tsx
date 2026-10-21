// The season plan: your roster decisions → the model's lineup and staff, with your pins where you disagree.
import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { IconArrowBackUp, IconCheck, IconChevronDown, IconChevronRight, IconPinFilled, IconPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PlayerPicker } from "../components/PlayerPicker";
import { Alert, Badge, Button, Dot, Empty, Failed, IconButton, Input, Loading, Num, PageTitle, PlayerLink, Section, SectionLabel, Segmented,
  Select, Tip, cn, useReadOnly, type Tone } from "../components/ui";
import { displayName, isNum, money, num } from "../format";
import { Forty } from "./Forty";

// ------------------------------------------------------------------ API shapes (web/planner.py)

interface Who { id: number | null; name: string | null; b?: string; t?: string; lev?: string | null; age?: number; planned?: boolean }
interface FixInternal { id: number; name: string; value: number; gain: number; lev: string | null }
interface FixFa { id: number; name: string; age: number; value: number; gain: number; ask: number | null; price: number | null; source: string; org: string | null }
interface FixTrade { id: number; name: string; age: number; org: string; value: number; gain: number; yrs: number | null; avg_cost: number | null; surplus: number | null }
interface Fixes { internal: FixInternal[]; fa: FixFa[]; trade: FixTrade[] }
type Status = "open" | "upgrade" | "strong" | "ok";
interface SlotRow extends Who {
  slot: string; kind: "hit" | "sp" | "rp"; pinned: boolean; value: number | null; median: number | null; gap: number | null; status: Status;
  rate_r?: number | null; rate_l?: number | null; swap?: (Who & { pinned: boolean; rate_l: number | null }) | null; fixes?: Fixes | null;
}
interface Cand extends Who { pos: string; at: Record<string, number>; vl: Record<string, number> }
interface Decision { kind: string; id: number | null; name: string | null; pos?: string; lev?: string | null; season?: number; text: string; choices: { key: string; label: string }[] }
interface Move { kind: "leave" | "sign"; id: number; name: string; pos: string; xwar: number | null; why?: string; yours?: boolean; aav?: number | null; years?: number; note?: string }
interface GridCell { id: number | null; name: string | null; value: number | null; status: Status; planned: boolean; pinned: boolean }
interface GridSeason { season: number; payroll: number; totals: Totals; slots: Record<string, GridCell> }
interface Totals { lineup: number; rotation: number; bullpen: number }
interface Watch { slot: string; id: number; name: string; pos: string; lev: string | null }
interface PlanData {
  season: number; seasons: number[]; next: number; current: number; core_year: number; lhp: number;
  lineup: SlotRow[]; rotation: SlotRow[]; bullpen: SlotRow[]; bench: (Who & { value: number; pos: string })[]; arms: (Who & { value: number; pos: string })[];
  totals: Totals; model_totals: Totals; payroll: number; missing_pins: { slot: string; hand: string; id: number; name: string; why?: string }[];
  candidates: Record<string, Cand>; moves: Move[]; grid: GridSeason[]; decisions?: Decision[];
  forty?: { count: number; leaving: number; planned_drops: number; planned_adds: number; signings: number; projected: number };
  watch: { minors_hit: Watch[]; minors_pit: Watch[] }; upgrade_gap: number;
}

const TONE: Record<Status, Tone | null> = { open: "bad", upgrade: "warn", strong: "good", ok: null };
const STATUS_TIP: Record<Status, string> = {
  open: "Nobody on the roster for this slot", upgrade: "At least 0.3 season xWAR below the median MLB team's player here",
  strong: "At least 0.5 season xWAR above the median MLB team's player here", ok: "Within range of the league median",
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

function usePlanWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => { ["plan", "forty", "contracts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
}

// ------------------------------------------------------------------ a searchable picker with any trigger

interface Option { value: string; label: string; hint?: ReactNode; muted?: boolean }

function Picker({ trigger, options, onPick, title, width = 320 }: {
  trigger: ReactNode; options: Option[]; onPick: (v: string) => void; title?: string; width?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} style={{ width }} className="z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/10">
          <Command loop>
            {title && <div className="border-b border-line px-3 pt-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{title}</div>}
            <Command.Input autoFocus placeholder="Search…" className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-faint" />
            <Command.List className="max-h-80 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-4 text-center text-xs text-muted">No matches</Command.Empty>
              {options.map((o) => (
                <Command.Item key={o.value} value={`${o.label} ${o.value}`} onSelect={() => { onPick(o.value); setOpen(false); }}
                  className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] data-[selected=true]:bg-sunken", o.muted && "text-muted")}>
                  <span className="truncate">{o.label}</span>
                  {o.hint !== undefined && <span className="num shrink-0 text-xs text-muted">{o.hint}</span>}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const candLabel = (c: Cand) => `${displayName(c.name ?? "")} · ${c.pos}${c.lev && c.lev !== "RLB" ? ` · ${c.lev}` : ""}${c.planned ? " · planned" : ""}`;
const posOf = (r: SlotRow) => (r.kind === "sp" ? "SP" : r.kind === "rp" ? "RP" : r.slot);

// ------------------------------------------------------------------ one slot

function Name({ who, className }: { who: Who; className?: string }) {
  if (!who.id) return <span className="text-bad">Open</span>;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <PlayerLink id={who.id} name={who.name ?? ""} className="truncate" />
      {who.lev && who.lev !== "RLB" && <span className="rounded bg-sunken px-1 text-[10px] font-medium text-muted">{who.lev}</span>}
      {who.planned && <Badge tone="accent">planned</Badge>}
    </span>
  );
}

function SlotLine({ r, d, open, onToggle }: { r: SlotRow; d: PlanData; open: boolean; onToggle: () => void }) {
  const readOnly = useReadOnly();
  const write = usePlanWrite();
  const pin = (hand: "R" | "L", player_id: number | null) => write.mutate(() => api.put("/api/pins", { season: d.season, slot: r.slot, hand, player_id }));
  const pos = posOf(r);
  const cands = Object.values(d.candidates).filter((c) => c.at[pos] !== undefined)
    .sort((a, b) => b.at[pos] - a.at[pos]);
  const options: Option[] = [
    ...(r.pinned ? [{ value: "model", label: "Use the model's pick", muted: true }] : []),
    ...cands.map((c) => ({ value: String(c.id), label: candLabel(c), hint: num(c.at[pos]) })),
  ];
  const tone = TONE[r.status];
  const hit = r.kind === "hit";
  const valueTip = hit && isNum(r.rate_r)
    ? `${num(r.rate_r)} vs RHP × ${pct(1 - d.lhp)} + ${num(r.swap?.rate_l ?? r.rate_l)} vs LHP${r.swap ? ` (${displayName(r.swap.name ?? "")})` : ""} × ${pct(d.lhp)}`
    : r.kind === "rp" ? "xWAR weighted by the leverage of the role" : null;

  const player = readOnly ? <Name who={r} /> : (
    <Picker title={`${r.slot} · ${d.season}`} options={options} onPick={(v) => pin("R", v === "model" ? null : Number(v))}
      trigger={
        <button type="button" className="group/p -mx-1.5 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-sunken">
          <Name who={r} />
          <IconChevronDown size={13} className="shrink-0 text-faint opacity-0 group-hover/p:opacity-100" />
        </button>
      } />
  );

  let swap: ReactNode = null;
  if (hit) {
    const vl = Object.values(d.candidates).filter((c) => c.vl[r.slot] !== undefined && c.id !== r.id).sort((a, b) => b.vl[r.slot] - a.vl[r.slot]);
    const swapOptions: Option[] = [
      ...(r.swap ? [{ value: "none", label: `No swap: ${displayName(r.name ?? "")} plays vs LHP too`, muted: true }] : []),
      ...(r.swap?.pinned ? [{ value: "model", label: "Let the model decide", muted: true }] : []),
      ...vl.map((c) => ({ value: String(c.id), label: candLabel(c), hint: `${num(c.vl[r.slot])} vL` })),
    ];
    const shown = r.swap
      ? <span className="flex min-w-0 items-center gap-1 text-muted"><span className="text-[11px] text-faint">vs L</span><Name who={r.swap} />
          {r.swap.pinned && <IconPinFilled size={11} className="shrink-0 text-faint" />}</span>
      : <span className="text-[12px] text-faint">{readOnly ? "" : "+ vs-L swap"}</span>;
    swap = readOnly ? shown : (
      <Picker title={`${r.slot} vs LHP`} options={swapOptions} width={340}
        onPick={(v) => pin("L", v === "model" ? null : v === "none" ? r.id : Number(v))}
        trigger={<button type="button" className="-mx-1.5 flex min-w-0 items-center rounded-md px-1.5 py-1 text-left opacity-80 hover:bg-sunken hover:opacity-100">{shown}</button>} />
    );
  }

  return (
    <div className="border-b border-line/70 last:border-0">
      <div className={cn("grid items-center gap-x-3 py-1", hit ? "grid-cols-[2.25rem_minmax(0,1.2fr)_minmax(0,1fr)_3rem_3.5rem_4.5rem]" : "grid-cols-[2.25rem_minmax(0,1fr)_3rem_3.5rem_4.5rem]")}>
        <span className="text-[11px] font-semibold text-faint">{r.slot}</span>
        <span className="flex min-w-0 items-center gap-1">
          {player}
          {r.pinned && (
            <Tip label={readOnly ? "Pinned" : "Pinned by you. Click to go back to the model's pick"}>
              <button type="button" disabled={readOnly} onClick={() => pin("R", null)} className="shrink-0 text-faint hover:text-bad disabled:hover:text-faint">
                <IconPinFilled size={12} />
              </button>
            </Tip>
          )}
        </span>
        {hit && <span className="min-w-0 text-[13px]">{swap}</span>}
        <Tip label={valueTip}><span className="text-right text-[13px]"><Num v={r.value} /></span></Tip>
        <Tip label={isNum(r.median) ? `League median ${num(r.median)}` : null}>
          <span className="text-right text-xs"><Num v={r.gap} signed className={r.gap === null ? "" : r.gap < 0 ? "text-warn" : "text-good"} /></span>
        </Tip>
        <span className="flex items-center justify-end gap-1.5">
          {tone && <Tip label={STATUS_TIP[r.status]}><span className="flex size-4 items-center justify-center"><Dot tone={tone} /></span></Tip>}
          {r.fixes && (
            <button type="button" onClick={onToggle}
              className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors",
                open ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent-soft")}>
              Fix {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            </button>
          )}
        </span>
      </div>
      {open && r.fixes && <FixPanel r={r} d={d} />}
    </div>
  );
}

// ------------------------------------------------------------------ fixes for a weak or open slot

function SignButton({ f, season, slot }: { f: FixFa; season: number; slot: string }) {
  const write = usePlanWrite();
  const [open, setOpen] = useState(false);
  const [years, setYears] = useState("1");
  const [aav, setAav] = useState(String(f.ask ?? f.price ?? ""));
  const [note, setNote] = useState("");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><Button size="xs" variant="secondary">Plan to sign</Button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-72 space-y-2.5 rounded-xl border border-line bg-surface p-3 shadow-xl shadow-black/10">
          <div className="text-[13px] font-semibold">Plan to sign {displayName(f.name)}</div>
          <p className="text-xs text-muted">
            {f.ask !== null ? <>He's asking {money(f.ask)} a year.</> : <>No ask yet ({f.source}); typical price for him is {money(f.price)}. Asks move during free agency, so update this when he files.</>}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted">Years
              <Select value={years} onChange={(e) => setYears(e.currentTarget.value)}>{[1, 2, 3, 4, 5].map((y) => <option key={y}>{y}</option>)}</Select>
            </label>
            <label className="space-y-1 text-xs text-muted">$M a year<Input type="number" step="0.1" value={aav} onChange={(e) => setAav(e.currentTarget.value)} /></label>
          </div>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <p className="text-[11px] text-faint">He'll take this slot in the plan (pinned) from {season} for {years} season{years === "1" ? "" : "s"}.</p>
          <Button variant="primary" className="w-full" onClick={() => {
            // Planned from a slot's fixes, so he takes that slot too.
            write.mutate(async () => {
              await api.post("/api/signings", { player_id: f.id, first_season: season, years: Number(years), aav: aav === "" ? null : Number(aav), note });
              await api.put("/api/pins", { season, slot, hand: "R", player_id: f.id });
            });
            setOpen(false);
          }}>Add to the plan</Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FixPanel({ r, d }: { r: SlotRow; d: PlanData }) {
  const readOnly = useReadOnly();
  const write = usePlanWrite();
  const f = r.fixes!;
  const col = (title: string, sub: string, body: ReactNode) => (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2"><SectionLabel>{title}</SectionLabel><span className="text-[11px] text-faint">{sub}</span></div>
      {body}
    </div>
  );
  const line = (key: number, who: ReactNode, gain: number, detail: ReactNode, action: ReactNode) => (
    <div key={key} className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">{who}<Num v={gain} signed className="text-xs text-good" /></div>
        <div className="truncate text-[11px] text-muted">{detail}</div>
      </div>
      {!readOnly && action}
    </div>
  );
  const none = <div className="py-1 text-xs text-faint">Nothing better</div>;
  return (
    <div className="mb-2 grid gap-4 rounded-lg bg-sunken/60 px-3 py-2.5 md:grid-cols-3">
      {col("On your roster", "free", f.internal.length ? f.internal.map((x) => line(x.id, <PlayerLink id={x.id} name={x.name} className="truncate" />, x.gain,
        `${num(x.value)} season xWAR here${x.lev && x.lev !== "RLB" ? ` · ${x.lev}` : ""}`,
        <Button size="xs" variant="ghost" onClick={() => write.mutate(() => api.put("/api/pins", { season: d.season, slot: r.slot, hand: "R", player_id: x.id }))}>Use</Button>)) : none)}
      {col("Free agents", d.season === d.next ? "ask, else typical price" : `for ${d.next} only`, f.fa.length ? f.fa.map((x) => line(x.id, <PlayerLink id={x.id} name={x.name} className="truncate" />, x.gain,
        <>{x.ask !== null ? `asks ${money(x.ask)}` : `~${money(x.price)} est.`} · age {x.age} · {x.source}</>,
        <SignButton f={x} season={d.season} slot={r.slot} />)) : none)}
      {col("Trade targets", "suggestions", f.trade.length ? f.trade.map((x) => line(x.id, <PlayerLink id={x.id} name={x.name} className="truncate" />, x.gain,
        <>{x.org} · {x.yrs ?? "?"} yrs at {money(x.avg_cost)} · {money(x.surplus)} surplus</>,
        <Link to={`/market?tab=trade&mode=offer&get=${x.id}`} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">What would it take?</Link>)) : none)}
    </div>
  );
}

// ------------------------------------------------------------------ cards

function SlotCard({ title, sub, rows, d, total, model, reset }: {
  title: string; sub?: ReactNode; rows: SlotRow[]; d: PlanData; total: number; model: number; reset: "lineup" | "staff" | null;
}) {
  const readOnly = useReadOnly();
  const write = usePlanWrite();
  const [open, setOpen] = useState<string | null>(null);
  const pins = rows.filter((r) => r.pinned || r.swap?.pinned).length;
  const hit = rows[0]?.kind === "hit";
  return (
    <Section title={<>{title}{sub && <span className="ml-1.5 font-normal text-faint">{sub}</span>}</>}
      right={<span className="flex items-center gap-3">
        <span>You <b className="num text-fg">{num(total)}</b> · model's best <b className="num text-fg">{num(model)}</b></span>
        {reset && pins > 0 && !readOnly && (
          <Tip label={`Unpin all ${pins} and take the model's picks`}>
            <button type="button" className="text-accent hover:underline" onClick={() => write.mutate(() => api.del(`/api/pins?season=${d.season}&group=${reset}`))}>Reset</button>
          </Tip>
        )}
      </span>}>
      <div className={cn("grid gap-x-3 border-b border-line pb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint",
        hit ? "grid-cols-[2.25rem_minmax(0,1.2fr)_minmax(0,1fr)_3rem_3.5rem_4.5rem]" : "grid-cols-[2.25rem_minmax(0,1fr)_3rem_3.5rem_4.5rem]")}>
        <span /><span>Player</span>{hit && <span>vs LHP</span>}<span className="text-right">Season</span><span className="text-right">vs med</span><span />
      </div>
      {rows.map((r) => <SlotLine key={r.slot} r={r} d={d} open={open === r.slot} onToggle={() => setOpen(open === r.slot ? null : r.slot)} />)}
    </Section>
  );
}

function Decide({ d }: { d: PlanData }) {
  const readOnly = useReadOnly();
  const write = usePlanWrite();
  if (!d.decisions?.length) return null;
  return (
    <Section title={<>Decide <span className="font-normal text-faint">{d.decisions.length} before {d.next}</span></>}>
      <div className="divide-y divide-line/70">
        {d.decisions.map((x, i) => (
          <div key={`${x.kind}-${x.id ?? i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px]">
                <Dot tone={x.kind === "forty" ? "bad" : "warn"} />
                {x.id ? <PlayerLink id={x.id} name={x.name ?? ""} className="font-medium" /> : <span className="font-medium">40-man</span>}
                {x.pos && <span className="text-xs text-faint">{x.pos}{x.lev && x.lev !== "RLB" ? ` · ${x.lev}` : ""}</span>}
              </div>
              <div className="pl-3.5 text-xs text-muted">{x.text}</div>
            </div>
            {!readOnly && x.id && (
              <div className="flex gap-1.5">
                {x.choices.map((c, j) => (
                  <Button key={c.key} size="xs" variant={j === 0 ? "secondary" : "ghost"}
                    onClick={() => write.mutate(() => api.put("/api/decisions", { player_id: x.id, kind: x.kind, choice: c.key, season: x.season ?? null }))}>
                    {c.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Moves({ d }: { d: PlanData }) {
  const readOnly = useReadOnly();
  const write = usePlanWrite();
  const leave = d.moves.filter((m) => m.kind === "leave");
  const sign = d.moves.filter((m) => m.kind === "sign");
  const roster = Object.values(d.candidates).filter((c) => !c.planned).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const undo = (id: number) => write.mutate(() => api.put(`/api/contracts/${id}`, { last_season: null, note: "" }));
  return (
    <Section title={`Moves before ${d.season}`}>
      <SectionLabel className="mb-1">Leaving</SectionLabel>
      {leave.length ? leave.map((m) => (
        <div key={m.id} className="group flex items-center gap-2 py-1 text-[13px]">
          <IconX size={12} className="shrink-0 text-bad" />
          <PlayerLink id={m.id} name={m.name} className="truncate" />
          <span className="text-xs text-faint">{m.pos}</span>
          <Num v={m.xwar} className="text-xs text-muted" />
          <span className="ml-auto truncate text-[11px] text-muted">{m.why}</span>
          {m.yours && !readOnly && <IconButton label="Undo: back to the model's contract end" className="size-6" onClick={() => undo(m.id)}><IconArrowBackUp size={13} /></IconButton>}
        </div>
      )) : <div className="py-1 text-xs text-faint">Nobody</div>}
      {!readOnly && (
        <Picker title={`Gone before ${d.season}`} width={300}
          options={roster.map((c) => ({ value: String(c.id), label: candLabel(c) }))}
          onPick={(v) => write.mutate(() => api.put(`/api/contracts/${v}`, { last_season: d.season - 1, note: "let go" }))}
          trigger={<button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><IconPlus size={12} />Let someone go (option, release, trade)</button>} />
      )}
      <SectionLabel className="mt-4 mb-1">Planned signings</SectionLabel>
      {sign.length ? sign.map((m) => (
        <div key={m.id} className="flex items-center gap-2 py-1 text-[13px]">
          <IconPlus size={12} className="shrink-0 text-good" />
          <PlayerLink id={m.id} name={m.name} className="truncate" />
          <span className="text-xs text-faint">{m.pos}</span>
          <Num v={m.xwar} className="text-xs text-muted" />
          <span className="ml-auto text-[11px] text-muted">{m.years}y · {money(m.aav)}</span>
          {!readOnly && <IconButton label="Drop from the plan" className="size-6" onClick={() => write.mutate(() => api.del(`/api/signings/${m.id}`))}><IconX size={13} /></IconButton>}
        </div>
      )) : <div className="py-1 text-xs text-faint">None yet. Open a weak slot's Fix to plan one.</div>}
    </Section>
  );
}

function Depth({ d }: { d: PlanData }) {
  const list = (items: PlanData["bench"]) => items.map((p) => (
    <div key={p.id} className="flex items-center gap-2 py-0.5 text-[13px]">
      <Name who={p} />
      <span className="text-xs text-faint">{p.pos}</span>
      <Num v={p.value} className="ml-auto text-xs text-muted" />
    </div>
  ));
  return (
    <Section title="Depth" right="best season xWAR at any spot">
      <SectionLabel className="mb-1">Bats</SectionLabel>
      {d.bench.length ? list(d.bench) : <div className="text-xs text-faint">None</div>}
      <SectionLabel className="mt-3 mb-1">Arms</SectionLabel>
      {d.arms.length ? list(d.arms) : <div className="text-xs text-faint">None</div>}
    </Section>
  );
}

function WatchList({ d }: { d: PlanData }) {
  const readOnly = useReadOnly();
  const write = usePlanWrite();
  const lists: [keyof PlanData["watch"], string, number][] = [["minors_hit", "Bats", 8], ["minors_pit", "Arms", 6]];
  return (
    <Section title="Minors watch list">
      {lists.map(([key, label, size]) => {
        const items = d.watch[key];
        const free = Array.from({ length: size }, (_, i) => `M${i + 1}`).find((s) => !items.some((w) => w.slot === s));
        return (
          <div key={key} className="mb-3 last:mb-0">
            <SectionLabel className="mb-1">{label}</SectionLabel>
            {items.map((w) => (
              <div key={w.slot} className="group flex items-center gap-2 py-0.5 text-[13px]">
                <PlayerLink id={w.id} name={w.name} className="truncate" />
                <span className="text-xs text-faint">{w.pos}{w.lev ? ` · ${w.lev}` : ""}</span>
                {!readOnly && <IconButton label="Remove" className="ml-auto size-6 opacity-0 group-hover:opacity-100"
                  onClick={() => write.mutate(() => api.put(`/api/plans/${key}/${w.slot}`, { player_id: null, label: "" }))}><IconX size={12} /></IconButton>}
              </div>
            ))}
            {!items.length && <div className="text-xs text-faint">Nobody</div>}
            {!readOnly && free && (
              <div className="mt-1"><PlayerPicker value={[]} single scope="mine" placeholder="Add a minor leaguer…"
                onChange={(p) => p[0] && write.mutate(() => api.put(`/api/plans/${key}/${free}`, { player_id: p[0].id, label: "" }))} /></div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

const GRID_ROWS: [string, string][] = [["C", "C"], ["1B", "1B"], ["2B", "2B"], ["3B", "3B"], ["SS", "SS"], ["LF", "LF"], ["CF", "CF"], ["RF", "RF"], ["DH", "DH"],
  ["SP1", "SP1"], ["SP2", "SP2"], ["SP3", "SP3"], ["SP4", "SP4"], ["SP5", "SP5"], ["CL", "CL"], ["SU1", "SU1"]];

function ByYear({ d, onSeason }: { d: PlanData; onSeason: (s: number) => void }) {
  return (
    <Section title="By year" right="the plan for each season, from who's under control then; click a season to open it">
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="w-12" />
              {d.grid.map((g) => (
                <th key={g.season} className="px-2 pb-2 text-left font-normal">
                  <button type="button" onClick={() => onSeason(g.season)}
                    className={cn("rounded-md px-1.5 py-0.5 text-[13px] font-semibold", g.season === d.season ? "bg-accent-soft text-accent" : "hover:bg-sunken")}>
                    {g.season}{g.season === d.core_year && <span className="ml-1 font-normal text-faint">core</span>}
                  </button>
                  <div className="px-1.5 text-[11px] text-muted">lineup <span className="num text-fg">{num(g.totals.lineup)}</span> · <span className="num">{money(g.payroll, 0)}</span></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRID_ROWS.map(([slot, label]) => (
              <tr key={slot} className={cn(slot === "SP1" || slot === "CL" ? "border-t border-line" : "")}>
                <td className="py-1 pr-2 text-[11px] font-semibold text-faint">{label}</td>
                {d.grid.map((g) => {
                  const c = g.slots[slot];
                  const tone = c ? TONE[c.status] : "bad";
                  return (
                    <td key={g.season} className={cn("px-2 py-1", g.season === d.season && "bg-accent-soft/40")}>
                      {c?.id ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          {tone && <Dot tone={tone} />}
                          <PlayerLink id={c.id} name={c.name ?? ""} className="truncate" />
                          {c.pinned && <IconPinFilled size={10} className="shrink-0 text-faint" />}
                          {c.planned && <span className="text-[10px] font-medium text-accent">new</span>}
                          <Num v={c.value} className="ml-auto pl-1 text-xs text-muted" />
                        </span>
                      ) : <span className="flex items-center gap-1.5 text-bad"><Dot tone="bad" />open</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ the page

export function Plan() {
  const [params, setParams] = useSearchParams();
  const season = params.get("season") ? Number(params.get("season")) : null;
  const q = useQuery({ queryKey: ["plan", season], queryFn: () => api.get<PlanData>(`/api/plan${season ? `?season=${season}` : ""}`), placeholderData: (prev) => prev });
  const setSeason = (s: number) => setParams(s === q.data?.next ? {} : { season: String(s) });
  const [showForty, setShowForty] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const d = q.data;
  const isNext = d.season === d.next;
  const f = d.forty;

  return (
    <div className={cn("space-y-4 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
      <PageTitle
        sub={<>The model builds each season's lineup and staff from who's on the roster then; pin a slot <IconPinFilled size={11} className="inline text-faint" /> where
          you disagree. Values are season xWAR (lineup slots: {pct(1 - d.lhp)} of PAs vs RHP, {pct(d.lhp)} vs LHP).</>}
        right={<Segmented<string> value={String(d.season)} onChange={(v) => setSeason(Number(v))}
          options={d.seasons.map((s) => ({ value: String(s), label: s === d.core_year ? `${s} core` : String(s) }))} />}>
        {d.season} plan
      </PageTitle>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Lineup" value={d.totals.lineup} model={d.model_totals.lineup} />
        <Summary label="Rotation + bullpen" value={d.totals.rotation + d.totals.bullpen} model={d.model_totals.rotation + d.model_totals.bullpen} />
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Payroll</div>
          <div className="num mt-0.5 text-2xl font-semibold tracking-tight">{money(d.payroll, 0)}</div>
          <div className="text-xs text-muted">40-man and starters at projected cost, plus planned signings</div>
        </div>
        {f ? (
          <button type="button" onClick={() => setShowForty((s) => !s)} className="rounded-xl border border-line bg-surface px-4 py-3 text-left hover:border-line-strong">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted">40-man after the offseason</div>
            <div className={cn("num mt-0.5 text-2xl font-semibold tracking-tight", f.projected > 40 && "text-bad")}>{f.projected}<span className="text-base font-normal text-faint">/40</span></div>
            <div className="text-xs text-muted">
              {[`${f.count} now`, f.leaving && `−${f.leaving} leaving`, f.planned_drops && `−${f.planned_drops} dropped`, f.planned_adds && `+${f.planned_adds} protected`,
                f.signings && `+${f.signings} signed`].filter(Boolean).join(" · ")} <span className="text-accent">{showForty ? "hide" : "list"}</span>
            </div>
          </button>
        ) : (
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Leaving before {d.season}</div>
            <div className="num mt-0.5 text-2xl font-semibold tracking-tight">{d.moves.filter((m) => m.kind === "leave").length}</div>
            <div className="text-xs text-muted">regulars whose control ends</div>
          </div>
        )}
      </div>

      {showForty && isNext && <Section title="40-man roster and Rule 5"><Forty embedded /></Section>}
      {isNext && <Decide d={d} />}
      {d.missing_pins.length > 0 && (
        <Alert tone="warn" title="Some pins don't apply this season">
          {d.missing_pins.map((m, i) => <span key={i}>{i > 0 && "; "}{m.slot}{m.hand === "L" ? " vs LHP" : ""}: {displayName(m.name)} {m.why ?? "isn't on the roster"}</span>)}.
          Unpin them or change the moves.
        </Alert>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <SlotCard title="Lineup" sub="one lineup; vs-LHP swaps where a bench bat is clearly better" rows={d.lineup} d={d}
            total={d.totals.lineup} model={d.model_totals.lineup} reset="lineup" />
          <SlotCard title="Rotation" rows={d.rotation} d={d} total={d.totals.rotation} model={d.model_totals.rotation} reset="staff" />
          <SlotCard title="Bullpen" sub="weighted by leverage" rows={d.bullpen} d={d} total={d.totals.bullpen} model={d.model_totals.bullpen} reset={null} />
        </div>
        <div className="space-y-4">
          <Moves d={d} />
          <Depth d={d} />
          <WatchList d={d} />
        </div>
      </div>

      <ByYear d={d} onSeason={setSeason} />
      {!isNext && !d.grid.length && <Empty>No seasons to show.</Empty>}
    </div>
  );
}

function Summary({ label, value, model }: { label: string; value: number; model: number }) {
  const diff = value - model;
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-0.5 text-2xl font-semibold tracking-tight">{num(value)}</div>
      <div className="text-xs text-muted">
        model's best {num(model)}
        {Math.abs(diff) >= 0.05 && <span className={cn("ml-1", diff < 0 ? "text-warn" : "text-good")}>({diff > 0 ? "+" : ""}{num(diff)})</span>}
        {Math.abs(diff) < 0.05 && <IconCheck size={12} className="ml-1 inline text-good" />}
      </div>
    </div>
  );
}
