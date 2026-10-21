import { useMemo, useState } from "react";
import { Anchor, Group, Table as MTable, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconSearch } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import type { Row, Table } from "../api";
import { cell } from "../format";

interface Props {
  table: Table;
  filter?: boolean;
  initialFilter?: string;
  limit?: number;
  maxHeight?: number;
}

// A sortable, filterable table for the API's {columns, rows} format; name columns link to player pages.
export function DataTable({ table, filter = true, initialFilter = "", limit, maxHeight }: Props) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [q, setQ] = useState(initialFilter);

  const rows = useMemo(() => {
    let r: Row[] = table.rows;
    if (q) {
      const needle = q.toLowerCase();
      r = r.filter((row) => table.columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(needle)));
    }
    if (sort) {
      const { key, desc } = sort;
      r = [...r].sort((a, b) => {
        const x = a[key], y = b[key];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return desc ? -c : c;
      });
    }
    return limit ? r.slice(0, limit) : r;
  }, [table, q, sort, limit]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  return (
    <div>
      {filter && (table.rows.length > 12 || q) && (
        <TextInput size="xs" mb="xs" w={280} leftSection={<IconSearch size={14} />} placeholder={`Filter ${table.rows.length} rows…`}
          value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      )}
      <MTable.ScrollContainer minWidth={300} mah={maxHeight}>
        <MTable striped highlightOnHover stickyHeader verticalSpacing={6} fz="sm">
          <MTable.Thead>
            <MTable.Tr>
              {table.columns.map((c) => (
                <MTable.Th key={c.key} style={{ whiteSpace: "nowrap" }}>
                  <UnstyledButton onClick={() => toggle(c.key)}>
                    <Group gap={4} wrap="nowrap">
                      {c.tip ? (
                        <Tooltip label={c.tip} multiline w={260} withArrow>
                          <Text fz="xs" fw={600} c="dimmed" td="underline dotted">{c.label}</Text>
                        </Tooltip>
                      ) : (
                        <Text fz="xs" fw={600} c="dimmed">{c.label}</Text>
                      )}
                      {sort?.key === c.key && (sort.desc ? <IconArrowDown size={12} /> : <IconArrowUp size={12} />)}
                    </Group>
                  </UnstyledButton>
                </MTable.Th>
              ))}
            </MTable.Tr>
          </MTable.Thead>
          <MTable.Tbody>
            {rows.map((row, i) => (
              <MTable.Tr key={i}>
                {table.columns.map((c) => {
                  const text = cell(row[c.key], c.fmt);
                  const id = c.link ? row[c.link] : undefined;
                  const numeric = c.fmt !== "text" && c.fmt !== "bool";
                  return (
                    <MTable.Td key={c.key} style={{ whiteSpace: "nowrap", fontVariantNumeric: numeric ? "tabular-nums" : undefined }}>
                      {typeof id === "number" && id > 0 ? <Anchor component={Link} to={`/player/${id}`} fz="sm">{text}</Anchor> : text}
                    </MTable.Td>
                  );
                })}
              </MTable.Tr>
            ))}
          </MTable.Tbody>
        </MTable>
      </MTable.ScrollContainer>
    </div>
  );
}
