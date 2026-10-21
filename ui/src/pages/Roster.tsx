import { Group, Select, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, qs, type Meta, type Table } from "../api";
import { DataTable } from "../components/DataTable";
import { Failed, Loading, PageTitle, Section } from "../components/ui";

export function Roster() {
  const [params, setParams] = useSearchParams();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta") });
  const org = params.get("org") ?? meta.data?.team ?? "";
  const q = useQuery({
    queryKey: ["roster", org], enabled: !!org,
    queryFn: () => api.get<{ orgs: string[]; table: Table }>(`/api/roster?${qs({ org })}`),
  });
  const title = org === "FA" ? "Free agents" : org === "all" ? "Every player" : `${org} organization`;
  return (
    <Stack gap="lg">
      <PageTitle>{title}</PageTitle>
      <Group>
        <Select w={260} searchable value={org} onChange={(v) => v && setParams({ org: v })}
          data={[{ value: meta.data?.team ?? "", label: meta.data?.team ?? "" }, { value: "FA", label: "Free agents" }, { value: "all", label: "Every player" },
            ...(q.data?.orgs ?? []).filter((o) => o !== meta.data?.team).map((o) => ({ value: o, label: o }))]} />
      </Group>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <Failed error={q.error} /> : (
        <Section title={`${q.data.table.rows.length} players`}><DataTable table={q.data.table} maxHeight={900} /></Section>
      )}
    </Stack>
  );
}
