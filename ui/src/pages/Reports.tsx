import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Table } from "../api";
import { DataTable } from "../components/DataTable";
import { Badge, Failed, Loading, PageTitle, Section, TextLink } from "../components/ui";

interface Group_ { group: string; reports: { key: string; title: string; desc: string; rows: number }[] }

const pretty = (s: string) => s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace("halifax", "Halifax").replace("fa ", "FA ");

export function Reports() {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api.get<Group_[]>("/api/reports") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <div className="space-y-4">
      <PageTitle sub="The offseason report, one sortable table per page. Rebuilt automatically after each refresh.">Reports</PageTitle>
      <div className="grid gap-4 md:grid-cols-3">
        {q.data.map((g) => (
          <Section key={g.group} title={g.group}>
            <div className="-mx-2 space-y-0.5">
              {g.reports.map((r) => (
                <Link key={r.key} to={`/reports/${r.key}`} className="group block rounded-lg px-2 py-2 transition-colors hover:bg-sunken">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium group-hover:text-accent">{pretty(r.title)}</span>
                    <Badge className="num">{r.rows}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{r.desc}</p>
                </Link>
              ))}
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}

export function Report() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["report", key], queryFn: () => api.get<{ title: string; desc: string; note: string | null; table: Table }>(`/api/reports/${key}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <div className="space-y-4">
      <TextLink to="/reports" className="text-[13px]">← Reports</TextLink>
      <PageTitle sub={q.data.desc}>{pretty(q.data.title)}</PageTitle>
      {q.data.note && <p className="text-[13px] font-medium">{q.data.note}</p>}
      <Section title={`${q.data.table.rows.length} rows`}><DataTable table={q.data.table} maxHeight={900} initialFilter={params.get("filter") ?? ""} /></Section>
    </div>
  );
}
