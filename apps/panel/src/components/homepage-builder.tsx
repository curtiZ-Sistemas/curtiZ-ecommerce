"use client";

import {
  Archive, ArrowDown, ArrowUp, BarChart3, Check, ChevronDown, ChevronUp, Copy,
  Eye, FileClock, GripVertical, History, ImagePlus, LoaderCircle, Lock, Monitor,
  MoveDown, MoveUp, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Send,
  ShieldCheck, Smartphone, Tablet, Trash2, Unlock, Upload, X
} from "lucide-react";
import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const sectionTypes = [
  ["banner_hero", "Banner principal"], ["product_carousel", "Carrossel de produtos"],
  ["product_grid", "Grade de produtos"], ["product_horizontal", "Lista horizontal de produtos"],
  ["categories_grid", "Categorias"], ["models_grid", "Modelos"], ["brands_strip", "Marcas"],
  ["collections_grid", "Coleções"], ["image_links", "Imagens com links"],
  ["image_mosaic", "Mosaico de imagens"], ["promotions", "Promoções"],
  ["flash_offers", "Ofertas relâmpago"], ["best_sellers", "Mais vendidos"],
  ["launches", "Lançamentos"], ["featured_products", "Produtos em destaque"],
  ["recommended_products", "Produtos recomendados"], ["manual_products", "Produtos manuais"],
  ["campaigns", "Campanhas"], ["benefits", "Benefícios"],
  ["reviews_carousel", "Avaliações de clientes"], ["editorial", "Conteúdo editorial"],
  ["video", "Vídeo"], ["image_text", "Texto com imagem"], ["countdown", "Contagem regressiva"],
  ["newsletter", "Newsletter"], ["institutional", "Institucional"],
  ["quick_links", "Links rápidos"], ["safe_component", "Componente seguro"]
] as const;

const layouts = [
  ["one_column", "1 coluna"], ["two_equal", "2 colunas iguais"],
  ["two_featured", "2 colunas com destaque"], ["three_equal", "3 colunas iguais"],
  ["three_centered", "3 colunas, destaque central"], ["four_columns", "4 colunas"],
  ["editorial_mosaic", "Mosaico editorial"], ["carousel", "Carrossel"],
  ["grid", "Grade"], ["horizontal_strip", "Faixa horizontal"],
  ["full_width", "Largura total"], ["content_centered", "Conteúdo centralizado"]
] as const;

type Capability = "homepage.view" | "homepage.create" | "homepage.edit" | "homepage.review" |
  "homepage.publish" | "homepage.lock" | "homepage.media.manage" | "homepage.metrics.read" | "homepage.audit.read";
type Media = { id?: string; media_role?: string; storage_path?: string; mime_type?: string; alt_text?: string; size_bytes?: number };
type EditorMedia = { path: string; role: string; mimeType: string; sizeBytes: number };
type Item = {
  id?: string; item_type: string; internal_name: string; title: string; subtitle: string;
  description: string; alt_text: string; decorative: boolean; target_type: string;
  target_id: string; target_route: string; sort_order: number; config: Record<string, unknown>;
  media: EditorMedia[];
};
type Section = {
  id: string; internal_name: string; section_type: string; title: string | null; subtitle: string | null;
  description: string | null; layout: string; status: string; visibility: string;
  style_config: Record<string, unknown>; content_config: Record<string, unknown>; starts_at: string | null;
  ends_at: string | null; sort_order: number; locked: boolean; revision: number;
  current_version_id: string | null; updated_at: string; responsible_name: string; home_section_items: Array<Record<string, unknown>>;
};
type Version = { id: string; section_id: string; version: number; status: string; change_summary: string | null; created_at: string };
type PageVersion = { id: string; version: number; status: string; reason: string; scheduled_at: string | null; published_at: string | null; created_at: string };
type Metric = { section_version_id: string; item_key: string; metric_date: string; device: string; views: number; clicks: number };
type Audit = { id: string; section_id: string | null; actor_role: string | null; action: string; reason: string | null; created_at: string };
type ApiData = { sections: Section[]; versions: Version[]; pageVersions: PageVersion[]; metrics: Metric[]; audit: Audit[]; capabilities: Record<Capability, boolean>; message?: string };
type Target = { id: string; label: string; route: string; detail: string; image?: string };
type Editor = {
  id?: string; revision?: number; internalName: string; sectionType: string; title: string;
  subtitle: string; description: string; layout: string; visibility: string; startsAt: string;
  endsAt: string; sortOrder: number; changeSummary: string; style: Record<string, unknown>; content: Record<string, unknown>; items: Item[];
};

