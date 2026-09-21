"use client";

import { AlertTriangle, CircleX, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { PanelDrawer } from "@/components/panel-drawer";
import { runProductImportBatches, runProductImportQueue, type ProductImportQueueResult } from "@/lib/product-import-client";

type PreviewProduct = {
  key: string;
  name: string;
  category: string;
  variations: number;
  images: number;
  warnings: string[];
  errors: string[];
  alreadyImported: boolean;
};

type ImportPreview = {
  schemaVersion: string;
  summary: { products: number; variations: number; images: number; colors: number; warnings: number; errors: number };
  products: PreviewProduct[];
  issues: Array<{ level: "warning" | "error"; message: string }>;
};

function ImportIssueList({ level, items }: { level: "warning" | "error"; items: string[] }) {
  if (!items.length) return null;
  const Icon = level === "error" ? CircleX : AlertTriangle;
  return <section className={`product-import-issues is-${level}`} aria-label={level === "error" ? "Erros do produto" : "Avisos do produto"}>
    <strong><Icon aria-hidden="true" /> {items.length} {level === "error" ? items.length === 1 ? "erro" : "erros" : items.length === 1 ? "aviso" : "avisos"}</strong>
    <ul>{items.map((item, index) => <li key={`${level}-${index}`}>{item}</li>)}</ul>
  </section>;
}

export function ProductImportDrawer({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ProductImportQueueResult[]>([]);
  const [message, setMessage] = useState("");

  const readJson = async (response: Response) => {
    const body = await response.text();
    try {
      const value: unknown = JSON.parse(body);
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch {
      return { message: response.ok ? "O servidor retornou uma resposta inválida." : `Serviço temporariamente indisponível (HTTP ${response.status}).` };
    }
  };

  const selectFile = async (selected: File) => {
    setFile(selected);
    setPreview(null);
    setResults([]);
    setMessage("");
    setProgress(0);
    if (!selected.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
      setMessage("Selecione uma planilha no formato XLSX.");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.set("file", selected);
      const response = await fetch("/api/catalog/products/import/preview", { method: "POST", body: form });
      const result = await readJson(response);
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "Não foi possível validar a planilha.");
      setPreview(result as unknown as ImportPreview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível validar a planilha.");
    } finally {
      setLoading(false);
    }
  };

  const importProducts = async () => {
    if (!file || !preview || importing) return;
    const candidates = preview.products.filter((product) => product.errors.length === 0);
    if (!candidates.length) { setMessage("Nenhum produto válido para importar."); return; }
    setImporting(true);
    setResults([]);
    setProgress(0);
    try {
      await runProductImportQueue(candidates.map((product) => product.key), async (productKey) => {
        return runProductImportBatches(productKey, async (imageOffset) => {
          const form = new FormData();
          form.set("file", file);
          form.set("productKey", productKey);
          form.set("imageOffset", String(imageOffset));
          const response = await fetch("/api/catalog/products/import", { method: "POST", body: form });
          const result = await readJson(response);
          return {
            productKey,
            ok: response.ok,
            alreadyImported: result.alreadyImported === true,
            warnings: Array.isArray(result.warnings) ? result.warnings.filter((item): item is string => typeof item === "string") : [],
            hasMore: result.hasMore === true,
            nextImageOffset: typeof result.nextImageOffset === "number" ? result.nextImageOffset : undefined,
            retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
            message: typeof result.message === "string" ? result.message : response.ok ? "Produto importado." : "Falha na importação."
          };
        });
      }, (completed, percentage) => { setResults(completed); setProgress(percentage); });
      await onImported();
    } finally {
      setImporting(false);
    }
  };

  const close = () => {
    if (loading || importing) return;
    onClose();
  };

  const successful = results.filter((result) => result.ok && !result.alreadyImported && !result.warnings?.length).length;
  const withWarnings = results.filter((result) => result.ok && (result.alreadyImported || Boolean(result.warnings?.length))).length;
  const failed = results.filter((result) => !result.ok).length;

  return (
    <PanelDrawer open={open} title="Importar produtos" eyebrow="Catálogo" size="large" busy={loading || importing} resizable onClose={close}>
      <div className="product-import-drawer">
        <div className="product-import-body">
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void selectFile(selected); }} />
          <button className="product-import-dropzone" type="button" disabled={loading || importing}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); const selected = event.dataTransfer.files[0]; if (selected) void selectFile(selected); }}>
            {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
            <strong>{file ? file.name : "Selecionar ou arrastar arquivo XLSX"}</strong>
            <span>A planilha é validada antes de qualquer cadastro.</span>
          </button>

          {message ? <p className="form-message error" role="alert">{message}</p> : null}
          {preview ? <>
          <section className="product-import-summary" aria-label="Resumo da planilha">
            <span><strong>{preview.summary.products}</strong> produtos</span>
            <span><strong>{preview.summary.variations}</strong> variações</span>
            <span><strong>{preview.summary.images}</strong> imagens</span>
            <span><strong>{preview.summary.colors}</strong> cores</span>
            <span><strong>{preview.summary.warnings}</strong> avisos</span>
            <span><strong>{preview.summary.errors}</strong> erros</span>
          </section>
          <ImportIssueList level="error" items={preview.issues.filter((issue) => issue.level === "error").map((issue) => issue.message)} />
          <ImportIssueList level="warning" items={preview.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message)} />
          <div className="product-import-list">
            {preview.products.map((product) => <article key={product.key}>
              <div className="product-import-product-heading"><strong>{product.name}</strong><span>{product.category} · {product.variations} variações · {product.images} imagens</span></div>
              {product.alreadyImported ? <span className="status gray">Já importado</span> : product.errors.length ? <span className="status red">Com erro</span> : product.warnings.length ? <span className="status yellow">Com avisos</span> : <span className="status green">Pronto</span>}
              <ImportIssueList level="error" items={product.errors} />
              <ImportIssueList level="warning" items={product.warnings} />
            </article>)}
          </div>
          </> : null}

          {importing || results.length ? <section className="product-import-progress" aria-live="polite">
          <div><strong>Progresso da importação</strong><span>{progress}%</span></div>
          <progress max="100" value={progress}>{progress}%</progress>
          {results.length ? <p>{successful} importado(s) · {withWarnings} com aviso(s) · {failed} falhou(aram)</p> : null}
          {results.length ? <div className="product-import-results">
            {results.map((result) => <article key={result.productKey}>
              <div>
                <strong>{preview?.products.find((product) => product.key === result.productKey)?.name ?? result.productKey}</strong>
                <span>{result.message}</span>
              </div>
              <span className={`status ${result.ok ? result.alreadyImported || result.warnings?.length ? "yellow" : "green" : "red"}`}>
                {result.ok ? result.alreadyImported ? "Já importado" : result.warnings?.length ? "Com avisos" : "Importado" : "Falhou"}
              </span>
              <ImportIssueList level={result.ok ? "warning" : "error"} items={result.warnings?.length ? result.warnings : result.ok ? [] : [result.message]} />
            </article>)}
          </div> : null}
          </section> : null}
        </div>

        <footer className="product-import-footer">
          <button className="secondary-button" type="button" onClick={close} disabled={loading || importing}>Cancelar</button>
          <button className="primary-button" type="button" onClick={() => void importProducts()}
            disabled={!preview || importing || loading || preview.products.every((product) => product.errors.length > 0)}>
            {importing ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
            {importing ? "Importando..." : "Importar produtos"}
          </button>
        </footer>
      </div>
    </PanelDrawer>
  );
}
