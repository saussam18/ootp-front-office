import { Anchor, Badge, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Table } from "../api";
import { DataTable } from "../components/DataTable";
import { Failed, Loading, PageTitle, Section } from "../components/ui";

interface Group_ { group: string; reports: { key: string; title: string; desc: string; rows: number }[] }

const pretty = (s: string) => s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace("halifax", "Halifax").replace("fa ", "FA ");

export function Reports() {
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api.get<Group_[]>("/api/reports") });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <Stack gap="lg">
      <PageTitle sub="The offseason report, one sortable table per page. Rebuilt automatically after each refresh.">Reports</PageTitle>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {q.data.map((g) => (
          <Section key={g.group} title={g.group}>
            <Stack gap="sm">
              {g.reports.map((r) => (
                <div key={r.key}>
                  <Group gap={6}><Anchor component={Link} to={`/reports/${r.key}`} fw={600}>{pretty(r.title)}</Anchor><Badge size="xs" variant="light" color="gray">{r.rows}</Badge></Group>
                  <Text fz="xs" c="dimmed" lineClamp={2}>{r.desc}</Text>
                </div>
              ))}
            </Stack>
          </Section>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function Report() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["report", key], queryFn: () => api.get<{ title: string; desc: string; note: string | null; table: Table }>(`/api/reports/${key}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Failed error={q.error} />;
  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/reports" fz="sm">← Reports</Anchor>
      <PageTitle sub={q.data.desc}>{pretty(q.data.title)}</PageTitle>
      {q.data.note && <Text fw={600}>{q.data.note}</Text>}
      <Section title={`${q.data.table.rows.length} rows`}><DataTable table={q.data.table} maxHeight={900} initialFilter={params.get("filter") ?? ""} /></Section>
    </Stack>
  );
}
