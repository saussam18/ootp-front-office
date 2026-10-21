// The design system: small Tailwind components every page builds from. Tokens live in index.css.
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as RTooltip from "@radix-ui/react-tooltip";
import { Command } from "cmdk";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { IconAlertTriangle, IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Meta } from "../api";
import { displayName } from "../format";

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

/** True on the public demo: edits are refused there, so pages disable their controls. */
export function useReadOnly() {
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta") });
  return !!meta.data?.read_only;
}

// ------------------------------------------------------------------ layout

export function Section({ title, right, children, id, className, flush }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; id?: string; className?: string; flush?: boolean;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 rounded-xl border border-line bg-surface", className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3.5 pb-2">
          <h3 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h3>
          {right && <div className="text-xs text-muted">{right}</div>}
        </header>
      )}
      <div className={flush ? "" : cn("px-4 pb-4", !(title || right) && "pt-4")}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={cn("num mt-0.5 text-2xl font-semibold tracking-tight", tone && TONE_TEXT[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
        {sub && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-medium uppercase tracking-wider text-faint", className)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</div>;
}

// ------------------------------------------------------------------ text, links, numbers

export function PlayerLink({ id, name, className }: { id?: number | null; name: string; className?: string }) {
  const label = displayName(name);
  if (!id || id <= 0) return <span className={className}>{label}</span>;
  return (
    <Link to={`/player/${id}`} className={cn("text-fg decoration-accent/50 underline-offset-2 hover:text-accent hover:underline", className)}>
      {label}
    </Link>
  );
}

export function TextLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return <Link to={to} className={cn("text-accent hover:underline underline-offset-2", className)}>{children}</Link>;
}

/** A number in a column: tabular, and a faint dash when missing. */
export function Num({ v, digits = 1, signed, className }: { v: unknown; digits?: number; signed?: boolean; className?: string }) {
  if (typeof v !== "number" || !Number.isFinite(v)) return <span className={cn("text-faint", className)}>–</span>;
  const s = v.toFixed(digits);
  const zero = Number(s) === 0;  // no "-0.0" or "+0.0"
  return <span className={cn("num", className)}>{signed && v > 0 && !zero ? "+" : ""}{zero ? Math.abs(0).toFixed(digits) : s}</span>;
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted", accent: "text-accent", good: "text-good", warn: "text-warn", bad: "text-bad",
};
const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted", accent: "bg-accent-soft text-accent", good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad",
};
const TONE_DOT: Record<Tone, string> = { neutral: "bg-faint", accent: "bg-accent", good: "bg-good", warn: "bg-warn", bad: "bg-bad" };

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE_BADGE[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", TONE_DOT[tone], className)} />;
}

export function Alert({ tone = "warn", title, children, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cn("flex gap-3 rounded-xl px-4 py-3 text-sm", TONE_BADGE[tone])}>
      <div className="mt-0.5 shrink-0">{icon ?? <IconAlertTriangle size={16} />}</div>
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="mt-0.5 text-fg/80 [&_a]:text-fg">{children}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tooltip

/** Hover help. Wrap any element; strings and numbers get a span to anchor to. */
export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (label === null || label === undefined || label === "") return <>{children}</>;
  return (
    <RTooltip.Root delayDuration={200}>
      <RTooltip.Trigger asChild>{typeof children === "object" ? children : <span>{children}</span>}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6}
          className="z-50 max-w-72 rounded-md bg-fg px-2.5 py-1.5 text-xs leading-snug text-bg shadow-lg">
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TipProvider = RTooltip.Provider;

// ------------------------------------------------------------------ controls

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "xs" | "sm" | "md" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "sm", className, ...p }, ref) {
  return (
    <button ref={ref} {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45",
        size === "xs" && "h-7 px-2 text-xs", size === "sm" && "h-8 px-3 text-[13px]", size === "md" && "h-9 px-4 text-sm",
        variant === "primary" && "bg-accent text-white hover:bg-accent/90 dark:text-bg",
        variant === "secondary" && "border border-line bg-surface text-fg hover:bg-sunken",
        variant === "ghost" && "text-muted hover:bg-sunken hover:text-fg",
        variant === "danger" && "text-bad hover:bg-bad-soft",
        className)} />
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, ...p }, ref) {
    return (
      <button ref={ref} aria-label={label} title={label} {...p}
        className={cn("inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg",
          "focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40", className)} />
    );
  });

