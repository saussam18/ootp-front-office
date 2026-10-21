import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Table } from "../api";
import { DataTable } from "../components/DataTable";
import { Badge, Failed, Loading, PageTitle, Section, TextLink } from "../components/ui";

interface Group_ { group: string; reports: { key: string; title: string; desc: string; rows: number }[] }

const pretty = (s: string) => s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace("halifax", "Halifax").replace("fa ", "FA ");

/** Market reports live on the Market page's tabs; the rest under Players → Reports. */
export const MARKET_TAB: Record<string, string> = {
  fa_board: "fa", trade_targets: "targets", platoons: "gems", gems_fa: "gems", gems_blocked: "gems", gems_buylow: "gems",
};

export function reportLink(key: string): string {
  return MARKET_TAB[key] ? `/market?tab=${MARKET_TAB[key]}` : `/players?tab=reports&report=${key}`;
}

export function Reports({ embedded, include, relabel = {} }: {
  embedded?: boolean; include?: (key: string) => boolean; relabel?: Record<string, string>;
} = {}) {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api.get<Group_[]>("/api/reports") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  const groups = q.data.map((g) => ({ ...g, reports: g.reports.filter((r) => !include || include(r.key)) })).filter((g) => g.reports.length);
  return (
    <div className="space-y-4">
      {!embedded && <PageTitle sub="The offseason report, one sortable table per page. Rebuilt automatically after each refresh.">Reports</PageTitle>}
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <Section key={g.group} title={relabel[g.group] ?? g.group}>
            <div className="-mx-2 space-y-0.5">
              {g.reports.map((r) => (
                <Link key={r.key} to={reportLink(r.key)} className="group block rounded-lg px-2 py-2 transition-colors hover:bg-sunken">
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

export function Report({ reportKey, embedded, back }: { reportKey?: string; embedded?: boolean; back?: { to: string; label: string } } = {}) {
  const { key: routeKey } = useParams();
  const key = reportKey ?? routeKey;
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["report", key], queryFn: () => api.get<{ title: string; desc: string; note: string | null; table: Table }>(`/api/reports/${key}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <div className="space-y-4">
      {back !== undefined || !embedded ? <TextLink to={back?.to ?? "/players?tab=reports"} className="text-[13px]">← {back?.label ?? "Reports"}</TextLink> : null}
      {embedded ? (
        <div>
          <h2 className="text-base font-semibold tracking-tight">{pretty(q.data.title)}</h2>
          <p className="mt-0.5 max-w-3xl text-[13px] leading-relaxed text-muted">{q.data.desc}</p>
        </div>
      ) : <PageTitle sub={q.data.desc}>{pretty(q.data.title)}</PageTitle>}
      {q.data.note && <p className="text-[13px] font-medium">{q.data.note}</p>}
      <Section title={`${q.data.table.rows.length} rows`}><DataTable table={q.data.table} maxHeight={900} initialFilter={params.get("filter") ?? ""} /></Section>
    </div>
  );
}
