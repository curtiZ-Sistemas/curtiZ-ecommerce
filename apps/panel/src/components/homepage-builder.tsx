"use client";

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Save,
  Check,
  LayoutGrid,
  Image as ImageIcon,
  Sparkles,
  Star
} from "lucide-react";
import { useState } from "react";

export type SectionType =
  | "banner_hero"
  | "featured_products"
  | "categories_grid"
  | "banner_promo"
  | "reviews_carousel"
  | "brands_strip"
  | "custom_banner";

export type HomepageSectionItem = {
  id: string;
  sectionType: SectionType;
  title: string;
  subtitle: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  settings: Record<string, string | number | boolean>;
};

const initialSections: HomepageSectionItem[] = [
  {
    id: "sec-1",
    sectionType: "banner_hero",
    title: "Banners Principais (Hero Carousel)",
    subtitle: "Carrossel topo de linha em alta resolução",
    active: true,
    startsAt: "",
    endsAt: "",
    sortOrder: 1,
    settings: {
      autoPlay: true,
      intervalSeconds: 5
    }
  },
  {
    id: "sec-2",
    sectionType: "featured_products",
    title: "Lançamentos e Mais Vendidos",
    subtitle: "Seleção especial de sandálias e slides",
    active: true,
    startsAt: "",
    endsAt: "",
    sortOrder: 2,
    settings: {
      limit: 8,
      layout: "grid_4"
    }
  },
  {
    id: "sec-3",
    sectionType: "categories_grid",
    title: "Navegue por Categoria",
    subtitle: "Masculino, Feminino, Infantil e Edições Especiais",
    active: true,
    startsAt: "",
    endsAt: "",
    sortOrder: 3,
    settings: {
      columns: 4
    }
  },
  {
    id: "sec-4",
    sectionType: "banner_promo",
    title: "Banner Promocional de Verão",
    subtitle: "Descontos de até 30% em modelos selecionados",
    active: true,
    startsAt: "",
    endsAt: "",
    sortOrder: 4,
    settings: {
      ctaText: "Aproveitar Ofertas",
      ctaLink: "/categoria/promocoes"
    }
  },
  {
    id: "sec-5",
    sectionType: "reviews_carousel",
    title: "O que Nossos Clientes Dizem",
    subtitle: "Avaliações reais verificadas pós-compra",
    active: true,
    startsAt: "",
    endsAt: "",
    sortOrder: 5,
    settings: {
      minRating: 4
    }
  }
];

const sectionTypeLabels: Record<SectionType, { label: string; icon: React.ElementType }> = {
  banner_hero: { label: "Hero Banner Carousel", icon: ImageIcon },
  featured_products: { label: "Grid de Produtos em Destaque", icon: LayoutGrid },
  categories_grid: { label: "Grid de Categorias", icon: LayoutGrid },
  banner_promo: { label: "Fita/Banner Promocional", icon: Sparkles },
  reviews_carousel: { label: "Carrossel de Avaliações", icon: Star },
  brands_strip: { label: "Faixa Institucional/Marcas", icon: Sparkles },
  custom_banner: { label: "Banner Personalizado", icon: ImageIcon }
};

