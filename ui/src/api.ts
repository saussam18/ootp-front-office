// Thin client for the Python API (web/app.py).

export type Fmt = "money" | "pct" | "int" | "num" | "bool" | "text";
export interface Column { key: string; label: string; tip: string; fmt: Fmt; link?: string }
export type Row = Record<string, unknown>;
export interface Table { columns: Column[]; rows: Row[] }

export interface Meta { team: string; season: number; next: number; core_year: number; snapshot: string }

export interface PlayerBrief {
  id: number; name: string; pos: string; age: number; lev: string | null; org: string | null;
  xwar_next: number | null; surplus: number | null; perceived: number | null; oy: number | null; on40: boolean | null; peak: number | null;
}
export interface BlockRow extends PlayerBrief { player_id: number; asking: string; note: string; pick: string }
export interface FringeRow extends PlayerBrief { player_id: number; status: "on" | "off"; note: string }
export interface Losing { id: number; name: string; pos: string; age: number; lev: string | null; salary: number; xwar: number | null; worth: number | null; price: number | null; why: string }

export type SlotStatus = "upgrade" | "strong" | "ok" | "empty" | "leaving";
export interface PlanRow {
  slot: string; counts: boolean; player_id: number | null; label: string; was: { id: number; name: string } | null;
  value: number | null; median: number | null; status: SlotStatus;
  rate: number | null; median_rate: number | null;  // lineup slots: full-season rates if every PA came vs that hand
  model: { id: number; name: string; value: number | null } | null;
  suggest?: { id: number; name: string; value: number | null };
  options: { id: number; value: number | null }[];
}
export interface Plan { key: string; title: string; group: "next" | "core" | "minors"; kind: "hit" | "pit"; year: number; rows: PlanRow[]; total: number; model_total: number; share: number }
export interface PlansResponse {
  players: Record<string, { name: string; pos: string; lev: string | null; b: string; t: string }>;
  plans: Record<string, Plan>; losing: Losing[]; marked: Record<string, string>; next: number; core_year: number; upgrade_gap: number;
}

export interface Pick { id: number; label: string; detail?: string }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(url: string) => request<T>("GET", url),
  put: <T,>(url: string, body: unknown) => request<T>("PUT", url, body),
  post: <T,>(url: string, body: unknown) => request<T>("POST", url, body),
  del: <T,>(url: string) => request<T>("DELETE", url),
};

export function qs(params: Record<string, number[] | string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else if (v) p.set(k, v);
  }
  return p.toString();
}

export interface FaPlanSaved { year: number; departing_id: number; departing_label: string; replacement_id: number | null;
  replacement_label: string; note: string; replacement_name?: string }
export interface FaDeparture { id: number | null; name: string; label: string; pos: string; age: number | null; lev: string | null;
  salary: number | null; xwar: number | null; worth: number | null; price: number | null; plan: FaPlanSaved | null; added: boolean;
  options: { id: number; name: string; xwar: number }[] }
export interface FaYear { year: number; rows: FaDeparture[]; hidden: number; pool: { id: number; name: string; pos: string; lev: string | null }[] }

export interface FortyPlayer { id: number; name: string; pos: string; age: number; lev: string | null; b: string; t: string;
  xwar: number | null; peak: number | null; ceiling: number | null; surplus: number | null; perceived: number | null;
  opt: number | null; oy: number | null; prospect_rank: number | null; plan: "on" | "off" | null; note: string;
  leaving?: boolean; drop_candidate?: boolean; eligible?: number; signed?: string; how?: string; eligible_now?: boolean;
  advice?: "protect" | "consider" | "expose" }
export interface Forty { count: number; leaving: number; planned_drops: number; planned_adds: number; projected: number;
  rule5_year: number; current: FortyPlayer[]; exposed: FortyPlayer[] }

export interface MovePart { text: string; player_id?: number }
export interface Move { key: string; date: string; kind: string; key_move: boolean; parts: MovePart[]; note: string }

export interface Board {
  players: PlansResponse["players"]; plans: Record<string, Plan>; fa: FaYear[]; losing: Losing[];
  forty: Pick_<Forty, "count" | "leaving" | "planned_drops" | "planned_adds" | "projected">; must_protect: FortyPlayer[];
  next: number; core_year: number; season: number;
}
type Pick_<T, K extends keyof T> = { [P in K]: T[P] };