const emptyItem = (index: number): Item => ({
  item_type: "content", internal_name: `Item ${index + 1}`, title: "", subtitle: "", description: "",
  alt_text: "", decorative: false, target_type: "none", target_id: "", target_route: "",
  sort_order: index, config: {}, media: []
});
const emptyEditor = (position: number): Editor => ({
  internalName: "", sectionType: "product_grid", title: "", subtitle: "", description: "",
  layout: "content_centered", visibility: "all", startsAt: "", endsAt: "", sortOrder: position, changeSummary: "Nova seção",
  style: { spacingTop: "medium", spacingBottom: "medium", background: "default", textTone: "dark", radius: "none", shadow: "none" },
  content: { source: "automatic", limit: 8, columns: 4, display: "grid", showPrice: true, showRating: true, showDiscount: true, showInstallments: false, showFavorite: true, showPurchase: false, showStock: false, showBadge: true },
  items: [],
});
const dateInput = (value: string | null) => value ? value.slice(0, 16) : "";
const toIso = (value: string) => value ? new Date(`${value}:00-03:00`).toISOString() : undefined;
const typeLabel = (value: string) => sectionTypes.find(([key]) => key === value)?.[1] ?? value;
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Sem limite";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const configString = (record: Record<string, unknown>, key: string, fallback: string) => typeof record[key] === "string" ? record[key] : fallback;
const targetImage = (path?: string): CSSProperties | undefined => path && process.env.NEXT_PUBLIC_SUPABASE_URL ? { backgroundImage: `url(${JSON.stringify(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/catalog-public/${path}`)})` } : undefined;
function thumbnailStyle(section: Section): CSSProperties | undefined {
  for (const item of section.home_section_items) {
    const media = Array.isArray(item.home_section_item_media) ? item.home_section_item_media.find(isRecord) : null;
    const path = media && typeof media.storage_path === "string" ? media.storage_path : "";
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (path && base) return { backgroundImage: `url(${JSON.stringify(`${base}/storage/v1/object/public/homepage-public/${path}`)})`, backgroundPosition: "center", backgroundSize: "cover" };
  }
  return undefined;
}

function sectionEditor(section: Section): Editor {
  const items = Array.isArray(section.home_section_items) ? [...section.home_section_items].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map((row, index): Item => {
    const mediaRows = Array.isArray(row.home_section_item_media) ? row.home_section_item_media.filter(isRecord) as Media[] : [];
    return {
      id: typeof row.id === "string" ? row.id : undefined,
      item_type: typeof row.item_type === "string" ? row.item_type : "content",
      internal_name: typeof row.internal_name === "string" ? row.internal_name : `Item ${index + 1}`,
      title: typeof row.title === "string" ? row.title : "", subtitle: typeof row.subtitle === "string" ? row.subtitle : "",
      description: typeof row.description === "string" ? row.description : "", alt_text: typeof row.alt_text === "string" ? row.alt_text : "",
      decorative: row.decorative === true, target_type: typeof row.target_type === "string" ? row.target_type : "none",
      target_id: typeof row.target_id === "string" ? row.target_id : "", target_route: typeof row.target_route === "string" ? row.target_route : "",
      sort_order: typeof row.sort_order === "number" ? row.sort_order : index, config: isRecord(row.config) ? row.config : {},
      media: mediaRows.flatMap((entry) => entry.storage_path && entry.media_role && entry.mime_type ? [{ path: entry.storage_path, role: entry.media_role, mimeType: entry.mime_type, sizeBytes: entry.size_bytes ?? 1 }] : [])
    };
  }) : [];
  return { id: section.id, revision: section.revision, internalName: section.internal_name, sectionType: section.section_type,
    title: section.title ?? "", subtitle: section.subtitle ?? "", description: section.description ?? "", layout: section.layout,
    visibility: section.visibility, startsAt: dateInput(section.starts_at), endsAt: dateInput(section.ends_at), sortOrder: section.sort_order, changeSummary: "Atualização do conteúdo",
    style: section.style_config ?? {}, content: section.content_config ?? {}, items };
}

export function HomepageBuilder({ showVersions = false }: { showVersions?: boolean }) {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [tab, setTab] = useState<"builder" | "history" | "metrics" | "audit">(showVersions ? "history" : "builder");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preview, setPreview] = useState<Editor | "page" | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const dragId = useRef("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/homepage-builder", { cache: "no-store" });
      const result = await response.json() as ApiData;
      if (!response.ok) throw new Error(result.message);
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.message ? loadError.message : "Não foi possível carregar o construtor.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setEditor(null); setPreview(null); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);

  const act = async (body: Record<string, unknown>, success: string) => {
    if (pending) return false;
    setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/homepage-builder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message);
      setMessage(result.message ?? success); await load(); return true;
    } catch (actionError) {
      setError(actionError instanceof Error && actionError.message ? actionError.message : "Não foi possível concluir a operação."); return false;
    } finally { setPending(false); }
  };

  const sections = useMemo(() => (data?.sections ?? []).filter((section) => {
    const text = `${section.internal_name} ${section.title ?? ""}`.toLocaleLowerCase("pt-BR");
    const now = Date.now(); const starts = section.starts_at ? Date.parse(section.starts_at) : null; const ends = section.ends_at ? Date.parse(section.ends_at) : null;
    const periodMatches = !periodFilter || periodFilter === "current" && (!starts || starts <= now) && (!ends || ends > now) || periodFilter === "future" && Boolean(starts && starts > now) || periodFilter === "expired" && Boolean(ends && ends <= now);
    return (!query || text.includes(query.toLocaleLowerCase("pt-BR"))) && (!typeFilter || section.section_type === typeFilter) && (!statusFilter || section.status === statusFilter) && periodMatches;
  }), [data, periodFilter, query, typeFilter, statusFilter]);

  const reorder = async (sectionId: string, destination: number) => {
    if (!data?.capabilities["homepage.edit"]) return;
    const ordered = [...data.sections].sort((a, b) => a.sort_order - b.sort_order);
    const from = ordered.findIndex((item) => item.id === sectionId);
    if (from < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(Math.max(0, Math.min(destination, ordered.length)), 0, moved!);
    await act({ action: "reorder", sectionIds: ordered.map((item) => item.id), revisions: ordered.map((item) => item.revision) }, "Ordem atualizada.");
  };

  const transition = async (section: Section, transitionName: string) => {
    const reason = window.prompt(transitionName === "submit_review" ? "Resumo para a revisão:" : "Informe a justificativa:")?.trim();
    if (!reason) return;
    await act({ action: "transition", sectionId: section.id, transition: transitionName, reason }, "Fluxo atualizado.");
  };

  const publish = async (scheduled: boolean) => {
    const reason = window.prompt("Justificativa da publicação:")?.trim();
    if (!reason) return;
    let scheduledAt: string | undefined;
    if (scheduled) {
      const value = window.prompt("Data e hora no formato AAAA-MM-DDTHH:mm:")?.trim();
      if (!value) return;
      scheduledAt = toIso(value);
    }
    await act({ action: "publish", reason, ...(scheduledAt ? { scheduledAt } : {}) }, scheduled ? "Publicação agendada." : "Página publicada.");
  };

  if (!loading && !data && error) {
    return (
      <section className="panel-card homepage-professional">
        <header className="homepage-builder-header">
          <div><p className="eyebrow">Conteúdo</p><h1>Construtor da Página Inicial</h1><p>Monte, revise e publique a home por snapshots atômicos, sem editar código.</p></div>
        </header>
        <div className="admin-empty-state" role="alert">
          <h2>Construtor indisponível</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-card homepage-professional">
      <header className="homepage-builder-header">
        <div><p className="eyebrow">Conteúdo</p><h1>Construtor da Página Inicial</h1><p>Monte, revise e publique a home por snapshots atômicos, sem editar código.</p></div>
        <div className="homepage-header-actions">
          <button className="secondary-button" type="button" onClick={() => setPreview("page")}><Eye /> Visualizar como ficará na loja</button>
          {data?.capabilities["homepage.publish"] && <><button className="secondary-button" type="button" disabled={pending} onClick={() => void publish(true)}><FileClock /> Agendar</button><button className="primary-button" type="button" disabled={pending} onClick={() => void publish(false)}><ShieldCheck /> Publicar página</button></>}
          {data?.capabilities["homepage.create"] && <button className="primary-button" type="button" onClick={() => setEditor(emptyEditor(data.sections.length + 1))}><Plus /> Nova seção</button>}
        </div>
      </header>

      <nav className="homepage-tabs" aria-label="Áreas do construtor">
        <button className={tab === "builder" ? "active" : ""} onClick={() => setTab("builder")}><GripVertical /> Estrutura</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History /> Versões</button>
        {data?.capabilities["homepage.metrics.read"] && <button className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")}><BarChart3 /> Métricas</button>}
        {data?.capabilities["homepage.audit.read"] && <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><FileClock /> Auditoria</button>}
      </nav>

      {message && <p className="admin-feedback" role="status">{message}</p>}
      {error && <p className="admin-feedback error" role="alert">{error}</p>}

      {tab === "builder" && <>
        <div className="homepage-toolbar">
          <label><Search /><span className="sr-only">Buscar seção</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou título" /></label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>{sectionTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por status"><option value="">Todos os status</option>{["draft","pending_review","approved","scheduled","published","hidden","expired","archived","rejected"].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select>
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} aria-label="Filtrar por período"><option value="">Todos os períodos</option><option value="current">Em exibição</option><option value="future">Agendadas</option><option value="expired">Encerradas</option></select>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw /> Atualizar</button>
        </div>
        {loading ? <div className="homepage-skeleton" aria-label="Carregando seções">{[1,2,3].map((value) => <div key={value} />)}</div>
          : sections.length === 0 ? <div className="admin-empty-state"><ImagePlus /><h2>Nenhuma seção encontrada</h2><p>Crie uma seção ou ajuste os filtros.</p></div>
          : <div className="homepage-block-list" aria-label="Ordem da página inicial">
            <div className="homepage-tree-root"><strong>Página inicial</strong><span>{data?.sections.length ?? 0} seções</span></div>
            {sections.map((section) => {
              const globalIndex = data!.sections.findIndex((item) => item.id === section.id);
              return <article key={section.id} draggable={Boolean(data?.capabilities["homepage.edit"])} onDragStart={() => { dragId.current = section.id; }} onDragOver={(event) => event.preventDefault()} onDrop={() => void reorder(dragId.current, globalIndex)} className={`homepage-block status-${section.status}`}>
                <GripVertical className="homepage-drag" aria-hidden="true" />
                <div className="homepage-thumbnail" style={thumbnailStyle(section)}><span>{thumbnailStyle(section) ? "" : typeLabel(section.section_type).slice(0, 2).toUpperCase()}</span></div>
                <div className="homepage-block-copy"><small>Seção {globalIndex + 1} · {typeLabel(section.section_type)}</small><strong>{section.internal_name}</strong><span>{section.title || "Sem título visível"}</span><em>Atualizada em {dateLabel(section.updated_at)}</em></div>
                <div className="homepage-block-meta"><span className={`status ${["published","approved"].includes(section.status) ? "green" : section.status === "rejected" ? "red" : "gray"}`}>{section.status.replaceAll("_", " ")}</span><span>Posição {globalIndex + 1}</span><span>{section.visibility}</span><span>Responsável: {section.responsible_name}</span><span>{dateLabel(section.starts_at)} → {dateLabel(section.ends_at)}</span>{section.locked && <span><Lock /> Bloqueada</span>}</div>
                <div className="homepage-block-actions">
                  <button type="button" onClick={() => setPreview(sectionEditor(section))} aria-label={`Pré-visualizar ${section.internal_name}`}><Eye /></button>
                  {data?.capabilities["homepage.edit"] && <><button type="button" disabled={pending || globalIndex === 0} onClick={() => void reorder(section.id, globalIndex - 1)} aria-label="Subir"><ArrowUp /></button><button type="button" disabled={pending || globalIndex === data.sections.length - 1} onClick={() => void reorder(section.id, globalIndex + 1)} aria-label="Descer"><ArrowDown /></button><button type="button" disabled={pending} onClick={() => void reorder(section.id, 0)} aria-label="Enviar ao topo"><MoveUp /></button><button type="button" disabled={pending} onClick={() => void reorder(section.id, data.sections.length - 1)} aria-label="Enviar ao final"><MoveDown /></button><button type="button" onClick={() => setEditor(sectionEditor(section))} aria-label="Editar"><Pencil /></button><button type="button" disabled={pending} onClick={() => void act({ action: "duplicate", sectionId: section.id }, "Seção duplicada.")} aria-label="Duplicar"><Copy /></button></>}
                  {data?.capabilities["homepage.edit"] && <button type="button" disabled={pending} onClick={() => { const position = Number(window.prompt(`Nova posição entre 1 e ${data.sections.length}:`, String(globalIndex + 1))); if (Number.isInteger(position) && position >= 1 && position <= data.sections.length) void reorder(section.id, position - 1); }} aria-label="Definir posição numérica"><GripVertical /></button>}
                  {data?.capabilities["homepage.edit"] && ["draft","rejected"].includes(section.status) && <button type="button" onClick={() => void transition(section, "submit_review")} aria-label="Enviar para aprovação"><Send /></button>}
                  {data?.capabilities["homepage.review"] && section.status === "pending_review" && <><button type="button" onClick={() => void transition(section, "approve")} aria-label="Aprovar"><Check /></button><button type="button" onClick={() => void transition(section, "reject")} aria-label="Rejeitar"><X /></button></>}
                  {data?.capabilities["homepage.lock"] && <button type="button" onClick={() => void transition(section, section.locked ? "unlock" : "lock")} aria-label={section.locked ? "Desbloquear" : "Bloquear"}>{section.locked ? <Unlock /> : <Lock />}</button>}
                  {data?.capabilities["homepage.publish"] && !["archived","hidden"].includes(section.status) && <button type="button" onClick={() => void transition(section, "hide")} aria-label="Ocultar"><Archive /></button>}
                  {data?.capabilities["homepage.publish"] && <button type="button" onClick={() => { if (window.confirm("Arquivar esta seção? A versão publicada será preservada até a próxima publicação da página.")) void transition(section, "archive"); }} aria-label="Arquivar"><Trash2 /></button>}
                </div>
              </article>;
            })}
          </div>}
      </>}

      {tab === "history" && <HistoryView versions={data?.versions ?? []} pageVersions={data?.pageVersions ?? []} canRestore={Boolean(data?.capabilities["homepage.publish"])} pending={pending} onRestore={(version) => { const reason = window.prompt("Justificativa para restaurar esta versão como novo rascunho:")?.trim(); if (reason) void act({ action: "restore_version", versionId: version.id, reason }, "Versão restaurada como novo rascunho."); }} onCancel={(version) => { const reason = window.prompt("Justificativa do cancelamento:")?.trim(); if (reason) void act({ action: "cancel_publication", pageVersionId: version.id, reason }, "Agendamento cancelado."); }} />}
      {tab === "metrics" && <MetricsView metrics={data?.metrics ?? []} sections={data?.sections ?? []} />}
      {tab === "audit" && <AuditView entries={data?.audit ?? []} sections={data?.sections ?? []} />}

      {editor && <EditorModal editor={editor} canUpload={Boolean(data?.capabilities["homepage.media.manage"])} pending={pending} onClose={() => setEditor(null)} onPreview={setPreview} onSave={async (value) => { const ok = await act({ action: "save", expectedRevision: value.revision, payload: serializeEditor(value) }, "Rascunho salvo."); if (ok) setEditor(null); }} />}
      {preview && <PreviewModal preview={preview} sections={data?.sections ?? []} device={device} onDevice={setDevice} onClose={() => setPreview(null)} />}
    </section>
  );
}

function serializeEditor(editor: Editor) {
  return {
    ...(editor.id ? { id: editor.id } : {}), internalName: editor.internalName, sectionType: editor.sectionType,
    title: editor.title || undefined, subtitle: editor.subtitle || undefined, description: editor.description || undefined,
    layout: editor.layout, visibility: editor.visibility, style: editor.style, content: editor.content,
    startsAt: toIso(editor.startsAt), endsAt: toIso(editor.endsAt), sortOrder: editor.sortOrder,
    changeSummary: editor.changeSummary,
    items: editor.items.map((item, index) => ({ itemType: item.item_type, internalName: item.internal_name,
      title: item.title || undefined, subtitle: item.subtitle || undefined, description: item.description || undefined,
      altText: item.alt_text || undefined, decorative: item.decorative, targetType: item.target_type,
      targetId: item.target_id || undefined, targetRoute: item.target_route || undefined, sortOrder: index,
      config: item.config, media: item.media }))
  };
}

function EditorModal({ editor: initial, canUpload, pending, onClose, onPreview, onSave }: { editor: Editor; canUpload: boolean; pending: boolean; onClose: () => void; onPreview: (editor: Editor) => void; onSave: (editor: Editor) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const update = <K extends keyof Editor>(key: K, next: Editor[K]) => setValue((current) => ({ ...current, [key]: next }));
  const content = (key: string, next: unknown) => update("content", { ...value.content, [key]: next });
  const style = (key: string, next: unknown) => update("style", { ...value.style, [key]: next });
  const updateItem = (index: number, next: Partial<Item>) => update("items", value.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave(value); };
  const performanceWarning = value.items.reduce((count, item) => count + item.media.length, 0) > 8 || Number(value.content.limit ?? 0) > 16;
  return <div className="admin-modal-backdrop"><section className="admin-modal homepage-editor-modal" role="dialog" aria-modal="true" aria-labelledby="homepage-editor-title">
    <header><div><span>Rascunho versionado</span><h2 id="homepage-editor-title">{value.id ? "Editar seção" : "Nova seção"}</h2></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></header>
    <form onSubmit={submit}>
      <div className="homepage-editor-columns">
        <fieldset><legend>Identificação e conteúdo</legend>
          <label><span>Nome interno *</span><input required maxLength={120} value={value.internalName} onChange={(event) => update("internalName", event.target.value)} /></label>
          <label><span>Tipo *</span><select value={value.sectionType} onChange={(event) => update("sectionType", event.target.value)}>{sectionTypes.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label><span>Título visível</span><input maxLength={160} value={value.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label><span>Subtítulo</span><input maxLength={240} value={value.subtitle} onChange={(event) => update("subtitle", event.target.value)} /></label>
          <label><span>Descrição</span><textarea rows={3} maxLength={2000} value={value.description} onChange={(event) => update("description", event.target.value)} /></label>
          <label><span>Posição</span><input type="number" min={1} max={100} value={value.sortOrder} onChange={(event) => update("sortOrder", Number(event.target.value))} /></label>
          <label><span>Resumo da alteração *</span><input required minLength={3} maxLength={500} value={value.changeSummary} onChange={(event) => update("changeSummary", event.target.value)} /></label>
        </fieldset>
        <fieldset><legend>Layout e dispositivos</legend>
          <label><span>Estrutura</span><select value={value.layout} onChange={(event) => update("layout", event.target.value)}>{layouts.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label><span>Visibilidade</span><select value={value.visibility} onChange={(event) => update("visibility", event.target.value)}><option value="all">Todos</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Celular</option></select></label>
          <label><span>Origem do conteúdo</span><select value={configString(value.content, "source", "automatic")} onChange={(event) => content("source", event.target.value)}><option value="automatic">Automática, com dados reais</option><option value="manual">Seleção manual</option></select></label>
          <label><span>Quantidade de itens</span><input type="number" min={1} max={24} value={Number(value.content.limit ?? 8)} onChange={(event) => content("limit", Number(event.target.value))} /></label>
          <label><span>Colunas no desktop</span><select value={Number(value.content.columns ?? 4)} onChange={(event) => content("columns", Number(event.target.value))}>{[1,2,3,4].map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          <div className="homepage-switch-grid">{([["showPrice","Preço"],["showRating","Avaliação"],["showDiscount","Desconto"],["showInstallments","Parcelamento"],["showFavorite","Favorito"],["showPurchase","Compra"],["showStock","Estoque"],["showBadge","Selo"]] as const).map(([key,label]) => { const enabledByDefault = !["showInstallments", "showPurchase", "showStock"].includes(key); const checked = typeof value.content[key] === "boolean" ? value.content[key] === true : enabledByDefault; return <label className="admin-check" key={key}><input type="checkbox" checked={checked} onChange={(event) => content(key, event.target.checked)} /><span>{label}</span></label>; })}</div>
        </fieldset>
        <fieldset><legend>Agenda e visual</legend>
          <label><span>Início · America/Sao_Paulo</span><input type="datetime-local" value={value.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></label>
          <label><span>Fim · America/Sao_Paulo</span><input type="datetime-local" value={value.endsAt} onChange={(event) => update("endsAt", event.target.value)} /></label>
          <label><span>Espaço superior</span><select value={configString(value.style, "spacingTop", "medium")} onChange={(event) => style("spacingTop", event.target.value)}><option value="none">Nenhum</option><option value="small">Pequeno</option><option value="medium">Médio</option><option value="large">Grande</option></select></label>
          <label><span>Espaço inferior</span><select value={configString(value.style, "spacingBottom", "medium")} onChange={(event) => style("spacingBottom", event.target.value)}><option value="none">Nenhum</option><option value="small">Pequeno</option><option value="medium">Médio</option><option value="large">Grande</option></select></label>
          <label><span>Fundo autorizado</span><select value={configString(value.style, "background", "default")} onChange={(event) => style("background", event.target.value)}><option value="default">Padrão</option><option value="subtle">Suave</option><option value="brand">Vermelho curti Z</option><option value="dark">Escuro</option></select></label>
          <label><span>Tom do texto</span><select value={configString(value.style, "textTone", "dark")} onChange={(event) => style("textTone", event.target.value)}><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
        </fieldset>
      </div>
      <section className="homepage-items-editor"><header><div><h3>Itens, destinos e mídias</h3><p>Produtos e taxonomias são selecionados do cadastro real.</p></div><button className="secondary-button" type="button" disabled={value.items.length >= 24} onClick={() => update("items", [...value.items, emptyItem(value.items.length)])}><Plus /> Adicionar item</button></header>
        {value.items.length === 0 ? <div className="admin-empty-state compact"><p>Use conteúdo automático ou adicione itens manuais.</p></div> : value.items.map((item, index) => <ItemEditor key={item.id ?? index} item={item} index={index} canUpload={canUpload} onChange={(next) => updateItem(index, next)} onRemove={() => update("items", value.items.filter((_, itemIndex) => itemIndex !== index))} onMove={(direction) => { const target = index + direction; if (target < 0 || target >= value.items.length) return; const items = [...value.items]; [items[index], items[target]] = [items[target]!, items[index]!]; update("items", items); }} />)}
      </section>
      {performanceWarning && <p className="homepage-performance-warning" role="status">Esta seção possui muitos elementos e pode deixar a página mais lenta. Revise a quantidade antes de publicar.</p>}
      <footer><button className="secondary-button" type="button" onClick={() => onPreview(value)}><Eye /> Pré-visualizar</button><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" /> : <Save />} Salvar rascunho</button></footer>
    </form>
  </section></div>;
}

function ItemEditor({ item, index, canUpload, onChange, onRemove, onMove }: { item: Item; index: number; canUpload: boolean; onChange: (next: Partial<Item>) => void; onRemove: () => void; onMove: (direction: -1 | 1) => void }) {
  const [targetQuery, setTargetQuery] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (["none","brand","external_url","search","offer"].includes(item.target_type) || targetQuery.trim().length < 2) { setTargets([]); return; }
    const controller = new AbortController(); const timer = window.setTimeout(() => { void (async () => {
      setSearching(true); try { const response = await fetch(`/api/homepage-builder?mode=targets&type=${encodeURIComponent(item.target_type)}&q=${encodeURIComponent(targetQuery)}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json() as { targets?: Target[] }; setTargets(response.ok ? result.targets ?? [] : []); } finally { setSearching(false); }
    })();
    }, 300); return () => { controller.abort(); window.clearTimeout(timer); };
  }, [item.target_type, targetQuery]);
  const upload = async (file: File | undefined, role: "desktop" | "mobile" | "video") => {
    if (!file) return; setUploading(true);
    try { const form = new FormData(); form.set("file", file); form.set("role", role); const response = await fetch("/api/homepage-builder/media", { method: "POST", body: form }); const result = await response.json() as { path?: string; mimeType?: string; sizeBytes?: number; message?: string }; if (!response.ok || !result.path) throw new Error(result.message); const next = item.media.filter((entry) => entry.role !== role); next.push({ path: result.path, role, mimeType: result.mimeType ?? "", sizeBytes: result.sizeBytes ?? file.size }); onChange({ media: next }); } catch (error) { window.alert(error instanceof Error ? error.message : "Falha no upload."); } finally { setUploading(false); }
  };
  return <article className="homepage-item-editor"><header><strong>Item {index + 1}</strong><div><button type="button" onClick={() => onMove(-1)} aria-label="Subir item"><ChevronUp /></button><button type="button" onClick={() => onMove(1)} aria-label="Descer item"><ChevronDown /></button><button type="button" onClick={onRemove} aria-label="Remover item"><Trash2 /></button></div></header>
    <div className="admin-form-grid"><label><span>Nome interno *</span><input required value={item.internal_name} onChange={(event) => onChange({ internal_name: event.target.value })} /></label><label><span>Título</span><input value={item.title} onChange={(event) => onChange({ title: event.target.value })} /></label><label className="wide"><span>Descrição</span><textarea rows={2} value={item.description} onChange={(event) => onChange({ description: event.target.value })} /></label>
      <label><span>Destino</span><select value={item.target_type} onChange={(event) => onChange({ target_type: event.target.value, target_id: "", target_route: "" })}>{[["none","Nenhum"],["product","Produto"],["category","Categoria"],["subcategory","Subcategoria"],["model","Modelo"],["brand","Marca (quando cadastrada)"],["collection","Coleção"],["campaign","Campanha"],["page","Página"],["guide","Guia"],["search","Busca predefinida"],["offer","Oferta"],["external_url","URL externa autorizada"]].map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {["external_url","search","offer"].includes(item.target_type) ? <label><span>Destino seguro</span><input type={item.target_type === "external_url" ? "url" : "text"} value={item.target_route} placeholder={item.target_type === "external_url" ? "https://dominio-autorizado.com" : "/produtos?..."} onChange={(event) => onChange({ target_route: event.target.value })} /></label> : item.target_type !== "none" && <label className="homepage-target-search"><span>Pesquisar cadastro</span><input value={targetQuery} onChange={(event) => setTargetQuery(event.target.value)} placeholder="Digite ao menos 2 caracteres" />{searching && <LoaderCircle className="spin" />}{targets.length > 0 && <div role="listbox">{targets.map((target) => <button type="button" role="option" aria-selected={item.target_id === target.id} key={target.id} onClick={() => { onChange({ target_id: target.id, target_route: target.route, title: item.title || target.label }); setTargets([]); setTargetQuery(target.label); }}>{target.image && <span className="homepage-target-thumb" style={targetImage(target.image)} />}<span><strong>{target.label}</strong><small>{target.detail}</small></span></button>)}</div>}</label>}
      {canUpload && <div className="homepage-media-buttons wide">{(["desktop","mobile","video"] as const).map((role) => <label key={role}><span>{role === "desktop" ? "Imagem desktop" : role === "mobile" ? "Imagem mobile" : "Vídeo"}</span><span className="secondary-button homepage-file-button"><Upload /> {uploading ? "Enviando…" : item.media.some((entry) => entry.role === role) ? "Substituir" : "Enviar"}<input type="file" accept={role === "video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp"} disabled={uploading} onChange={(event) => void upload(event.target.files?.[0], role)} /></span></label>)}</div>}
      {item.media.length > 0 && <><label className="wide"><span>Mídias armazenadas</span><input readOnly value={item.media.map((entry) => `${entry.role}: ${entry.path}`).join(" · ")} /></label><label className="wide"><span>Texto alternativo {!item.decorative && "*"}</span><input required={!item.decorative} maxLength={300} value={item.alt_text} onChange={(event) => onChange({ alt_text: event.target.value })} /></label><label className="admin-check wide"><input type="checkbox" checked={item.decorative} onChange={(event) => onChange({ decorative: event.target.checked, alt_text: event.target.checked ? "" : item.alt_text })} /><span>Imagem decorativa</span></label></>}
    </div>
  </article>;
}

