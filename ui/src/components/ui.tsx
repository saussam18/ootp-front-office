import type { ReactNode } from "react";
import { Alert, Anchor, Card, Center, Group, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

export function Section({ title, right, children, id }: { title: ReactNode; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Card withBorder radius="md" padding="lg" id={id}>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Title order={4}>{title}</Title>
        {right}
      </Group>
      {children}
    </Card>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text fz="xs" tt="uppercase" fw={700} c="dimmed">{label}</Text>
      <Text fz={28} fw={700} lh={1.3}>{value}</Text>
      {sub && <Text fz="xs" c="dimmed">{sub}</Text>}
    </Paper>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <Stack gap={2} mb="lg">
      <Title order={2}>{children}</Title>
      {sub && <Text c="dimmed" fz="sm" maw={900}>{sub}</Text>}
    </Stack>
  );
}

export function PlayerLink({ id, name }: { id?: number | null; name: string }) {
  return id && id > 0 ? <Anchor component={Link} to={`/player/${id}`} fz="sm">{name}</Anchor> : <Text span fz="sm">{name}</Text>;
}

export function Loading() {
  return <Center h={300}><Loader /></Center>;
}

export function Failed({ error }: { error: unknown }) {
  return <Alert color="red" title="Couldn't load">{String(error)}</Alert>;
}
