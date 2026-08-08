"use client";

import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Headphones,
  LoaderCircle,
  Search,
  ThumbsDown,
  ThumbsUp
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { type HelpContent, helpCategories } from "@/lib/help-content";
import { SupportCenter } from "./support-center";

type HelpResponse = {
  ok: boolean;
  contents?: HelpContent[];
  total?: number;
  categories?: Array<{ name: string; slug: string }>;
  message?: string;
};

const quickActions = [
  ["Rastrear pedido", "/minha-conta/pedidos"],
  ["Troca ou devolução", "/politicas/trocas-e-devolucoes"],
  ["Pagamento", "/politicas/pagamento"],
  ["Minha conta", "/minha-conta"],
  ["Representante Curtiz", "/representante"]
] as const;

function Highlight({ text, query }: { text: string; query: string }) {
  const term = query.trim();
  if (!term) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pieces = text.split(new RegExp(`(${escaped})`, "giu"));
  return pieces.map((piece, index) =>
    piece.toLocaleLowerCase("pt-BR") === term.toLocaleLowerCase("pt-BR") ? (
      <mark key={`${piece}-${index}`}>{piece}</mark>
    ) : (
      piece
    )
  );
}

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [contents, setContents] = useState<HelpContent[]>([]);
  const [categories, setCategories] = useState<Array<{ name: string; slug: string }>>([
    ...helpCategories
  ]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<HelpContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});
  const sessionId = useRef("");

  useEffect(() => {
    sessionId.current = sessionStorage.getItem("curtiz-help-session") ?? crypto.randomUUID();
    sessionStorage.setItem("curtiz-help-session", sessionId.current);
    const initialQuery = new URLSearchParams(window.location.search).get("q")?.slice(0, 160);
    if (initialQuery) setQuery(initialQuery);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadResults = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (query.trim()) params.set("q", query.trim());
        if (category) params.set("category", category);
        const response = await fetch(`/api/help?${params}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const result = (await response.json()) as HelpResponse;
        if (!response.ok || !result.ok) throw new Error(result.message);
        setContents(result.contents ?? []);
        setTotal(result.total ?? 0);
        if (result.categories?.length) setCategories(result.categories);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError("Não foi possível consultar a Central de Ajuda.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const timer = window.setTimeout(() => void loadResults(), query ? 320 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [category, page, query]);

  const totalPages = Math.max(1, Math.ceil(total / 12));
  const heading = useMemo(() => {
    if (query) return `Resultados para “${query}”`;
    if (category) return categories.find((item) => item.slug === category)?.name ?? "Conteúdos";
    return "Artigos e perguntas frequentes";
  }, [categories, category, query]);

  const registerFeedback = async (content: HelpContent, helpful: boolean) => {
    if (!sessionId.current || feedback[content.id] !== undefined) return;
    setFeedback((current) => ({ ...current, [content.id]: helpful }));
    await fetch("/api/help", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "feedback",
        contentId: content.id,
        sessionId: sessionId.current,
        helpful
      })
    }).catch(() => undefined);
  };

  const openContent = (content: HelpContent) => {
    setSelected(content);
    void fetch("/api/help", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "view", contentId: content.id })
    }).catch(() => undefined);
  };

  return (
    <div className="help-center-v2">
      <section className="help-search-hero" aria-labelledby="help-search-title">
        <p className="eyebrow">Central de Ajuda Curtiz</p>
        <h1 id="help-search-title">Olá! Como podemos ajudar?</h1>
        <p>Pesquise conteúdos revisados ou acompanhe um chamado com a equipe.</p>
        <label className="help-main-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Pesquisar na Central de Ajuda</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value.slice(0, 160));
              setPage(1);
            }}
            placeholder="Busque por pedido, entrega, troca, conta…"
            autoComplete="off"
          />
          {loading && <LoaderCircle className="spin" aria-label="Pesquisando" />}
        </label>
        <div className="help-quick-actions" aria-label="Atalhos">
          {quickActions.map(([label, href]) => (
            <Link href={href} key={label}>
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section className="help-category-section" aria-labelledby="help-categories-title">
        <div className="help-section-title">
          <div>
            <p className="eyebrow">Navegue por tema</p>
            <h2 id="help-categories-title">Categorias</h2>
          </div>
          {category && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setCategory("");
                setPage(1);
              }}
            >
              Limpar filtro
            </button>
          )}
        </div>
        <div className="help-category-grid">
          {categories.map((item) => (
            <button
              type="button"
              key={item.slug}
              className={category === item.slug ? "active" : ""}
              onClick={() => {
                setCategory(item.slug);
                setPage(1);
              }}
              aria-pressed={category === item.slug}
            >
              <CircleHelp aria-hidden="true" />
              <span>{item.name}</span>
              <ArrowRight aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      {!query && !category && !loading && contents.length > 0 && (
        <section className="help-discovery" aria-label="Destaques da Central de Ajuda">
          {(
            [
              ["Conteúdos populares", contents.slice(0, 3)],
              [
                "Conteúdos recentes",
                [...contents]
                  .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
                  .slice(0, 3)
              ],
              [
                "Tutoriais",
                contents
                  .filter((item) => ["tutorial", "step_by_step"].includes(item.type))
                  .slice(0, 3)
              ]
            ] satisfies Array<[string, HelpContent[]]>
          ).map(([title, items]) => (
            <article key={title}>
              <h2>{title}</h2>
              {items.length ? (
                items.map((item) => (
                  <button type="button" key={item.id} onClick={() => openContent(item)}>
                    <span>{item.title}</span>
                    <ArrowRight />
                  </button>
                ))
              ) : (
                <p>Nenhum conteúdo publicado nesta seção.</p>
              )}
            </article>
          ))}
        </section>
      )}

      <section className="help-results" aria-labelledby="help-results-title">
        <div className="help-section-title">
          <div>
            <p className="eyebrow">Conteúdo publicado</p>
            <h2 id="help-results-title">{heading}</h2>
          </div>
          <span>
            {total} resultado{total === 1 ? "" : "s"}
          </span>
        </div>
        {error ? (
          <div className="help-empty" role="alert">
            <CircleHelp />
            <h3>Busca indisponível</h3>
            <p>{error}</p>
          </div>
        ) : loading ? (
          <div className="help-result-grid" aria-label="Carregando conteúdos">
            {[1, 2, 3].map((item) => (
              <div className="help-result-skeleton" key={item} />
            ))}
          </div>
        ) : contents.length === 0 ? (
          <div className="help-empty">
            <CircleHelp />
            <h3>Nenhum conteúdo encontrado</h3>
            <p>Tente outras palavras ou encaminhe sua dúvida para o atendimento.</p>
            <a href="#chamados" className="primary-button">
              <Headphones /> Falar com atendimento
            </a>
          </div>
        ) : (
          <div className="help-result-grid">
            {contents.map((content) => (
              <article key={content.id}>
                <span>
                  {content.categoryName} · {content.type.replaceAll("_", " ")}
                </span>
                <h3>
                  <Highlight text={content.title} query={query} />
                </h3>
                <p>
                  <Highlight text={content.summary} query={query} />
                </p>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => openContent(content)}
                >
                  Ler conteúdo <ArrowRight />
                </button>
              </article>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <nav className="help-pagination" aria-label="Paginação">
            <button
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft />
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((value) => value + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight />
            </button>
          </nav>
        )}
      </section>

      {selected && (
        <section className="help-reader" aria-labelledby="help-reader-title">
          <button type="button" className="help-reader-close" onClick={() => setSelected(null)}>
            Fechar
          </button>
          <p className="eyebrow">
            {selected.categoryName} · versão {selected.version}
          </p>
          <h2 id="help-reader-title">{selected.title}</h2>
          <p className="help-reader-summary">{selected.summary}</p>
          <div className="help-reader-body">
            {selected.body.split("\n").map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {selected.media?.map((media) => (
            <a
              className="secondary-button"
              href={media.url}
              target="_blank"
              rel="noreferrer"
              key={media.url}
            >
              {media.label || "Abrir mídia"}
              <ArrowRight />
            </a>
          ))}
          {selected.relatedAction && (
            <Link className="secondary-button" href={selected.relatedAction.href}>
              {selected.relatedAction.label}
              <ArrowRight />
            </Link>
          )}
          {selected.related?.length ? (
            <aside className="help-related-content">
              <h3>Conteúdos relacionados</h3>
              {selected.related.map((item) => (
                <button
                  type="button"
                  key={item.slug}
                  onClick={() => {
                    setSelected(null);
                    setQuery(item.title);
                    setPage(1);
                  }}
                >
                  {item.title} <ArrowRight />
                </button>
              ))}
            </aside>
          ) : null}
          <footer>
            <span>
              Última atualização:{" "}
              {new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "long",
                timeZone: "America/Sao_Paulo"
              }).format(new Date(selected.updatedAt))}
            </span>
            <div>
              <strong>Esta informação ajudou?</strong>
              <button
                disabled={feedback[selected.id] !== undefined}
                onClick={() => void registerFeedback(selected, true)}
                aria-label="Sim, ajudou"
              >
                <ThumbsUp />
              </button>
              <button
                disabled={feedback[selected.id] !== undefined}
                onClick={() => void registerFeedback(selected, false)}
                aria-label="Não ajudou"
              >
                <ThumbsDown />
              </button>
            </div>
          </footer>
        </section>
      )}

      <section id="chamados" className="help-ticket-section">
        <div className="help-section-title">
          <div>
            <p className="eyebrow">Atendimento humano</p>
            <h2>Chamados e acompanhamento</h2>
            <p>Entre para abrir, responder e acompanhar seus protocolos.</p>
          </div>
          <BookOpen aria-hidden="true" />
        </div>
        <SupportCenter />
      </section>
    </div>
  );
}
