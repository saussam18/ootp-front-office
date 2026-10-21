import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Failed, Loading, Section, TextLink, cn } from "../components/ui";

interface Dash { standings: { team: string; org: string | null; w: number; l: number; pct: number }[] }

/** League standings, also shown on the Market page. */
export function Standings() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dash>("/api/dashboard") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return <StandingsSection standings={q.data.standings} />;
}

function StandingsSection({ standings }: { standings: Dash["standings"] }) {
  return (
    <Section title="Standings" right="From the latest box scores">
      <div className="grid gap-x-8 md:grid-cols-2">
        {[standings.slice(0, 16), standings.slice(16)].map((half, h) => (
          <table key={h} className="w-full border-collapse text-[13px]">
            <tbody>
              {half.map((s, i) => {
                const mine = s.org === "Halifax";
                return (
                  <tr key={s.team} className={cn("hover:bg-sunken/60", mine && "bg-accent-soft font-semibold hover:bg-accent-soft")}>
                    <td className="num w-8 border-b border-line/70 py-1.5 pl-1 text-faint">{h * 16 + i + 1}</td>
                    <td className="border-b border-line/70 py-1.5">
                      {s.org ? <TextLink to={`/players?org=${encodeURIComponent(s.org)}`} className="text-fg hover:text-accent">{s.team}</TextLink> : s.team}
                    </td>
                    <td className="num border-b border-line/70 py-1.5 text-right">{s.w}–{s.l}</td>
                    <td className="num w-16 border-b border-line/70 py-1.5 pr-1 text-right text-muted">{s.pct.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </Section>
  );
}
