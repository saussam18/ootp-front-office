import { useEffect, useState } from "react";
import { Combobox, Group, Loader, Pill, PillsInput, Text, useCombobox } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { api, type Pick } from "../api";

interface Props {
  value: Pick[];
  onChange: (v: Pick[]) => void;
  scope?: "all" | "mine" | "others";
  placeholder?: string;
  single?: boolean;
  label?: string;
}

// Search players by name (and draft picks as "R3"); selected ones show as removable pills.
export function PlayerPicker({ value, onChange, scope = "all", placeholder = "Search players…", single, label }: Props) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 150);
  const [results, setResults] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!debounced.trim()) return setResults([]);
    let live = true;
    setLoading(true);
    api.get<Pick[]>(`/api/players?scope=${scope}&q=${encodeURIComponent(debounced)}`)
      .then((r) => live && setResults(r))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [debounced, scope]);

  const pick = (id: string) => {
    const p = results.find((r) => String(r.id) === id);
    if (!p) return;
    onChange(single ? [p] : value.some((v) => v.id === p.id) ? value : [...value, p]);
    setSearch("");
    combobox.closeDropdown();
  };

  return (
    <Combobox store={combobox} onOptionSubmit={pick}>
      <Combobox.DropdownTarget>
        <PillsInput label={label} onClick={() => combobox.openDropdown()} rightSection={loading ? <Loader size={14} /> : null}>
          <Pill.Group>
            {value.map((p) => (
              <Pill key={p.id} withRemoveButton onRemove={() => onChange(value.filter((v) => v.id !== p.id))}>{p.label}</Pill>
            ))}
            <Combobox.EventsTarget>
              <PillsInput.Field
                value={search}
                placeholder={value.length && single ? "" : placeholder}
                onChange={(e) => { setSearch(e.currentTarget.value); combobox.openDropdown(); combobox.updateSelectedOptionIndex(); }}
                onFocus={() => combobox.openDropdown()}
                onBlur={() => combobox.closeDropdown()}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !search && value.length) onChange(value.slice(0, -1));
                }}
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>
      <Combobox.Dropdown hidden={!results.length}>
        <Combobox.Options mah={320} style={{ overflowY: "auto" }}>
          {results.map((r) => (
            <Combobox.Option value={String(r.id)} key={r.id}>
              <Group justify="space-between" wrap="nowrap">
                <Text fz="sm">{r.label}</Text>
                {r.detail && <Text fz="xs" c="dimmed">{r.detail}</Text>}
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
