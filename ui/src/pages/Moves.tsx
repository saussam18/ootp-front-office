import { useMemo, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type Move } from "../api";
import { Badge, Failed, Input, Loading, PageTitle, PlayerLink, Section, Segmented, useReadOnly, type Tone } from "../components/ui";

// Trades and signings stand out; the day-to-day shuffles stay quiet.
const TONES: Record<string, Tone> = { trade: "accent", signing: "good", release: "bad", draft: "accent", injury: "warn" };

const VIEWS = [
  { value: "key", label: "Key moves" }, { value: "trade", label: "Trades" }, { value: "signing", label: "Signings" },
  { value: "release", label: "Releases & claims" }, { value: "draft", label: "Draft" }, { value: "roster", label: "Roster" },
  { value: "injury", label: "Injuries" }, { value: "all", label: "Everything" }];

function Note({ m }: { m: Move }) {
  const readOnly = useReadOnly();
  const [v, setV] = useState(m.note);
  const save = useMutation({ mutationFn: () => api.put(`/api/moves/${m.key}`, { body: v }) });
  if (readOnly) return <span className="text-xs text-muted">{m.note}</span>;
  return (
    <input placeholder="Add a note…" value={v} onChange={(e) => setV(e.currentTarget.value)} onBlur={() => v !== m.note && save.mutate()}
      className="h-7 w-full rounded-md border border-transparent bg-transparent px-2 text-xs text-fg outline-none placeholder:text-faint hover:border-line focus:border-accent focus:bg-surface" />
  );
}

export function Moves() {
  const q = useQuery({ queryKey: ["moves"], queryFn: () => api.get<{ moves: Move[] }>("/api/moves") });
  const readOnly = useReadOnly();
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
    <div className="space-y-4">
      <PageTitle sub={`Read from the league's transaction logs every refresh (trades from the player histories).${readOnly ? "" : " Add your own notes to any move."}`}>
        Moves
      </PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto"><Segmented value={view} onChange={setView} options={VIEWS} /></div>
        <Input className="w-56" icon={<IconSearch size={14} />} placeholder="Search…" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
      </div>
      <Section title={`${shown.length} moves`}>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <tbody>
              {shown.slice(0, 500).map((m) => (
                <tr key={m.key} className="hover:bg-sunken/60">
                  <td className="num w-24 whitespace-nowrap border-b border-line/70 py-1.5 pr-2 text-xs text-muted">{m.date}</td>
                  <td className="w-24 border-b border-line/70 py-1.5 pr-2"><Badge tone={TONES[m.kind] ?? "neutral"}>{m.kind}</Badge></td>
                  <td className="border-b border-line/70 py-1.5 pr-2 leading-snug">
                    {m.parts.map((p, i) => p.player_id ? <PlayerLink key={i} id={p.player_id} name={p.text} /> : <span key={i}>{p.text}</span>)}
                  </td>
                  <td className="w-64 border-b border-line/70 py-1"><Note m={m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > 500 && <p className="mt-2 text-xs text-muted">Showing the latest 500; narrow it with the filters.</p>}
      </Section>
    </div>
  );
}