export function HomepageBuilder() {
  const [sections, setSections] = useState<HomepageSectionItem[]>(initialSections);
  const [editingSection, setEditingSection] = useState<HomepageSectionItem | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...sections];
    const previous = updated[index - 1];
    const current = updated[index];
    if (!previous || !current) return;
    updated[index - 1] = current;
    updated[index] = previous;
    updated.forEach((sec, idx) => (sec.sortOrder = idx + 1));
    setSections(updated);
  };

  const moveDown = (index: number) => {
    if (index === sections.length - 1) return;
    const updated = [...sections];
    const current = updated[index];
    const next = updated[index + 1];
    if (!current || !next) return;
    updated[index + 1] = current;
    updated[index] = next;
    updated.forEach((sec, idx) => (sec.sortOrder = idx + 1));
    setSections(updated);
  };

  const toggleActive = (id: string) => {
    setSections((prev) =>
      prev.map((sec) => (sec.id === id ? { ...sec, active: !sec.active } : sec))
    );
  };

  const duplicateSection = (sec: HomepageSectionItem) => {
    const newSec: HomepageSectionItem = {
      ...sec,
      id: `sec-${Date.now()}`,
      title: `${sec.title} (Cópia)`,
      sortOrder: sections.length + 1
    };
    setSections([...sections, newSec]);
  };

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((sec) => sec.id !== id));
  };

  const addNewSection = (type: SectionType) => {
    const typeInfo = sectionTypeLabels[type];
    const newSec: HomepageSectionItem = {
      id: `sec-${Date.now()}`,
      sectionType: type,
      title: `Nova Seção — ${typeInfo.label}`,
      subtitle: "Subtítulo editável da seção",
      active: true,
      startsAt: "",
      endsAt: "",
      sortOrder: sections.length + 1,
      settings: {}
    };
    setSections([...sections, newSec]);
    setEditingSection(newSec);
  };

  const saveChanges = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="homepage-builder">
      <div className="page-heading">
        <div>
          <h1>Construtor da Página Inicial</h1>
          <p>
            Crie, reordene, agende e personalize cada seção da loja em tempo real sem alterar código.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="primary-button" type="button" onClick={saveChanges}>
            {savedSuccess ? <Check size={18} /> : <Save size={18} />}
            {savedSuccess ? "Alterações Salvas!" : "Salvar Configuração"}
          </button>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel-card" style={{ gridColumn: "span 2" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem"
            }}
          >
            <h2>Estrutura Atual da Página Inicial ({sections.length} Seções)</h2>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <select
                aria-label="Adicionar tipo de seção"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    addNewSection(e.target.value as SectionType);
                    e.target.value = "";
                  }
                }}
                style={{ padding: "0.4rem 0.8rem", borderRadius: "6px", fontSize: "0.875rem" }}
              >
                <option value="" disabled>
                  + Adicionar Nova Seção...
                </option>
                {Object.entries(sectionTypeLabels).map(([type, { label }]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {sections.map((sec, idx) => {
              const Icon = sectionTypeLabels[sec.sectionType]?.icon || LayoutGrid;
              return (
                <div
                  key={sec.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "1rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border, #e5e7eb)",
                    background: sec.active ? "var(--surface, #ffffff)" : "var(--surface-muted, #f9fafb)",
                    opacity: sec.active ? 1 : 0.65
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <div
                      style={{
                        padding: "0.5rem",
                        borderRadius: "6px",
                        background: "var(--primary-subtle, #eff6ff)",
                        color: "var(--primary, #2563eb)"
                      }}
                    >
                      <Icon size={20} />
                    </div>
                    <div>
                      <strong style={{ display: "block", fontSize: "0.95rem" }}>
                        {idx + 1}. {sec.title}
                      </strong>
                      <small style={{ color: "var(--muted, #6b7280)" }}>
                        {sectionTypeLabels[sec.sectionType]?.label} • {sec.subtitle || "Sem subtítulo"}
                      </small>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      title="Subir ordem"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => moveDown(idx)}
                      disabled={idx === sections.length - 1}
                      title="Descer ordem"
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => toggleActive(sec.id)}
                      title={sec.active ? "Ocultar seção" : "Exibir seção"}
                    >
                      {sec.active ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => duplicateSection(sec)}
                      title="Duplicar seção"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditingSection(sec)}
                      title="Editar configurações"
                    >
                      Configurar
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ color: "#dc2626" }}
                      onClick={() => removeSection(sec.id)}
                      title="Remover seção"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {editingSection && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "1rem"
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "1.5rem",
              width: "100%",
              maxWidth: "540px",
              display: "flex",
              flexDirection: "column",
              gap: "1rem"
            }}
          >
            <h3>Editar Seção: {editingSection.title}</h3>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                Título Principal
              </label>
              <input
                type="text"
                value={editingSection.title}
                onChange={(e) =>
                  setEditingSection({ ...editingSection, title: e.target.value })
                }
                style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                Subtítulo / Descrição
              </label>
              <input
                type="text"
                value={editingSection.subtitle}
                onChange={(e) =>
                  setEditingSection({ ...editingSection, subtitle: e.target.value })
                }
                style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
              />
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Agendar Início
                </label>
                <input
                  type="datetime-local"
                  value={editingSection.startsAt}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, startsAt: e.target.value })
                  }
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Agendar Término
                </label>
                <input
                  type="datetime-local"
                  value={editingSection.endsAt}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, endsAt: e.target.value })
                  }
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditingSection(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setSections((prev) =>
                    prev.map((sec) => (sec.id === editingSection.id ? editingSection : sec))
                  );
                  setEditingSection(null);
                }}
              >
                Salvar Seção
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