function PreviewModal({ preview, sections, device, onDevice, onClose }: { preview: Editor | "page"; sections: Section[]; device: "desktop" | "tablet" | "mobile"; onDevice: (device: "desktop" | "tablet" | "mobile") => void; onClose: () => void }) {
  const values = preview === "page" ? sections.map(sectionEditor) : [preview];
  return <div className="admin-modal-backdrop"><section className="admin-modal homepage-preview-modal" role="dialog" aria-modal="true" aria-labelledby="homepage-preview-title"><header><div><span>Pré-visualização · dados atuais</span><h2 id="homepage-preview-title">Como ficará na loja</h2></div><div className="homepage-device-buttons"><button className={device === "desktop" ? "active" : ""} onClick={() => onDevice("desktop")} aria-label="Desktop"><Monitor /></button><button className={device === "tablet" ? "active" : ""} onClick={() => onDevice("tablet")} aria-label="Tablet"><Tablet /></button><button className={device === "mobile" ? "active" : ""} onClick={() => onDevice("mobile")} aria-label="Celular"><Smartphone /></button><button onClick={onClose} aria-label="Fechar"><X /></button></div></header><div className={`homepage-preview-frame preview-${device}`}>{values.map((section, index) => <article key={section.id ?? index} className={`preview-layout-${section.layout}`}><small>{typeLabel(section.sectionType)} · rascunho</small>{section.title && <h2>{section.title}</h2>}{section.subtitle && <p>{section.subtitle}</p>}<div>{section.items.length ? section.items.map((item, itemIndex) => <span key={item.id ?? itemIndex}>{item.media.length ? <span className="preview-media">Mídia {itemIndex + 1}<small>{item.alt_text || "Decorativa"}</small></span> : <strong>{item.title || item.internal_name}</strong>}</span>) : <span className="preview-auto">Conteúdo automático será preenchido apenas com dados reais disponíveis.</span>}</div></article>)}</div></section></div>;
}

