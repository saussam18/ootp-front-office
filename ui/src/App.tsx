import { useEffect, useState } from "react";
import { IconArrowsExchange, IconBrandGithub, IconClipboardList, IconHistory, IconMenu2, IconMoon, IconSun, IconUsers, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type Meta } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PlayerPicker } from "./components/PlayerPicker";
import { IconButton, cn } from "./components/ui";
import { Log } from "./pages/Log";
import { Market } from "./pages/Market";
import { Plan } from "./pages/Plan";
import { Player } from "./pages/Player";
import { Players } from "./pages/Players";
import { MARKET_TAB } from "./pages/Reports";

const REPO = "https://github.com/saussam18/ootp-front-office";

const NAV = [
  { to: "/", label: "Plan", icon: IconClipboardList },
  { to: "/market", label: "Market", icon: IconArrowsExchange },
  { to: "/players", label: "Players", icon: IconUsers },
  { to: "/log", label: "Log", icon: IconHistory },
];

/** Old URLs (bookmarks, links in notes) land on the page that now holds that view, keeping their query string. */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  const extra = search.replace(/^\?/, "");
  return <Navigate replace to={extra ? `${to}${to.includes("?") ? "&" : "?"}${extra}` : to} />;
}

function ReportRedirect() {
  const { key = "" } = useParams();
  return <Redirect to={MARKET_TAB[key] ? `/market?tab=${MARKET_TAB[key]}` : `/players?tab=reports&report=${key}`} />;
}

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
    <nav className="flex h-full flex-col gap-0.5 px-3 py-4">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === "/"} onClick={onNavigate}
          className={({ isActive }) => cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors",
            isActive ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:bg-sunken hover:text-fg")}>
          <Icon size={16} stroke={1.75} />
          {label}
        </NavLink>
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
                <Route path="/" element={<Plan />} />
                <Route path="/market" element={<Market />} />
                <Route path="/players" element={<Players />} />
                <Route path="/log" element={<Log />} />
                <Route path="/player/:id" element={<Player />} />
                {["/plans", "/fa", "/forty", "/dashboard"].map((p) => <Route key={p} path={p} element={<Redirect to="/" />} />)}
                <Route path="/trade" element={<Redirect to="/market?tab=trade" />} />
                <Route path="/reports" element={<Redirect to="/players?tab=reports" />} />
                <Route path="/reports/:key" element={<ReportRedirect />} />
                <Route path="/roster" element={<Redirect to="/players" />} />
                <Route path="/moves" element={<Redirect to="/log" />} />
                <Route path="/strategy" element={<Redirect to="/log?tab=notes" />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
