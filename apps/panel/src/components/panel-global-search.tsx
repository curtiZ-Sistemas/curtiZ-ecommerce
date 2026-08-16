"use client";

import { LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PanelRouteRole } from "@/lib/panel-roles";

type SearchItem = { id: string; title: string; subtitle: string; href: string };
type SearchGroup = { type: string; label: string; items: SearchItem[] };

function parseGroups(value: unknown): SearchGroup[] {
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

export function PanelGlobalSearch({ role, onNavigate }: { role: PanelRouteRole; onNavigate: () => void }) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const linksRef = useRef<Array<HTMLAnchorElement | null>>([]);
  const items = groups.flatMap((group) => group.items);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setGroups([]);
      setMessage("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setMessage("");
      void fetch(`/api/global-search?role=${role}&q=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new Error("search_failed");
          }
          const nextGroups = parseGroups((payload as Record<string, unknown>).groups);
          setGroups(nextGroups);
          setActiveIndex(-1);
          setMessage(nextGroups.length ? "" : "Nenhum resultado encontrado.");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setGroups([]);
            setMessage("Não foi possível buscar agora.");
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
  }, [query, role]);

  return (
    <div className="panel-global-search">
      <label className="sr-only" htmlFor="panel-search">Buscar no painel</label>
      <Search aria-hidden="true" />
      <input
        id="panel-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && items.length) {
            event.preventDefault();
            const next = (activeIndex + 1) % items.length;
            setActiveIndex(next);
            linksRef.current[next]?.focus();
          }
        }}
        placeholder="Pedido, cliente, produto ou atendimento…"
        autoComplete="off"
        autoFocus
        aria-controls="panel-search-results"
        aria-expanded={query.trim().length >= 2}
      />
      {loading ? <LoaderCircle className="spin panel-global-search-loader" aria-label="Buscando" /> : null}
      {query.trim().length >= 2 ? (
        <div className="panel-global-search-results" id="panel-search-results" role="region" aria-live="polite">
          {groups.map((group) => (
            <section key={group.type}>
              <h2>{group.label}</h2>
              {group.items.map((item) => {
                const index = items.findIndex((candidate) => candidate.id === item.id && candidate.href === item.href);
                return (
                  <Link
                    href={item.href}
                    key={`${group.type}-${item.id}`}
                    ref={(element) => { linksRef.current[index] = element; }}
                    onClick={onNavigate}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        const next = (index + direction + items.length) % items.length;
                        setActiveIndex(next);
                        linksRef.current[next]?.focus();
                      }
                    }}
                  >
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </Link>
                );
              })}
            </section>
          ))}
          {message ? <p>{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
