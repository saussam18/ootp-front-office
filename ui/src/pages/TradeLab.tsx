import { useEffect, useState } from "react";
import { Anchor, Button, Group, SimpleGrid, Stack, Table, Tabs, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, qs, type Pick, type Table as T } from "../api";
import { DataTable } from "../components/DataTable";
import { PlayerPicker } from "../components/PlayerPicker";
import { Failed, Loading, PageTitle, PlayerLink, Section } from "../components/ui";
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
  const row = (label: string, value: React.ReactNode, sub?: string) => (
    <Table.Tr><Table.Td c="dimmed" w={240}>{label}</Table.Td><Table.Td fw={700}>{value}</Table.Td><Table.Td c="dimmed" fz="sm">{sub}</Table.Td></Table.Tr>
  );
  return (
    <Stack>
      <Section title="The deal"><DataTable table={r.cards} filter={false} /></Section>
      <Section title="Verdict">
        <Table fz="sm"><Table.Tbody>
          {row("Value to us", <Text span c={r.surplus_gain >= 0 ? "teal" : "red"} fw={700}>{signed(r.surplus_gain)}M</Text>, "our ratings-based surplus gained")}
          {row("How they'll see it", <Text span c={r.their_gain >= 0 ? "teal" : "orange"} fw={700}>{r.their_gain >= 0 ? "they gain" : "they lose"} {num(Math.abs(r.their_gain))}M</Text>,
            r.their_gain >= 0 ? "they should like it" : "expect them to ask for more")}
          {row("Your next-season depth chart", `${num(r.depth[0])} → ${num(r.depth[1])}`, `${signed(r.depth[1] - r.depth[0])} xWAR`)}
          {r.partners.map((p: any) => row(`${p.org} depth chart`, `${num(p.before)} → ${num(p.after)}`, `${signed(p.after - p.before)} xWAR`))}
          {row("Your payroll", Object.entries(r.payroll).map(([s, v]) => `${s} ${signed(v as number)}M`).join(" · "))}
        </Table.Tbody></Table>
        {r.rentals.length > 0 && <Text c="orange" fz="sm" mt="xs">{r.rentals.join(", ")} reach free agency after this season.</Text>}
      </Section>
    </Stack>
  );
}

