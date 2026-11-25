"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PanelRouteRole } from "@/lib/panel-roles";
import { actionsForPanel, suggestedActions } from "@/lib/search-actions";
import { highlightSegments, rankSearch } from "@/lib/search-engine";

type RecordItem = { id: string; title: string; subtitle: string; href: string; group: string };
type RecordGroup = { type: string; label: string; items: Omit<RecordItem, "group">[] };

/** Página do menu do painel; montada pelo PanelShell a partir do menu real. */
export type SearchPage = { label: string; href: string; area?: string; description?: string };

type ResultRow = {
  key: string;
  section: "Ações" | "Páginas" | "Registros";
  title: string;
  subtitle: string;
  href: string;
  tag?: string;
};

const RECENT_KEY = "curtiz:panel-search:recent:v1";
const MAX_RECENT = 6;

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(query: string) {
  const value = query.trim();
  if (value.length < 2) return;
  try {
    const next = [value, ...readRecent().filter((item) => item.toLocaleLowerCase("pt-BR") !== value.toLocaleLowerCase("pt-BR"))].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Armazenamento indisponível: a busca continua funcionando sem histórico.
  }
}

function parseGroups(value: unknown): RecordGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    const candidate = group as Record<string, unknown>;
    if (typeof candidate.type !== "string" || typeof candidate.label !== "string" || !Array.isArray(candidate.items)) return [];
    const items = candidate.items.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.title === "string" && typeof record.subtitle === "string" && typeof record.href === "string"
        ? [{ id: record.id, title: record.title, subtitle: record.subtitle, href: record.href }]
        : [];
    });
    return [{ type: candidate.type, label: candidate.label, items }];
  });
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  return highlightSegments(text, query).map((segment, index) =>
    segment.match ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>
  );
}

export function PanelGlobalSearch({
  role,
  pages = [],
  onNavigate,
  onClose
}: {
  role: PanelRouteRole;
  pages?: readonly SearchPage[];
  onNavigate: () => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const trimmed = query.trim();

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  // Permissões já expostas pelo painel: só administração e gerência as consultam.
  useEffect(() => {
    if (role !== "administracao" && role !== "gerencia") return;
    const controller = new AbortController();
    void fetch("/api/internal-capabilities", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        const map = payload && typeof payload === "object" ? (payload as Record<string, unknown>).capabilities : null;
        if (!map || typeof map !== "object") return;
        setCapabilities(Object.fromEntries(Object.entries(map).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [role]);

  // Registros (pedidos, clientes, produtos...) continuam vindo do servidor, com debounce.
  useEffect(() => {
    if (trimmed.length < 2) {
      setRecords([]);
      setMessage("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setMessage("");
      void fetch(`/api/global-search?role=${role}&q=${encodeURIComponent(trimmed)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("search_failed");
          const groups = parseGroups((payload as Record<string, unknown>).groups);
          setRecords(groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))));
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setRecords([]);
            setMessage("Não foi possível buscar registros agora.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, role]);

  const available = useMemo(() => actionsForPanel(role, capabilities), [role, capabilities]);

  const rows = useMemo<ResultRow[]>(() => {
    const toAction = (action: (typeof available)[number]): ResultRow => ({
      key: `action:${action.id}`,
      section: "Ações",
      title: action.title,
      subtitle: action.description,
      href: action.href,
      tag: action.area
    });
    if (!trimmed) return suggestedActions(role, available).map(toAction);
    const actions = rankSearch(trimmed, available, 6).map(({ item }) => toAction(item));
    const shown = new Set(actions.map((row) => row.href));
    const pageItems = pages
      .filter((page) => !shown.has(page.href))
      .map((page) => ({ id: page.href, title: page.label, description: page.description ?? "", area: page.area ?? "", page }));
    const pageRows = rankSearch(trimmed, pageItems, 6).map(({ item }): ResultRow => ({
      key: `page:${item.id}`,
      section: "Páginas",
      title: item.page.label,
      subtitle: item.page.description ?? "Abrir página",
      href: item.page.href,
      ...(item.page.area ? { tag: item.page.area } : {})
    }));
    const recordRows = records.map((record): ResultRow => ({
      key: `record:${record.group}:${record.id}`,
      section: "Registros",
      title: record.title,
      subtitle: record.subtitle,
      href: record.href,
      tag: record.group
    }));
    return [...actions, ...pageRows, ...recordRows];
  }, [trimmed, role, available, pages, records]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed, rows.length]);
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const sections = (["Ações", "Páginas", "Registros"] as const)
    .map((section) => ({ section, rows: rows.filter((row) => row.section === section) }))
    .filter((group) => group.rows.length);
  const emptyQuery = trimmed.length === 0;
  const noResults = !emptyQuery && !loading && rows.length === 0;
  let cursor = -1;

  return (
    <div className="panel-global-search" id="panel-global-search">
      <label className="sr-only" htmlFor="panel-search">Buscar no painel</label>
      <Search className="panel-global-search-icon" aria-hidden="true" />
      <input
        id="panel-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (!rows.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % rows.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + rows.length) % rows.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            optionRefs.current[activeIndex]?.click();
          }
        }}
        placeholder="Buscar no painel…"
        aria-label="Buscar no painel"
        autoComplete="off"
        autoFocus
        role="combobox"
        aria-autocomplete="list"
        aria-controls="panel-search-results"
        aria-expanded="true"
        aria-activedescendant={rows[activeIndex] ? `panel-search-option-${activeIndex}` : undefined}
      />
      {loading ? <LoaderCircle className="spin panel-global-search-loader" aria-label="Buscando" /> : null}
      {onClose ? <button className="panel-global-search-close" type="button" onClick={onClose} aria-label="Fechar busca"><X aria-hidden="true" /></button> : null}
      <div className="panel-global-search-results" id="panel-search-results" role="listbox" aria-label="Resultados da busca" aria-live="polite">
        {emptyQuery && recent.length ? (
          <section>
            <h2>Buscas recentes</h2>
            <div className="panel-global-search-recent">
              {recent.map((item) => (
                <button type="button" key={item} onClick={() => setQuery(item)}>{item}</button>
              ))}
            </div>
          </section>
        ) : null}
        {sections.map((group) => (
          <section key={group.section}>
            <h2>{emptyQuery && group.section === "Ações" ? "Ações sugeridas" : group.section}</h2>
            {group.rows.map((row) => {
              cursor += 1;
              const index = cursor;
              return (
                <Link
                  href={row.href}
                  key={row.key}
                  id={`panel-search-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex ? "true" : undefined}
                  tabIndex={-1}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => { saveRecent(trimmed); onNavigate(); }}
                >
                  <strong><Highlight text={row.title} query={trimmed} /></strong>
                  <small>{row.tag ? <em>{row.tag}</em> : null}<Highlight text={row.subtitle} query={trimmed} /></small>
                </Link>
              );
            })}
          </section>
        ))}
        {noResults ? (
          <div className="panel-global-search-empty">
            <p>Nenhum resultado para “{trimmed}”.</p>
            <small>Tente outra palavra, como “aprovar”, “reembolso”, “produto” ou “nota fiscal”, ou abra uma sugestão.</small>
            <div className="panel-global-search-recent">
              {suggestedActions(role, available).slice(0, 4).map((action) => (
                <Link key={action.id} href={action.href} onClick={onNavigate}>{action.title}</Link>
              ))}
            </div>
          </div>
        ) : null}
        {message ? <p>{message}</p> : null}
      </div>
    </div>
  );
}