function HistoryView({ versions, pageVersions, canRestore, pending, onRestore, onCancel }: { versions: Version[]; pageVersions: PageVersion[]; canRestore: boolean; pending: boolean; onRestore: (version: Version) => void; onCancel: (version: PageVersion) => void }) {
  return <div className="homepage-history-grid"><section><h2>Versões da página</h2>{pageVersions.length ? pageVersions.map((version) => <article key={version.id}><strong>Publicação {version.version}</strong><span className="status gray">{version.status}</span><p>{version.reason}</p><small>{dateLabel(version.scheduled_at ?? version.published_at ?? version.created_at)}</small>{canRestore && version.status === "scheduled" && <button className="secondary-button" disabled={pending} onClick={() => onCancel(version)}><X /> Cancelar agendamento</button>}</article>) : <div className="admin-empty-state"><p>Nenhuma publicação versionada.</p></div>}</section><section><h2>Versões das seções</h2>{versions.length ? versions.map((version) => <article key={version.id}><strong>Versão {version.version}</strong><span className="status gray">{version.status}</span><p>{version.change_summary || "Alteração registrada"}</p><small>{dateLabel(version.created_at)}</small>{canRestore && <button className="secondary-button" disabled={pending} onClick={() => onRestore(version)}><RotateCcw /> Restaurar como rascunho</button>}</article>) : <div className="admin-empty-state"><p>Nenhuma versão encontrada.</p></div>}</section></div>;
}

