import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, qs, type Pick, type Table as T } from "../api";
import { DataTable } from "../components/DataTable";
import { PlayerPicker } from "../components/PlayerPicker";
import { Button, Empty, Failed, Loading, Num, PageTitle, PlayerLink, Section, Segmented, Table, Td, TextLink, Th, cn } from "../components/ui";
import { num, signed } from "../format";

type Mode = "eval" | "shop" | "offer" | "comps";
interface Deal { date: string; sides: { team: string; items: { id?: number; label: string }[] }[] }

const ids = (v: string[]) => v.map(Number).filter((n) => Number.isFinite(n) && n !== 0);

// Labels for ids in the URL, so a shared link shows names in the pickers.
function useLabels(list: number[]) {
  return useQuery({
    queryKey: ["labels", list], enabled: list.length > 0,
    queryFn: async () => Promise.all(list.map(async (id): Promise<Pick> =>
      id < 0 ? { id, label: `R${-id} pick` } : { id, label: (await api.get<{ player: { name: string } }>(`/api/player/${id}`)).player.name })),
  });
}

function Eval({ give, get }: { give: number[]; get: number[] }) {
  const q = useQuery({ queryKey: ["eval", give, get], queryFn: () => api.get<any>(`/api/trade/eval?${qs({ give, get })}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const r = q.data;
  const row = (label: string, value: ReactNode, sub?: string) => (
    <div key={label} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-4 gap-y-0.5 border-b border-line/70 py-2 last:border-0 sm:grid-cols-[14rem_12rem_minmax(0,1fr)]">
      <div className="text-muted">{label}</div>
      <div className="num font-semibold">{value}</div>
      {sub && <div className="col-start-2 text-xs text-muted sm:col-start-3 sm:text-[13px]">{sub}</div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <Section title="The deal"><DataTable table={r.cards} filter={false} /></Section>
      <Section title="Verdict">
        <div className="text-[13px]">
          {row("Value to us", <span className={r.surplus_gain >= 0 ? "text-good" : "text-bad"}>{signed(r.surplus_gain)}M</span>, "our ratings-based surplus gained")}
          {row("How they'll see it", <span className={r.their_gain >= 0 ? "text-good" : "text-warn"}>{r.their_gain >= 0 ? "they gain" : "they lose"} {num(Math.abs(r.their_gain))}M</span>,
            r.their_gain >= 0 ? "they should like it" : "expect them to ask for more")}
          {row("Your next-season depth chart", `${num(r.depth[0])} → ${num(r.depth[1])}`, `${signed(r.depth[1] - r.depth[0])} xWAR`)}
          {r.partners.map((p: any) => row(`${p.org} depth chart`, `${num(p.before)} → ${num(p.after)}`, `${signed(p.after - p.before)} xWAR`))}
          {row("Your payroll", Object.entries(r.payroll).map(([s, v]) => `${s} ${signed(v as number)}M`).join(" · "))}
        </div>
        {r.rentals.length > 0 && <p className="mt-2 text-[13px] text-warn">{r.rentals.join(", ")} reach free agency after this season.</p>}
      </Section>
    </div>
  );
}

function Shop({ give }: { give: number[] }) {
  const q = useQuery({ queryKey: ["shop", give], queryFn: () => api.get<any>(`/api/trade/shop?${qs({ give })}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const r = q.data;
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed">Selling <b className="font-semibold">{r.names}</b>: worth <b className="num font-semibold">{num(r.surplus)}M</b> to us;
        other GMs likely see <b className="num font-semibold">{num(r.perceived)}M</b>, about {r.pick}. Ask for players they value at up to ~{num(r.cap)}M.</p>
      {r.lists.map((l: { title: string; table: T }) => <Section key={l.title} title={l.title}><DataTable table={l.table} /></Section>)}
    </div>
  );
}

function Offer({ get, protect }: { get: number[]; protect: number[] }) {
  const q = useQuery({ queryKey: ["offer", get, protect], queryFn: () => api.get<any>(`/api/trade/offer?${qs({ get, protect })}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const r = q.data;
  return (
    <Section title={`Packages for ${r.names}`}>
      <p className="mb-3 text-[13px] text-muted">Worth <b className="num font-semibold text-fg">{num(r.surplus)}M</b> to us; the other side thinks they give up{" "}
        <b className="num font-semibold text-fg">{num(r.perceived)}M</b>. These packages should look fair to them, best for you first.
        Pool: {r.pool} of your players; protected: {r.protected}.</p>
      {r.packages.length ? (
        <Table minWidth={700}>
          <thead><tr><Th>Package</Th><Th right>They see</Th><Th right>You give up</Th><Th right>Your gain</Th><Th right>Your depth Δ</Th><Th right>Their depth Δ</Th><Th /></tr></thead>
          <tbody>
            {r.packages.map((p: any, i: number) => (
              <tr key={i} className="hover:bg-sunken/60">
                <Td>{p.players.map((x: Pick, j: number) => <span key={x.id}>{j > 0 && <span className="text-faint">, </span>}<PlayerLink id={x.id} name={x.label} /></span>)}</Td>
                <Td right><Num v={p.perceived} /></Td><Td right><Num v={p.surplus_given} /></Td><Td right><Num v={p.your_gain} /></Td>
                <Td right><Num v={p.your_depth} signed /></Td><Td right><Num v={p.their_depth} signed /></Td>
                <Td className="text-right"><TextLink to={`/market?tab=trade&${qs({ mode: "eval", give: p.players.map((x: Pick) => x.id), get })}`}>Evaluate</TextLink></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <Empty>No package of up to three of your players reaches their price. Protect fewer players, or add picks in Evaluate.</Empty>}
    </Section>
  );
}

function DealList({ deals, empty }: { deals: Deal[]; empty: string }) {
  if (!deals.length) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <div className="divide-y divide-line/70">
      {deals.map((d, i) => (
        <div key={i} className="flex gap-3 py-1.5 text-[13px]">
          <span className="num w-20 shrink-0 pt-px text-xs text-faint">{d.date}</span>
          <span className="min-w-0">
            {d.sides.map((s, j) => <span key={j}>{j > 0 && <span className="text-faint"> · </span>}<b className="font-semibold">{s.team}</b> gave {s.items.map((it, k) => (
              <span key={k}>{k > 0 && ", "}{it.id ? <PlayerLink id={it.id} name={it.label} /> : it.label}</span>))}</span>)}
            {d.sides.length === 1 && <span className="text-muted"> · nothing listed in return</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Comps({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["comps", id], queryFn: () => api.get<{ title: string; deals: Deal[] }>(`/api/trade/comps/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <Section title="Comparable trades">
      <p className="mb-2 text-[13px] text-muted">{q.data.title}</p>
      <DealList deals={q.data.deals} empty="No similar trades in the last three seasons." />
    </Section>
  );
}

export function TradeLab({ embedded }: { embedded?: boolean } = {}) {
  const [params, setRawParams] = useSearchParams();
  const setParams = (s: string) => {  // keep the page's own params (Market's ?tab=) when the lab rewrites the URL
    const p = new URLSearchParams(s);
    const tab = params.get("tab");
    if (tab) p.set("tab", tab);
    setRawParams(p);
  };
  const mode = (params.get("mode") ?? "eval") as Mode;
  const urlGive = ids(params.getAll("give")), urlGet = ids(params.getAll("get")), urlProtect = ids(params.getAll("protect"));
  const [give, setGive] = useState<Pick[]>([]);
  const [get, setGet] = useState<Pick[]>([]);
  const [protect, setProtect] = useState<Pick[]>([]);
  const lg = useLabels(urlGive), lt = useLabels(urlGet), lp = useLabels(urlProtect);
  useEffect(() => { if (lg.data) setGive(lg.data); }, [lg.data]);
  useEffect(() => { if (lt.data) setGet(lt.data); }, [lt.data]);
  useEffect(() => { if (lp.data) setProtect(lp.data); }, [lp.data]);
  const picks = useQuery({ queryKey: ["picks"], queryFn: () => api.get<T>("/api/picks") });

  const run = () => setParams(qs({ mode, give: give.map((p) => p.id), get: get.map((p) => p.id), protect: protect.map((p) => p.id) }));
  const setMode = (m: string | null) => m && setParams(qs({ mode: m }));
  const ready = { eval: urlGive.length > 0 && urlGet.length > 0, shop: urlGive.length > 0, offer: urlGet.length > 0, comps: urlGive.length > 0 }[mode];

  return (
    <div className="space-y-4">
      {embedded ? (
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted">Value to us comes from ratings; how other GMs see it blends ratings with this season's results, pays up for cheap control
          and for bats over gloves, and discounts prospects for risk. Type R3 for a draft pick.</p>
      ) : (
        <PageTitle sub="Value to us comes from ratings; how other GMs see it blends ratings with this season's results, pays up for cheap control and for bats over gloves, and discounts prospects for risk. Type R3 for a draft pick.">
          Trade lab
        </PageTitle>
      )}
      <div className="overflow-x-auto">
        <Segmented<Mode> value={mode} onChange={setMode} options={[
          { value: "eval", label: "Evaluate a deal" }, { value: "shop", label: "Shop a player" },
          { value: "offer", label: "What would it take?" }, { value: "comps", label: "Comparable trades" },
        ]} />
      </div>
      <Section title={{ eval: "Proposed deal", shop: "Players you're selling", offer: "Player you want", comps: "Player" }[mode]}>
        <div className={cn("grid gap-3", (mode === "eval" || mode === "offer") && "md:grid-cols-2")}>
          {(mode === "eval" || mode === "shop") && <PlayerPicker label="You give" value={give} onChange={setGive} scope="mine" placeholder="Your player, or R3…" />}
          {mode === "comps" && <PlayerPicker label="Any player" value={give} onChange={setGive} single />}
          {(mode === "eval" || mode === "offer") && <PlayerPicker label={mode === "eval" ? "You get" : "Target"} value={get} onChange={setGet} scope="others" placeholder="Their player, or R3…" />}
          {mode === "offer" && <PlayerPicker label="Don't offer" value={protect} onChange={setProtect} scope="mine" placeholder="Protect a player…" />}
        </div>
        <div className="mt-4"><Button variant="primary" onClick={run}>Run</Button></div>
      </Section>
      {ready && mode === "eval" && <Eval give={urlGive} get={urlGet} />}
      {ready && mode === "shop" && <Shop give={urlGive} />}
      {ready && mode === "offer" && <Offer get={urlGet} protect={urlProtect} />}
      {ready && mode === "comps" && <Comps id={urlGive[0]} />}
      {picks.data && <Section title="Draft pick values" right="Average draftee of that round, $M"><DataTable table={picks.data} filter={false} /></Section>}
    </div>
  );
}
