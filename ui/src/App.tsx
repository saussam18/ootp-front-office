import { useEffect, useState } from "react";
import { IconArrowsExchange, IconBallBaseball, IconBrandGithub, IconCalendarDollar, IconChartBar, IconClipboardList, IconHistory,
  IconLayoutDashboard, IconListNumbers, IconMenu2, IconMoon, IconNotes, IconSun, IconUsers, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, type Meta } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PlayerPicker } from "./components/PlayerPicker";
import { IconButton, cn } from "./components/ui";
import { Board } from "./pages/Board";
import { Dashboard } from "./pages/Dashboard";
import { Forty } from "./pages/Forty";
import { FreeAgency } from "./pages/FreeAgency";
import { Moves } from "./pages/Moves";
import { Player } from "./pages/Player";
import { Plans } from "./pages/Plans";
import { Report, Reports } from "./pages/Reports";
import { Roster } from "./pages/Roster";
import { Strategy } from "./pages/Strategy";
import { TradeLab } from "./pages/TradeLab";

const REPO = "https://github.com/saussam18/ootp-front-office";

const NAV = [
  { group: "Plan", items: [
    { to: "/", label: "Team plan", icon: IconClipboardList },
    { to: "/plans", label: "Lineups & staff", icon: IconBallBaseball },
    { to: "/fa", label: "Free agency", icon: IconCalendarDollar },
    { to: "/forty", label: "40-man", icon: IconListNumbers },
  ] },
  { group: "Market", items: [
    { to: "/trade", label: "Trade lab", icon: IconArrowsExchange },
    { to: "/reports", label: "Reports", icon: IconChartBar },
  ] },
  { group: "Club", items: [
    { to: "/roster", label: "Roster", icon: IconUsers },
    { to: "/moves", label: "Moves", icon: IconHistory },
    { to: "/strategy", label: "Strategy", icon: IconNotes },
    { to: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  ] },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* private mode */ }
  }, [dark]);
  return [dark, setDark] as const;
}

function Nav({ meta, onNavigate }: { meta?: Meta; onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col gap-5 px-3 py-4">
      {NAV.map(({ group, items }) => (
        <div key={group}>
          <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">{group}</div>
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={onNavigate}
              className={({ isActive }) => cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors",
                isActive ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:bg-sunken hover:text-fg")}>
              <Icon size={16} stroke={1.75} />
              {label}
            </NavLink>
          ))}
        </div>
      ))}
      {meta && (
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-faint">
          Season {meta.season} · planning {meta.next}<br />Data {meta.snapshot.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/, "$1-$2-$3 $4:$5")}
        </div>
      )}
    </nav>
  );
}

export function App() {
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta") });
  const team = meta.data?.team ?? "Halifax";

  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="min-h-screen">
      {meta.data?.read_only && (
        <div className="border-b border-line bg-accent-soft px-4 py-1.5 text-center text-xs text-accent">
          Read-only demo of a live OOTP 27 online league front office ({team}, RLB).{" "}
          <a href={REPO} className="font-medium underline underline-offset-2">Source on GitHub</a>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <IconButton label="Menu" className="md:hidden" onClick={() => setMenu((m) => !m)}>
            {menu ? <IconX size={18} /> : <IconMenu2 size={18} />}
          </IconButton>
          <NavLink to="/" className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-fg text-[13px] font-bold text-bg">{team[0]}</span>
            <span className="text-[15px] font-semibold tracking-tight">{team} <span className="font-normal text-muted">front office</span></span>
          </NavLink>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="hidden w-72 sm:block">
              <PlayerPicker value={[]} single placeholder="Find any player…" onChange={(p) => p[0] && navigate(`/player/${p[0].id}`)} />
            </div>
            <a href={REPO} aria-label="Source on GitHub" title="Source on GitHub"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-fg">
              <IconBrandGithub size={17} />
            </a>
            <IconButton label={dark ? "Light mode" : "Dark mode"} onClick={() => setDark(!dark)}>
              {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
            </IconButton>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-line md:block">
          <Nav meta={meta.data} />
        </aside>
        {menu && (
          <div className="fixed inset-0 top-14 z-20 bg-bg md:hidden">
            <div className="px-4 pt-3 sm:hidden">
              <PlayerPicker value={[]} single placeholder="Find any player…" onChange={(p) => p[0] && navigate(`/player/${p[0].id}`)} />
            </div>
            <Nav meta={meta.data} onNavigate={() => setMenu(false)} />
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto max-w-[1400px]">
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
          </div>
        </main>
      </div>
    </div>
  );
}
