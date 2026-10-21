import { useState } from "react";
import { ActionIcon, Anchor, Badge, Button, Group, Paper, Popover, Select, SimpleGrid, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type FaDeparture, type FaYear } from "../api";
import { num } from "../format";
import { PlayerLink } from "./ui";

const REPORT_POS: Record<string, string> = { CL: "RP" };
type Pool = FaYear["pool"];

function useRefresh() {
  const qc = useQueryClient();
  return () => ["fa", "board"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

const poolData = (pool: Pool) => pool.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.pos}${p.lev && p.lev !== "RLB" ? ` · ${p.lev}` : ""}` }));

// Pick an internal replacement (or type a free agent / trade target).
function ReplacementFields({ pool, rid, setRid, label, setLabel }:
  { pool: Pool; rid: string | null; setRid: (v: string | null) => void; label: string; setLabel: (v: string) => void }) {
  return (
    <>
      <Select size="xs" searchable clearable placeholder="Internal replacement" value={rid} onChange={setRid} data={poolData(pool)} />
      {!rid && <TextInput size="xs" placeholder="or a free agent / trade target" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />}
    </>
  );
}

function EditPlan({ year, d, pool }: { year: number; d: FaDeparture; pool: Pool }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [rid, setRid] = useState<string | null>(d.plan?.replacement_id ? String(d.plan.replacement_id) : null);
  const [label, setLabel] = useState(d.plan?.replacement_label ?? "");
  const save = useMutation({
    mutationFn: (v: { rid: string | null; label: string }) => api.put("/api/fa", {
      year, departing_id: d.id ?? 0, departing_label: d.label, replacement_id: v.rid ? Number(v.rid) : null,
      replacement_label: v.rid ? "" : v.label, note: d.plan?.note ?? "" }),
    onSuccess: () => { setOpen(false); refresh(); },
  });
  const next = d.options[0];
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withArrow trapFocus shadow="md">
      <Popover.Target>
        <ActionIcon size="xs" variant="subtle" onClick={() => setOpen((o) => !o)} aria-label="Edit replacement"><IconPencil size={12} /></ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={280}>
          <Text fz="sm" fw={600}>Replacing {d.name} in {year}</Text>
          <ReplacementFields pool={pool} rid={rid} setRid={setRid} label={label} setLabel={setLabel} />
          <Group gap="xs">
            <Button size="xs" onClick={() => save.mutate({ rid, label })} loading={save.isPending}>Save</Button>
            {next && <Button size="xs" variant="light" onClick={() => save.mutate({ rid: String(next.id), label: "" })}>Use next up ({next.name})</Button>}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function Remove({ year, d }: { year: number; d: FaDeparture }) {
  const refresh = useRefresh();
  const del = useMutation({
    mutationFn: () => d.added
      ? api.del(`/api/fa?year=${year}&departing_id=${d.id ?? 0}&departing_label=${encodeURIComponent(d.label)}`)
      : api.put("/api/fa", { year, departing_id: d.id ?? 0, departing_label: "", replacement_id: d.plan?.replacement_id ?? null,
          replacement_label: d.plan?.replacement_label ?? "", note: d.plan?.note ?? "", hidden: true }),
    onSuccess: refresh,
  });
  return (
    <Tooltip label={d.added ? "Delete" : "Hide from the timeline"} withArrow>
      <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => del.mutate()} aria-label="Remove"><IconTrash size={12} /></ActionIcon>
    </Tooltip>
  );
}

function AddDeparture({ year, pool }: { year: number; pool: Pool }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [whoLabel, setWhoLabel] = useState("");
  const [rid, setRid] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const save = useMutation({
    mutationFn: () => api.put("/api/fa", { year, departing_id: who ? Number(who) : 0, departing_label: who ? "" : whoLabel,
      replacement_id: rid ? Number(rid) : null, replacement_label: rid ? "" : label, note: "" }),
    onSuccess: () => { setOpen(false); setWho(null); setWhoLabel(""); setRid(null); setLabel(""); refresh(); },
  });
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withArrow trapFocus shadow="md">
      <Popover.Target>
        <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => setOpen((o) => !o)}>Add</Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={280}>
          <Text fz="sm" fw={600}>Also gone before {year} (trade, release…)</Text>
          <Select size="xs" searchable clearable placeholder="Your player" value={who} onChange={setWho} data={poolData(pool)} />
          {!who && <TextInput size="xs" placeholder="or type a name" value={whoLabel} onChange={(e) => setWhoLabel(e.currentTarget.value)} />}
          <Text fz="xs" c="dimmed">Replacement (optional)</Text>
          <ReplacementFields pool={pool} rid={rid} setRid={setRid} label={label} setLabel={setLabel} />
          <Button size="xs" disabled={!who && !whoLabel} onClick={() => save.mutate()} loading={save.isPending}>Add</Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

// One column per season: the ML regulars gone before it -> your replacement, or the projected next man up.
export function FaTimeline({ years, editable = true }: { years: FaYear[]; editable?: boolean }) {
  const refresh = useRefresh();
  const unhide = useMutation({ mutationFn: (year: number) => api.post(`/api/fa/${year}/unhide`, {}), onSuccess: refresh });
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
      {years.map((y) => (
        <Paper key={y.year} withBorder p="sm" radius="md">
          <Group justify="space-between" mb={6} wrap="nowrap">
            <Text fw={700}>{y.year} <Text span c="dimmed" fz="xs" fw={500}>gone before it</Text></Text>
            {editable && <AddDeparture year={y.year} pool={y.pool} />}
          </Group>
          <Stack gap={10}>
            {y.rows.length === 0 && <Text fz="sm" c="dimmed">No regulars leaving.</Text>}
            {y.rows.map((d) => {
              const rep = d.plan?.replacement_id ? { id: d.plan.replacement_id, name: d.plan.replacement_name ?? "" }
                : d.plan?.replacement_label ? { id: null, name: d.plan.replacement_label } : null;
              const pos = REPORT_POS[d.pos] ?? d.pos;
              const next = d.options[0];
              return (
                <div key={`${d.id}${d.label}`}>
                  <Group gap={6} wrap="nowrap">
                    <Text fz="xs" fw={700} c="dimmed" w={26}>{d.pos}</Text>
                    <PlayerLink id={d.id} name={d.name} />
                    <Text fz="xs" c="dimmed">{num(d.xwar)}</Text>
                    {d.added && <Tooltip label="You added this one" withArrow><Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0, overflow: "visible" }}>added</Badge></Tooltip>}
                    {editable && <EditPlan year={y.year} d={d} pool={y.pool} />}
                    {editable && <Remove year={y.year} d={d} />}
                  </Group>
                  <Stack gap={0} pl={32}>
                    {rep ? (
                      <Group gap={6} wrap="nowrap"><Text fz="sm" c="dimmed">→</Text><PlayerLink id={rep.id} name={rep.name} /></Group>
                    ) : (
                      <>
                        <Group gap={6} wrap="nowrap">
                          <Text fz="sm" c="red" fw={600}>No plan</Text>
                          {pos && <Anchor component={Link} to={`/reports/fa_board?filter=${pos}`} fz="xs">FAs</Anchor>}
                          {pos && <Anchor component={Link} to={`/reports/trade_targets?filter=${pos}`} fz="xs">trades</Anchor>}
                        </Group>
                        {next && (
                          <Tooltip label="Best org player under control that season at the same position group, not already starting in your plans" withArrow multiline w={260}>
                            <Group gap={4} wrap="nowrap">
                              <Text fz="xs" c="dimmed">next up:</Text><PlayerLink id={next.id} name={next.name} /><Text fz="xs" c="dimmed">{num(next.xwar)}</Text>
                            </Group>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </Stack>
                </div>
              );
            })}
            {y.hidden > 0 && (
              <Text fz="xs" c="dimmed">{y.hidden} hidden · <Anchor fz="xs" onClick={() => unhide.mutate(y.year)}>restore</Anchor></Text>
            )}
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
