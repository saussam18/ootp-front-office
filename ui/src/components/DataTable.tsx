import { useMemo, useState } from "react";
import { IconArrowDown, IconArrowUp, IconSearch } from "@tabler/icons-react";
import type { Row, Table } from "../api";
import { cell } from "../format";
import { Input, PlayerLink, Tip, cn } from "./ui";

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
  const numeric = (fmt: string) => fmt !== "text" && fmt !== "bool";

  return (
    <div>
      {filter && (table.rows.length > 12 || q) && (
        <Input className="mb-3 w-72" icon={<IconSearch size={14} />} placeholder={`Filter ${table.rows.length} rows…`}
          value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      )}
      <div className="-mx-4 overflow-auto px-4" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full min-w-[300px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {table.columns.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap border-b border-line px-2 py-2 text-[11px] font-medium uppercase tracking-wider text-faint first:pl-0 last:pr-0",
                  numeric(c.fmt) ? "text-right" : "text-left")}>
                  <button type="button" onClick={() => toggle(c.key)}
                    className={cn("inline-flex items-center gap-1 uppercase hover:text-fg", sort?.key === c.key && "text-fg")}>
                    {c.tip ? (
                      <Tip label={c.tip}><span className="underline decoration-dotted underline-offset-2">{c.label}</span></Tip>
                    ) : c.label}
                    {sort?.key === c.key && (sort.desc ? <IconArrowDown size={11} /> : <IconArrowUp size={11} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-sunken/60">
                {table.columns.map((c) => {
                  const text = cell(row[c.key], c.fmt);
                  const id = c.link ? row[c.link] : undefined;
                  return (
                    <td key={c.key} className={cn("whitespace-nowrap border-b border-line/70 px-2 py-1.5 first:pl-0 last:pr-0",
                      numeric(c.fmt) && "num text-right")}>
                      {typeof id === "number" && id > 0 ? <PlayerLink id={id} name={text} /> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-6 text-center text-sm text-muted">No rows{q ? " match the filter" : ""}.</div>}
      </div>
    </div>
  );
}