function MetricsView({ metrics, sections }: { metrics: Metric[]; sections: Section[] }) {
  const totalViews = metrics.reduce((sum, row) => sum + Number(row.views), 0); const totalClicks = metrics.reduce((sum, row) => sum + Number(row.clicks), 0);
  const byVersion = new Map<string, { views: number; clicks: number }>(); metrics.forEach((row) => { const current = byVersion.get(row.section_version_id) ?? { views: 0, clicks: 0 }; current.views += Number(row.views); current.clicks += Number(row.clicks); byVersion.set(row.section_version_id, current); });
  return <section className="homepage-metrics"><div className="metric-grid"><article><span>Visualizações reais</span><strong>{totalViews.toLocaleString("pt-BR")}</strong></article><article><span>Cliques reais</span><strong>{totalClicks.toLocaleString("pt-BR")}</strong></article><article><span>CTR</span><strong>{totalViews ? `${((totalClicks / totalViews) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</strong></article></div>{metrics.length ? <div className="admin-table-wrap"><table><thead><tr><th>Seção</th><th>Visualizações</th><th>Cliques</th><th>CTR</th></tr></thead><tbody>{[...byVersion].map(([versionId, metric]) => { const section = sections.find((item) => item.current_version_id === versionId); return <tr key={versionId}><td>{section?.internal_name ?? `Versão ${versionId.slice(0, 8)}`}</td><td>{metric.views.toLocaleString("pt-BR")}</td><td>{metric.clicks.toLocaleString("pt-BR")}</td><td>{metric.views ? `${((metric.clicks / metric.views) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</td></tr>; })}</tbody></table></div> : <div className="admin-empty-state"><BarChart3 /><h2>Sem métricas registradas</h2><p>Os dados aparecerão após visualizações e cliques reais na versão publicada.</p></div>}</section>;
}

function AuditView({ entries, sections }: { entries: Audit[]; sections: Section[] }) {
  return entries.length ? <div className="admin-table-wrap"><table><thead><tr><th>Data</th><th>Ação</th><th>Seção</th><th>Perfil</th><th>Motivo</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{dateLabel(entry.created_at)}</td><td>{entry.action}</td><td>{sections.find((section) => section.id === entry.section_id)?.internal_name ?? "Página"}</td><td>{entry.actor_role ?? "Sistema"}</td><td>{entry.reason || "—"}</td></tr>)}</tbody></table></div> : <div className="admin-empty-state"><FileClock /><h2>Sem eventos de auditoria</h2><p>Alterações reais do construtor aparecerão aqui.</p></div>;
}
