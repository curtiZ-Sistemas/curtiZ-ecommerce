"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { publicCatalogMediaUrl } from "@/lib/public-media";
import { normalizeBannerValues } from "@/lib/banner-management";

type Row = Record<string, unknown>;
type Destination = { type: string; id: string; route: string; label: string };
type Target = Destination & { detail: string };
type Device = { path: string; file?: File; destination: Destination };
const none: Destination = { type: "none", id: "", route: "/", label: "Nenhum destino" };
const string = (row: Row, key: string) => (typeof row[key] === "string" ? row[key] : "");
const record = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const mediaUrl = (path: string) =>
  publicCatalogMediaUrl(path, {
    storeUrl: process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
  });
const endpoint = "/api/admin/resources/banners";

async function request(url: string, init?: RequestInit): Promise<Row> {
  const response = await fetch(url, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !record(data))
    throw new Error(
      record(data) && typeof data.message === "string"
        ? data.message
        : "Não foi possível concluir a operação. Tente novamente."
    );
  return data;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

function destinationFor(row: Row, mobile = false): Destination {
  const suffix = mobile && typeof row.destination_type_mobile === "string" ? "_mobile" : "";
  const type = string(row, `destination_type${suffix}`) || "none";
  const route = string(row, `destination_url${suffix}`) || "/";
  return {
    type,
    id: string(row, `destination_id${suffix}`),
    route,
    label: type === "none" ? "Nenhum destino" : route
  };
}

export function BannerManager() {
  const [items, setItems] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editable, setEditable] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await request(`${endpoint}?page=${page}`, { cache: "no-store" });
      setItems(Array.isArray(result.items) ? result.items.filter(record) : []);
      setTotal(typeof result.total === "number" ? result.total : 0);
      setEditable(record(result.capabilities) && result.capabilities.update === true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os banners.");
    } finally {
      setLoading(false);
    }
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (row: Row) => {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const active = ["published", "scheduled"].includes(string(row, "status"));
      await request(
        endpoint,
        json("PATCH", { action: active ? "archive" : "restore", ids: [row.id] })
      );
      setMessage(active ? "Banner desativado." : "Banner ativado.");
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível alterar o banner.");
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="banner-manager">
      <header className="banner-manager-heading">
        <div>
          <h1>Banners</h1>
          <p>Imagens e destinos para computador e celular.</p>
        </div>
        {editable && (
          <button className="primary-button" onClick={() => setEditing({})}>
            <Plus size={18} /> Novo banner
          </button>
        )}
      </header>
      {message && <p role="status">{message}</p>}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : loading ? (
        <p role="status">Carregando banners…</p>
      ) : !items.length ? (
        <div className="admin-empty-state">
          <h2>Nenhum banner cadastrado</h2>
          <p>Adicione as imagens e escolha para onde cada uma leva.</p>
        </div>
      ) : (
        <div className="banner-table-wrap">
          <table className="banner-table">
            <thead>
              <tr>
                <th>Banner</th>
                <th>Destino desktop</th>
                <th>Destino mobile</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={string(row, "id")}>
                  <td>
                    <img
                      src={mediaUrl(
                        string(row, "image_path_desktop") || string(row, "image_path_mobile")
                      )}
                      alt="Miniatura do banner"
                      width={160}
                      height={64}
                    />
                    <small>
                      {(
                        {
                          published: "Ativo",
                          scheduled: "Agendado",
                          inactive: "Inativo",
                          draft: "Rascunho",
                          expired: "Expirado",
                          archived: "Arquivado"
                        } as Record<string, string>
                      )[string(row, "status")] ?? string(row, "status")}
                    </small>
                  </td>
                  <td>{destinationFor(row).label}</td>
                  <td>{destinationFor(row, true).label}</td>
                  <td>
                    <div className="banner-actions">
                      <button
                        className="secondary-button"
                        disabled={!editable || pending}
                        onClick={() => setEditing(row)}
                        aria-label="Editar banner"
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!editable || pending}
                        onClick={() => setDeleting(row)}
                        aria-label="Excluir banner"
                      >
                        <Trash2 size={17} />
                      </button>
                      <button
                        className="secondary-button"
                        role="switch"
                        aria-label="Banner ativo"
                        aria-checked={["published", "scheduled"].includes(string(row, "status"))}
                        disabled={!editable || pending}
                        onClick={() => void toggle(row)}
                      >
                        {["published", "scheduled"].includes(string(row, "status"))
                          ? "Desativar"
                          : "Ativar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 20 && (
        <footer className="admin-pagination">
          <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span>
            Página {page} de {Math.ceil(total / 20)}
          </span>
          <button disabled={page * 20 >= total || loading} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </footer>
      )}
      {editing && (
        <BannerEditor
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setMessage("Banner salvo com sucesso.");
            await load();
          }}
        />
      )}
      {deleting && (
        <BannerDelete
          row={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            setMessage("Banner excluído.");
            if (items.length === 1 && page > 1) setPage(page - 1);
            else await load();
          }}
        />
      )}
    </section>
  );
}

function useDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.showModal();
    return () => {
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return ref;
}

function BannerDelete({
  row,
  onClose,
  onDeleted
}: {
  row: Row;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const dialog = useDialog();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    setPending(true);
    try {
      await request(endpoint, json("DELETE", { id: row.id, permanent: true }));
      await onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível excluir.");
      setPending(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="admin-confirm banner-dialog"
      aria-labelledby="banner-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <h2 id="banner-delete-title">Excluir banner?</h2>
      <p>O banner será removido da loja. Esta ação não pode ser desfeita.</p>
      {error && <p role="alert">{error}</p>}
      <div>
        <button className="secondary-button" disabled={pending} onClick={onClose}>
          Cancelar
        </button>
        <button className="primary-button" disabled={pending} onClick={() => void remove()}>
          {pending ? "Excluindo…" : "Excluir banner"}
        </button>
      </div>
    </dialog>
  );
}

function BannerEditor({
  row,
  onClose,
  onSaved
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useDialog();
  const uploadedPaths = useRef(new Set<string>());
  const retainedPaths = useRef(new Set<string>());
  useEffect(() => {
    const uploaded = uploadedPaths.current;
    const retained = retainedPaths.current;
    return () => {
      for (const path of uploaded) {
        if (retained.has(path)) continue;
        void request("/api/admin/banner-media", {
          ...json("DELETE", { path }),
          keepalive: true
        }).catch(() => {
          console.warn("[banner-editor] temporary upload cleanup could not be confirmed");
        });
      }
    };
  }, []);
  const [devices, setDevices] = useState<Record<"desktop" | "mobile", Device>>(() => ({
    desktop: {
      path: string(row, "image_path_desktop") || string(row, "image_path_mobile"),
      destination: destinationFor(row)
    },
    mobile: {
      path: string(row, "image_path_mobile") || string(row, "image_path_desktop"),
      destination: destinationFor(row, true)
    }
  }));
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const draft: Row = {};
    for (const device of ["desktop", "mobile"] as const) {
      if (!devices[device].path && !devices[device].file) {
        setError(`Selecione a imagem para ${device === "desktop" ? "computador" : "celular"}.`);
        return;
      }
      const current = devices[device];
      const suffix = device === "desktop" ? "" : "_mobile";
      draft[`image_path_${device}`] = current.file ? "pending.webp" : current.path;
      draft[`destination_type${suffix}`] = current.destination.type;
      draft[`destination_id${suffix}`] = current.destination.id || null;
      draft[`destination_url${suffix}`] = current.destination.route;
    }
    try {
      normalizeBannerValues(draft, !row.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Revise os destinos selecionados.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const values: Row = {};
      for (const device of ["desktop", "mobile"] as const) {
        const current = devices[device];
        let path = current.path;
        if (current.file) {
          const label = device === "desktop" ? "computador" : "celular";
          setProgress(`Enviando imagem para ${label}…`);
          const form = new FormData();
          form.set("file", current.file);
          form.set("device", device);
          try {
            const result = await request("/api/admin/banner-media", { method: "POST", body: form });
            path = string(result, "path");
            if (!path) throw new Error("O armazenamento não confirmou o arquivo.");
            uploadedPaths.current.add(path);
          } catch (reason) {
            throw new Error(
              `Não foi possível enviar a imagem para ${label}. ${reason instanceof Error ? reason.message : "Tente novamente."}`
            );
          }
          setDevices((previous) => ({
            ...previous,
            [device]: { path, destination: current.destination }
          }));
        }
        values[`image_path_${device}`] = path;
        const suffix = device === "desktop" ? "" : "_mobile";
        values[`destination_type${suffix}`] = current.destination.type;
        values[`destination_id${suffix}`] = current.destination.id || null;
        values[`destination_url${suffix}`] = current.destination.route;
      }
      setProgress("Salvando banner…");
      const result = await request(
        endpoint,
        json(row.id ? "PATCH" : "POST", { id: row.id, values })
      );
      if (!record(result.item) || typeof result.item.id !== "string")
        throw new Error(
          "O servidor não confirmou o salvamento. Atualize a listagem antes de tentar novamente."
        );
      retainedPaths.current.add(String(values.image_path_desktop));
      retainedPaths.current.add(String(values.image_path_mobile));
      await onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível salvar o banner. Tente novamente."
      );
    } finally {
      setPending(false);
      setProgress("");
    }
  };
  return (
    <dialog
      ref={dialog}
      className="admin-modal banner-dialog banner-editor"
      aria-labelledby="banner-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header>
        <h2 id="banner-editor-title">{row.id ? "Editar banner" : "Novo banner"}</h2>
        <button disabled={pending} onClick={onClose} aria-label="Fechar">
          <X />
        </button>
      </header>
      <form onSubmit={(event) => void save(event)}>
        <fieldset className="banner-editor-fields" disabled={pending}>
          {(["desktop", "mobile"] as const).map((device) => (
            <BannerDevice
              key={device}
              device={device}
              value={devices[device]}
              onChange={(value) => setDevices((previous) => ({ ...previous, [device]: value }))}
            />
          ))}
        </fieldset>
        {progress && (
          <p role="status">
            <LoaderCircle className="spin" size={16} /> {progress}
          </p>
        )}
        {error && (
          <p className="banner-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="secondary-button" type="button" disabled={pending} onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" disabled={pending}>
            {pending ? "Salvando…" : row.id ? "Salvar alterações" : "Salvar banner"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function BannerDevice({
  device,
  value,
  onChange
}: {
  device: "desktop" | "mobile";
  value: Device;
  onChange: (value: Device) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const selectFile = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024 ||
      file.size === 0
    ) {
      setError("Selecione JPG, PNG ou WebP de até 10 MB.");
      return;
    }
    setError("");
    onChange({ ...value, file });
  };
  useEffect(() => {
    const url = value.file ? URL.createObjectURL(value.file) : "";
    setPreview(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [value.file]);
  const label = device === "desktop" ? "computador" : "celular";
  const src = preview || mediaUrl(value.path);
  return (
    <section className="banner-device" aria-label={`Imagem ${label}`}>
      <h3>Imagem {label}</h3>
      <div
        className={`banner-drop-zone${dragging ? " dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (input.current?.matches(":disabled")) return;
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (input.current?.matches(":disabled")) return;
          if (event.dataTransfer.files.length !== 1) {
            setError("Arraste uma imagem por vez para este bloco.");
            return;
          }
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        {src ? (
          <img
            className="banner-preview"
            src={src}
            alt={`Prévia da imagem para ${label}`}
            draggable={false}
          />
        ) : (
          <div className="banner-preview banner-image-placeholder">Arraste uma imagem aqui</div>
        )}
      </div>
      <div className="banner-actions">
        <button type="button" className="secondary-button" onClick={() => input.current?.click()}>
          {value.path || value.file ? "Substituir imagem" : "Selecionar imagem"}
        </button>
        {(value.path || value.file) && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onChange({ path: "", destination: value.destination });
              setError("");
            }}
          >
            Remover
          </button>
        )}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Selecionar imagem para ${label}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          selectFile(file);
        }}
      />
      <small>JPG, PNG ou WebP, até 10 MB.</small>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      <BannerDestination
        value={value.destination}
        device={device}
        onChange={(destination) => onChange({ ...value, destination })}
      />
    </section>
  );
}

function BannerDestination({
  value,
  device,
  onChange
}: {
  value: Destination;
  device: string;
  onChange: (value: Destination) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void request(`/api/admin/banner-targets?type=all&q=${encodeURIComponent(query)}`, {
        signal: controller.signal
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setTargets(
            Array.isArray(result.targets)
              ? result.targets.filter(record).flatMap((target) =>
                  typeof target.id === "string" &&
                  typeof target.type === "string" &&
                  typeof target.route === "string" &&
                  typeof target.label === "string"
                    ? [
                        {
                          id: target.id,
                          type: target.type,
                          route: target.route,
                          label: target.label,
                          detail: string(target, "detail")
                        }
                      ]
                    : []
                )
              : []
          );
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error ? reason.message : "Não foi possível carregar os destinos."
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [expanded, query, retry]);
  return (
    <div className="banner-destination">
      <span id={`destination-${device}`}>Ao clicar, levar para</span>
      <button
        className="secondary-button banner-destination-choice"
        type="button"
        aria-labelledby={`destination-${device} selected-${device}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span id={`selected-${device}`}>{value.label}</span>
      </button>
      {expanded && (
        <div className="banner-destination-options">
          <input
            aria-label={`Pesquisar destino ${device}`}
            placeholder="Pesquisar produto, categoria ou página"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              onChange(none);
              setExpanded(false);
            }}
          >
            Nenhum destino
          </button>
          {loading ? (
            <p role="status">Buscando…</p>
          ) : error ? (
            <div role="alert">
              {error}
              <button type="button" onClick={() => setRetry(retry + 1)}>
                Tentar novamente
              </button>
            </div>
          ) : (
            <div className="banner-target-results">
              {!targets.length && <p>Nenhum destino encontrado.</p>}
              {targets.map((target) => (
                <button
                  type="button"
                  key={`${target.type}-${target.id}`}
                  onClick={() => {
                    onChange(target);
                    setExpanded(false);
                  }}
                >
                  {target.label}
                  <small>{target.detail}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
