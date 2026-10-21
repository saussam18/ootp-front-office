import { ActionIcon, AppShell, Burger, Group, NavLink, ScrollArea, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowsExchange, IconBallBaseball, IconCalendarDollar, IconChartBar, IconClipboardList, IconHistory, IconLayoutDashboard,
  IconListNumbers, IconMoon, IconNotes, IconSun, IconUsers } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, type Meta } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PlayerPicker } from "./components/PlayerPicker";
import { Board } from "./pages/Board";
import { Dashboard } from "./pages/Dashboard";
import { Forty } from "./pages/Forty";
import { Moves } from "./pages/Moves";
import { FreeAgency } from "./pages/FreeAgency";
import { Player } from "./pages/Player";
import { Plans } from "./pages/Plans";
import { Report, Reports } from "./pages/Reports";
import { Roster } from "./pages/Roster";
import { Strategy } from "./pages/Strategy";
import { TradeLab } from "./pages/TradeLab";

const NAV = [
  { to: "/", label: "Team plan", icon: IconClipboardList },
  { to: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  { to: "/plans", label: "Lineups & staff", icon: IconBallBaseball },
  { to: "/fa", label: "Free agency", icon: IconCalendarDollar },
  { to: "/forty", label: "40-man", icon: IconListNumbers },
  { to: "/moves", label: "Moves", icon: IconHistory },
  { to: "/strategy", label: "Strategy", icon: IconNotes },
  { to: "/roster", label: "Roster", icon: IconUsers },
  { to: "/trade", label: "Trade lab", icon: IconArrowsExchange },
  { to: "/reports", label: "Reports", icon: IconChartBar },
];

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta") });

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 230, breakpoint: "sm", collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={800} fz="lg">{meta.data?.team ?? "Halifax"} <Text span c="dimmed" fw={500}>front office</Text></Text>
          </Group>
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, justifyContent: "flex-end" }}>
            <div style={{ width: 320, maxWidth: "50vw" }}>
              <PlayerPicker value={[]} single placeholder="Find any player…" onChange={(p) => p[0] && navigate(`/player/${p[0].id}`)} />
            </div>
            <ActionIcon variant="default" size="lg" aria-label="Toggle color scheme"
              onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}>
              {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={2}>
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} component={Link} to={to} label={label} leftSection={<Icon size={18} />} onClick={close}
                active={to === "/" ? pathname === "/" : pathname.startsWith(to)} />
            ))}
          </Stack>
        </AppShell.Section>
        {meta.data && (
          <AppShell.Section>
            <Text fz="xs" c="dimmed">Data {meta.data.snapshot}<br />Season {meta.data.season} · planning {meta.data.next}</Text>
          </AppShell.Section>
        )}
      </AppShell.Navbar>
      <AppShell.Main>
        <ErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/forty" element={<Forty />} />
          <Route path="/moves" element={<Moves />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/strategy" element={<Strategy />} />
          <Route path="/fa" element={<FreeAgency />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/trade" element={<TradeLab />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:key" element={<Report />} />
        </Routes>
        </ErrorBoundary>
      </AppShell.Main>
    </AppShell>
  );
}
