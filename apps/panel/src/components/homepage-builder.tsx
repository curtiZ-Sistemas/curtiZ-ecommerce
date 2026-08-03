"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState
} from "react";

type HomepageSection = {
  id: string;
  section_type: string;
  title: string | null;
  subtitle: string | null;
  settings: Record<string, unknown>;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
};

type ApiResult = {
  items?: HomepageSection[];
  item?: HomepageSection;
  message?: string;
};

const sectionTypes = [
  ["banner_hero", "Banners principais"],
  ["featured_products", "Produtos em destaque"],
  ["categories_grid", "Categorias"],
  ["banner_promo", "Banner promocional"],
  ["reviews_carousel", "Avaliações"],
  ["brands_strip", "Marcas"],
  ["custom_banner", "Banner personalizado"]
] as const;

function inputDate(value: string | null): string {
  return value?.slice(0, 16) ?? "";
}

function getFormString(
  form: FormData,
  key: string,
  fallback = ""
): string {
  const value = form.get(key);

  return typeof value === "string"
    ? value
    : fallback;
}

function getFormNumber(
  form: FormData,
  key: string,
  fallback = 0
): number {
  const value = getFormString(
    form,
    key,
    String(fallback)
  );

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

export function HomepageBuilder() {
  const [sections, setSections] = useState<
    HomepageSection[]
  >([]);

  const [editing, setEditing] = useState<
    HomepageSection | "new" | null
  >(null);

  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/admin/resources/pagina-inicial?page=1",
        {
          cache: "no-store"
        }
      );

      const result =
        (await response.json()) as ApiResult;

      if (!response.ok) {
        throw new Error(
          result.message ||
            "Não foi possível carregar a página inicial."
        );
      }

      setSections(result.items ?? []);
    } catch {
      setMessage(
        "Não foi possível carregar a estrutura da página inicial."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (
    method: "POST" | "PATCH" | "DELETE",
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    if (pending) {
      return false;
    }

    setPending(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/admin/resources/pagina-inicial",
        {
          method,
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      const result =
        (await response.json()) as ApiResult;

      if (!response.ok) {
        throw new Error(
          result.message ||
            "Não foi possível atualizar a página inicial."
        );
      }

      setMessage(
        result.message ??
          "Página inicial atualizada."
      );

      await load();

      return true;
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível salvar."
      );

      return false;
    } finally {
      setPending(false);
    }
  };

  const save = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();

    if (!editing) {
      return;
    }

    const form = new FormData(
      event.currentTarget
    );

    const settingsText = getFormString(
      form,
      "settings",
      "{}"
    );

    let settings: Record<string, unknown>;

    try {
      const parsed: unknown =
        JSON.parse(settingsText);

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        setMessage(
          "A configuração JSON precisa ser um objeto."
        );

        return;
      }

      settings =
        parsed as Record<string, unknown>;
    } catch {
      setMessage(
        "A configuração JSON não é válida."
      );

      return;
    }

    const sectionType = getFormString(
      form,
      "section_type"
    ).trim();

    if (!sectionType) {
      setMessage(
        "Selecione o tipo da seção."
      );

      return;
    }

    const values = {
      section_type: sectionType,
      title: getFormString(
        form,
        "title"
      ).trim(),
      subtitle: getFormString(
        form,
        "subtitle"
      ).trim(),
      settings,
      active:
        form.get("active") === "on",
      starts_at: getFormString(
        form,
        "starts_at"
      ),
      ends_at: getFormString(
        form,
        "ends_at"
      ),
      sort_order: getFormNumber(
        form,
        "sort_order",
        0
      )
    };

    const success = await mutate(
      editing === "new"
        ? "POST"
        : "PATCH",
      {
        ...(editing === "new"
          ? {}
          : {
              id: editing.id
            }),
        values
      }
    );

    if (success) {
      setEditing(null);
    }
  };

  const reorder = async (
    index: number,
    direction: -1 | 1
  ): Promise<void> => {
    const target = sections[index];
    const other =
      sections[index + direction];

    if (!target || !other) {
      return;
    }

    const first = await mutate(
      "PATCH",
      {
        id: target.id,
        values: {
          ...target,
          sort_order: other.sort_order
        }
      }
    );

    if (!first) {
      return;
    }

    await mutate(
      "PATCH",
      {
        id: other.id,
        values: {
          ...other,
          sort_order: target.sort_order
        }
      }
    );
  };

  const duplicate = async (
    section: HomepageSection
  ): Promise<void> => {
    await mutate(
      "POST",
      {
        values: {
          ...section,
          title: `${
            section.title ?? "Seção"
          } — cópia`,
          sort_order: sections.length + 1
        }
      }
    );
  };

  return (
    <section className="panel-card homepage-builder">
      <header className="admin-resource-header">
        <div>
          <h2>
            Construtor da página inicial
          </h2>

          <p>
            Organize seções reais,
            agendamento e visibilidade.
            Cada alteração mantém uma
            versão anterior.
          </p>
        </div>

        <div className="admin-header-actions">
          <a
            className="secondary-button"
            href={
              process.env
                .NEXT_PUBLIC_STORE_URL ??
              "http://localhost:3000"
            }
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink
              aria-hidden="true"
            />
            Visualizar loja
          </a>

          <button
            className="primary-button"
            type="button"
            onClick={() =>
              setEditing("new")
            }
          >
            <Plus aria-hidden="true" />
            Nova seção
          </button>
        </div>
      </header>

      {message ? (
        <p
          className="admin-feedback"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="admin-loading">
          <LoaderCircle className="spin" />
          Carregando estrutura
        </div>
      ) : sections.length === 0 ? (
        <div className="admin-empty-state">
          <h3>
            A página inicial ainda não
            possui seções
          </h3>

          <p>
            Crie a primeira seção para
            começar a composição.
          </p>
        </div>
      ) : (
        <div className="homepage-section-list">
          {sections.map(
            (section, index) => (
              <article
                key={section.id}
                className={
                  section.active
                    ? ""
                    : "inactive"
                }
              >
                <span className="homepage-order">
                  {index + 1}
                </span>

                <div>
                  <strong>
                    {section.title ||
                      "Seção sem título"}
                  </strong>

                  <small>
                    {sectionTypes.find(
                      ([type]) =>
                        type ===
                        section.section_type
                    )?.[1] ??
                      section.section_type}
                  </small>
                </div>

                <span
                  className={
                    section.active
                      ? "status green"
                      : "status gray"
                  }
                >
                  {section.active
                    ? "Ativa"
                    : "Oculta"}
                </span>

                <div className="homepage-actions">
                  <button
                    type="button"
                    disabled={
                      index === 0 ||
                      pending
                    }
                    onClick={() =>
                      void reorder(index, -1)
                    }
                    aria-label="Subir seção"
                  >
                    <ArrowUp />
                  </button>

                  <button
                    type="button"
                    disabled={
                      index ===
                        sections.length - 1 ||
                      pending
                    }
                    onClick={() =>
                      void reorder(index, 1)
                    }
                    aria-label="Descer seção"
                  >
                    <ArrowDown />
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void mutate(
                        "PATCH",
                        {
                          id: section.id,
                          values: {
                            ...section,
                            active:
                              !section.active
                          }
                        }
                      )
                    }
                    aria-label={
                      section.active
                        ? "Ocultar seção"
                        : "Exibir seção"
                    }
                  >
                    <Eye />
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void duplicate(section)
                    }
                    aria-label="Duplicar seção"
                  >
                    <Copy />
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      setEditing(section)
                    }
                    aria-label="Editar seção"
                  >
                    <Pencil />
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void mutate(
                        "DELETE",
                        {
                          id: section.id
                        }
                      )
                    }
                    aria-label="Arquivar seção"
                  >
                    <Trash2 />
                  </button>
                </div>
              </article>
            )
          )}
        </div>
      )}

      {editing ? (
        <div className="admin-modal-backdrop">
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="homepage-form-title"
          >
            <header>
              <div>
                <span>
                  {editing === "new"
                    ? "Nova seção"
                    : "Configuração"}
                </span>

                <h2 id="homepage-form-title">
                  Página inicial
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setEditing(null)
                }
                aria-label="Fechar"
              >
                <X />
              </button>
            </header>

            <form
              onSubmit={(event) =>
                void save(event)
              }
            >
              <div className="admin-form-grid">
                <label>
                  <span>Tipo *</span>

                  <select
                    name="section_type"
                    defaultValue={
                      editing === "new"
                        ? ""
                        : editing.section_type
                    }
                    required
                  >
                    <option value="">
                      Selecione
                    </option>

                    {sectionTypes.map(
                      ([value, label]) => (
                        <option
                          key={value}
                          value={value}
                        >
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label>
                  <span>Ordem</span>

                  <input
                    name="sort_order"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={
                      editing === "new"
                        ? sections.length + 1
                        : editing.sort_order
                    }
                  />
                </label>

                <label className="wide">
                  <span>Título</span>

                  <input
                    name="title"
                    defaultValue={
                      editing === "new"
                        ? ""
                        : editing.title ?? ""
                    }
                  />
                </label>

                <label className="wide">
                  <span>Subtítulo</span>

                  <textarea
                    name="subtitle"
                    rows={3}
                    defaultValue={
                      editing === "new"
                        ? ""
                        : editing.subtitle ?? ""
                    }
                  />
                </label>

                <label>
                  <span>Início</span>

                  <input
                    name="starts_at"
                    type="datetime-local"
                    defaultValue={
                      editing === "new"
                        ? ""
                        : inputDate(
                            editing.starts_at
                          )
                    }
                  />
                </label>

                <label>
                  <span>Término</span>

                  <input
                    name="ends_at"
                    type="datetime-local"
                    defaultValue={
                      editing === "new"
                        ? ""
                        : inputDate(
                            editing.ends_at
                          )
                    }
                  />
                </label>

                <label className="wide">
                  <span>
                    Configuração (JSON)
                  </span>

                  <textarea
                    name="settings"
                    rows={7}
                    defaultValue={
                      editing === "new"
                        ? "{}"
                        : JSON.stringify(
                            editing.settings,
                            null,
                            2
                          )
                    }
                  />
                </label>

                <label className="admin-checkbox">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={
                      editing === "new" ||
                      editing.active
                    }
                  />

                  <span>Seção ativa</span>
                </label>
              </div>

              <footer>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    setEditing(null)
                  }
                  disabled={pending}
                >
                  Cancelar
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={pending}
                >
                  {pending ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Save />
                  )}

                  Salvar
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}