const FIELD = "h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-faint outline-none transition-colors " +
  "hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  function Input({ className, icon, ...p }, ref) {
    if (!icon) return <input ref={ref} {...p} className={cn(FIELD, className)} />;
    return (
      <div className={cn("relative", className)}>
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-faint">{icon}</span>
        <input ref={ref} {...p} className={cn(FIELD, "pl-8")} />
      </div>
    );
  });

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={cn(FIELD, "h-auto min-h-16 py-1.5 leading-snug", className)} />;
});

/** A styled native select, for short fixed lists. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <div className={cn("relative", className)}>
      <select ref={ref} {...p} className={cn(FIELD, "appearance-none pr-7")}>{children}</select>
      <IconChevronDown size={14} className="pointer-events-none absolute inset-y-0 right-2 my-auto text-faint" />
    </div>
  );
});

export interface ComboOption { value: string; label: string; hint?: ReactNode; keywords?: string[] }

/** A searchable single-select: type to filter, arrows + enter to pick. */
export function Combobox({ value, onChange, options, placeholder = "Pick…", clearable, disabled, className, width = 320, empty = "No matches" }: {
  value: string | null; onChange: (v: string | null) => void; options: ComboOption[]; placeholder?: string; clearable?: boolean;
  disabled?: boolean; className?: string; width?: number; empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <Popover.Trigger asChild disabled={disabled}>
          <button type="button" className={cn(FIELD, "flex items-center pr-7 text-left", clearable && current && !disabled && "pr-12")}>
            <span className={cn("truncate", !current && "text-faint")}>{current ? current.label : placeholder}</span>
          </button>
        </Popover.Trigger>
        <IconChevronDown size={14} className="pointer-events-none absolute inset-y-0 right-2 my-auto text-faint" />
        {clearable && current && !disabled && (
          <button type="button" aria-label="Clear" onClick={() => onChange(null)}
            className="absolute inset-y-0 right-6 my-auto flex size-5 items-center justify-center rounded text-faint hover:bg-sunken hover:text-fg">
            <IconX size={12} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} style={{ width }}
          className="z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/10">
          <Command loop>
            <Command.Input autoFocus placeholder="Search…" className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-faint" />
            <Command.List className="max-h-72 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-4 text-center text-xs text-muted">{empty}</Command.Empty>
              {options.map((o) => (
                <Command.Item key={o.value} value={`${o.label} ${o.value}`} keywords={o.keywords}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] data-[selected=true]:bg-sunken">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <IconCheck size={13} className={cn("shrink-0 text-accent", o.value !== value && "invisible")} />
                    <span className="truncate">{o.label}</span>
                  </span>
                  {o.hint !== undefined && <span className="num shrink-0 text-xs text-muted">{o.hint}</span>}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "sm" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "xs" | "sm";
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn("rounded-md font-medium transition-colors", size === "xs" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-[13px]",
            o.value === value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2 text-[13px] text-muted", disabled && "pointer-events-none opacity-50")}>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative h-[18px] w-8 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}>
        <span className={cn("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all", checked ? "left-4" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

// ------------------------------------------------------------------ tables

export function Table({ children, className, minWidth }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className={cn("w-full border-collapse text-[13px]", className)} style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}

export function Th({ children, className, right, ...p }: { children?: ReactNode; className?: string; right?: boolean } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th {...p} className={cn("whitespace-nowrap border-b border-line px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-faint first:pl-0 last:pr-0",
      right ? "text-right" : "text-left", className)}>{children}</th>
  );
}

export function Td({ children, className, right, ...p }: { children?: ReactNode; className?: string; right?: boolean } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...p} className={cn("border-b border-line/70 px-2 py-1.5 align-middle first:pl-0 last:pr-0", right && "num text-right", className)}>{children}</td>;
}

// ------------------------------------------------------------------ states

export function Loading() {
  return (
    <div className="space-y-3">
      <div className="h-7 w-56 animate-pulse rounded-md bg-sunken" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-sunken" />)}
      </div>
    </div>
  );
}

export function Failed({ error }: { error: unknown }) {
  return <Alert tone="bad" title="Couldn't load">{String(error)}</Alert>;
}