function Shop({ give }: { give: number[] }) {
  const q = useQuery({ queryKey: ["shop", give], queryFn: () => api.get<any>(`/api/trade/shop?${qs({ give })}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const r = q.data;
  return (
    <Stack>
      <Text>Selling <b>{r.names}</b>: worth <b>{num(r.surplus)}M</b> to us; other GMs likely see <b>{num(r.perceived)}M</b>, about {r.pick}.
        Ask for players they value at up to ~{num(r.cap)}M.</Text>
      {r.lists.map((l: { title: string; table: T }) => <Section key={l.title} title={l.title}><DataTable table={l.table} /></Section>)}
    </Stack>
  );
}

function Offer({ get, protect }: { get: number[]; protect: number[] }) {
  const q = useQuery({ queryKey: ["offer", get, protect], queryFn: () => api.get<any>(`/api/trade/offer?${qs({ get, protect })}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const r = q.data;
  return (
    <Section title={`Packages for ${r.names}`}>
      <Text fz="sm" mb="sm">Worth <b>{num(r.surplus)}M</b> to us; the other side thinks they give up <b>{num(r.perceived)}M</b>. These packages should look fair to them,
        best for you first. Pool: {r.pool} of your players; protected: {r.protected}.</Text>
      {r.packages.length ? (
        <Table.ScrollContainer minWidth={700}>
          <Table fz="sm" highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>Package</Table.Th><Table.Th ta="right">They see</Table.Th><Table.Th ta="right">You give up</Table.Th>
              <Table.Th ta="right">Your gain</Table.Th><Table.Th ta="right">Your depth Δ</Table.Th><Table.Th ta="right">Their depth Δ</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {r.packages.map((p: any, i: number) => (
                <Table.Tr key={i}>
                  <Table.Td>{p.players.map((x: Pick, j: number) => <span key={x.id}>{j > 0 && ", "}<PlayerLink id={x.id} name={x.label} /></span>)}</Table.Td>
                  <Table.Td ta="right">{num(p.perceived)}</Table.Td><Table.Td ta="right">{num(p.surplus_given)}</Table.Td><Table.Td ta="right">{num(p.your_gain)}</Table.Td>
                  <Table.Td ta="right">{signed(p.your_depth)}</Table.Td><Table.Td ta="right">{signed(p.their_depth)}</Table.Td>
                  <Table.Td><Anchor component={Link} fz="sm" to={`/trade?${qs({ mode: "eval", give: p.players.map((x: Pick) => x.id), get })}`}>evaluate</Anchor></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : <Text c="dimmed">No package of up to three of your players reaches their price. Protect fewer players, or add picks in Evaluate.</Text>}
    </Section>
  );
}

function Comps({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["comps", id], queryFn: () => api.get<{ title: string; deals: Deal[] }>(`/api/trade/comps/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <Section title="Comparable trades">
      <Text fz="sm" c="dimmed" mb="sm">{q.data.title}</Text>
      <Stack gap={6}>
        {q.data.deals.map((d, i) => (
          <Text key={i} fz="sm"><Text span c="dimmed" fz="xs">{d.date}</Text>{"  "}
            {d.sides.map((s, j) => <span key={j}>{j > 0 && " · "}<b>{s.team}</b> gave {s.items.map((it, k) => (
              <span key={k}>{k > 0 && ", "}{it.id ? <PlayerLink id={it.id} name={it.label} /> : it.label}</span>))}</span>)}
            {d.sides.length === 1 && " · nothing listed in return"}
          </Text>
        ))}
        {!q.data.deals.length && <Text c="dimmed">No similar trades in the last three seasons.</Text>}
      </Stack>
    </Section>
  );
}

export function TradeLab() {
  const [params, setParams] = useSearchParams();
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
    <Stack gap="lg">
      <PageTitle sub="Value to us comes from ratings; how other GMs see it blends ratings with this season's results, pays up for cheap control and for bats over gloves, and discounts prospects for risk. Type R3 for a draft pick.">
        Trade lab
      </PageTitle>
      <Tabs value={mode} onChange={setMode}>
        <Tabs.List>
          <Tabs.Tab value="eval">Evaluate a deal</Tabs.Tab>
          <Tabs.Tab value="shop">Shop a player</Tabs.Tab>
          <Tabs.Tab value="offer">What would it take?</Tabs.Tab>
          <Tabs.Tab value="comps">Comparable trades</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Section title={{ eval: "Proposed deal", shop: "Players you're selling", offer: "Player you want", comps: "Player" }[mode]}>
        <SimpleGrid cols={{ base: 1, md: mode === "eval" || mode === "offer" ? 2 : 1 }}>
          {(mode === "eval" || mode === "shop") && <PlayerPicker label="You give" value={give} onChange={setGive} scope="mine" placeholder="Your player, or R3…" />}
          {mode === "comps" && <PlayerPicker label="Any player" value={give} onChange={setGive} single />}
          {(mode === "eval" || mode === "offer") && <PlayerPicker label={mode === "eval" ? "You get" : "Target"} value={get} onChange={setGet} scope="others" placeholder="Their player, or R3…" />}
          {mode === "offer" && <PlayerPicker label="Don't offer" value={protect} onChange={setProtect} scope="mine" placeholder="Protect a player…" />}
        </SimpleGrid>
        <Group mt="md"><Button onClick={run}>Run</Button></Group>
      </Section>
      {ready && mode === "eval" && <Eval give={urlGive} get={urlGet} />}
      {ready && mode === "shop" && <Shop give={urlGive} />}
      {ready && mode === "offer" && <Offer get={urlGet} protect={urlProtect} />}
      {ready && mode === "comps" && <Comps id={urlGive[0]} />}
      {picks.data && <Section title="Draft pick values" right={<Text fz="xs" c="dimmed">average draftee of that round, $M</Text>}><DataTable table={picks.data} filter={false} /></Section>}
    </Stack>
  );
}
