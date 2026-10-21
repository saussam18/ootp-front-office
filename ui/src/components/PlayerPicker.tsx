import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { IconLoader2, IconSearch, IconX } from "@tabler/icons-react";
import { api, type Pick } from "../api";
import { displayName } from "../format";

interface Props {
  value: Pick[];
  onChange: (v: Pick[]) => void;
  scope?: "all" | "mine" | "others";
  placeholder?: string;
  single?: boolean;
  label?: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Search players by name (and draft picks as "R3"); selected ones show as removable chips.
export function PlayerPicker({ value, onChange, scope = "all", placeholder = "Search players…", single, label }: Props) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 150);
  const [results, setResults] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!debounced.trim()) return setResults([]);
    let live = true;
    setLoading(true);
    api.get<Pick[]>(`/api/players?scope=${scope}&q=${encodeURIComponent(debounced)}`)
      .then((r) => live && setResults(r))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [debounced, scope]);

  const pick = (p: Pick) => {
    onChange(single ? [p] : value.some((v) => v.id === p.id) ? value : [...value, p]);
    setSearch("");
    setOpen(false);
  };

  return (
    <div>
      {label && <div className="mb-1 text-xs font-medium text-muted">{label}</div>}
      <Command shouldFilter={false} loop>
        <Popover.Root open={open && results.length > 0} onOpenChange={setOpen}>
          <Popover.Anchor asChild>
            <div ref={anchor} onClick={() => input.current?.focus()}
              className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 transition-colors hover:border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <IconSearch size={14} className="shrink-0 text-faint" />
              {value.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-0.5 rounded-md bg-sunken py-0.5 pl-1.5 pr-0.5 text-xs font-medium">
                  {displayName(p.label)}
                  <button type="button" aria-label={`Remove ${displayName(p.label)}`}
                    onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v.id !== p.id)); }}
                    className="flex size-4 items-center justify-center rounded text-faint hover:bg-line hover:text-fg">
                    <IconX size={11} />
                  </button>
                </span>
              ))}
              <Command.Input ref={input} value={search}
                placeholder={value.length && single ? "" : placeholder}
                onValueChange={(v) => { setSearch(v); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !search && value.length) onChange(value.slice(0, -1));
                }}
                className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] text-fg outline-none placeholder:text-faint" />
              {loading && <IconLoader2 size={14} className="shrink-0 animate-spin text-faint" />}
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={4} onOpenAutoFocus={(e) => e.preventDefault()}
              onInteractOutside={(e) => { if (anchor.current?.contains(e.target as Node)) e.preventDefault(); }}
              style={{ width: "max(var(--radix-popover-trigger-width), 18rem)" }}
              className="z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/10">
              <Command.List className="max-h-80 overflow-y-auto p-1">
                {results.map((r) => (
                  <Command.Item key={r.id} value={String(r.id)} onSelect={() => pick(r)}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] data-[selected=true]:bg-sunken">
                    <span className="truncate">{displayName(r.label)}</span>
                    {r.detail && <span className="shrink-0 text-xs text-muted">{r.detail}</span>}
                  </Command.Item>
                ))}
              </Command.List>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </Command>
    </div>
  );
}
