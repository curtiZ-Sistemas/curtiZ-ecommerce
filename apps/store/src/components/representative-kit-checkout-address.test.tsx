import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteKitAddress, kitAddressPayload, readKitAddresses, saveKitAddress, selectionAfterDelete, type KitAddress
} from "./representative-kit-address-actions";
import { KitAddressCard, KitAddressDeleteDialog } from "./representative-kit-checkout-address";

const row = {
  id: "11111111-1111-4111-8111-111111111111", label: "Loja Centro", recipientName: "Maria Souza", postalCode: "30140-071",
  street: "Rua da Bahia", number: "10", complement: "Sala 2", district: "Centro", city: "Belo Horizonte", state: "MG", isDefault: true
};
const other = { ...row, id: "22222222-2222-4222-8222-222222222222", label: "Depósito", postalCode: "31000-000" };
const [address] = readKitAddresses([row]).eligible as [KitAddress];

type Props = Record<string, unknown>;
function findAll(node: ReactNode, match: (props: Props) => boolean): Props[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap(item => findAll(item as ReactNode, match)) : [];
  const props = (node as ReactElement<Props>).props;
  return [...(match(props) ? [props] : []), ...findAll(props.children as ReactNode, match)];
}

afterEach(() => vi.unstubAllGlobals());

describe("kit checkout address book", () => {
  it("keeps only MG addresses with a 3xxxxxxx postal code and the full row for editing", () => {
    const book = readKitAddresses([row, { ...other, state: "SP" }, { ...other, postalCode: "01000-000" }]);
    expect(book.total).toBe(3);
    expect(book.eligible).toHaveLength(1);
    expect(book.eligible[0]).toMatchObject({ id: row.id, recipientName: "Maria Souza", complement: "Sala 2", isDefault: true,
      title: "Loja Centro", line: "Rua da Bahia, 10", place: "Centro · Belo Horizonte · 30140-071" });
  });

  it("edits with the customer-area action: same id, kept label/default and fixed MG", () => {
    expect(kitAddressPayload({ recipientName: "Maria", street: "Rua A", number: "1", complement: "", district: "Centro",
      city: "Contagem", postalCode: "32000-000" }, address)).toEqual({
      action: "address_save", id: row.id, label: "Loja Centro", recipientName: "Maria", street: "Rua A", number: "1", complement: "",
      district: "Centro", city: "Contagem", postalCode: "32000-000", state: "MG", isDefault: true
    });
  });

  it("creates without id, with the kit label and not as default", () => {
    const payload = kitAddressPayload({ recipientName: "Maria", street: "Rua A", number: "1", complement: "", district: "Centro",
      city: "Contagem", postalCode: "32000-000" });
    expect(payload).not.toHaveProperty("id");
    expect(payload).toMatchObject({ action: "address_save", label: "Entrega de kits", state: "MG", isDefault: false });
  });

  it("posts the edit to /api/customer and keeps the id when the server returns none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const payload = kitAddressPayload({ recipientName: "Maria", street: "Rua A", number: "1", complement: "", district: "Centro",
      city: "Contagem", postalCode: "32000-000" }, address);
    expect(await saveKitAddress(payload)).toEqual({ ok: true, id: row.id });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/customer");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("surfaces the server message on save and delete errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Você pode cadastrar no máximo 3 endereços." }) }));
    expect(await saveKitAddress(kitAddressPayload({ recipientName: "Maria", street: "Rua A", number: "1", complement: "",
      district: "Centro", city: "Contagem", postalCode: "32000-000" }))).toEqual({ ok: false, message: "Você pode cadastrar no máximo 3 endereços." });
    expect(await deleteKitAddress(row.id)).toEqual({ ok: false, message: "Você pode cadastrar no máximo 3 endereços." });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await deleteKitAddress(row.id)).toEqual({ ok: false, message: "Não foi possível excluir o endereço. Tente novamente." });
  });

  it("deletes through address_delete with the address id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await deleteKitAddress(row.id)).toEqual({ ok: true, id: row.id });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ action: "address_delete", id: row.id });
  });

  it("after deleting the selected address selects the only remaining one or clears the choice", () => {
    const [a, b] = [address, readKitAddresses([other]).eligible[0]!];
    expect(selectionAfterDelete(a.id, a.id, [b])).toBe(b.id);
    expect(selectionAfterDelete(a.id, a.id, [])).toBe("");
    expect(selectionAfterDelete(a.id, a.id, [b, { ...b, id: "x" }])).toBe("");
    expect(selectionAfterDelete(b.id, a.id, [b])).toBe(b.id);
  });
});

describe("kit address card and delete dialog", () => {
  it("renders icon actions outside the selection label", () => {
    const html = renderToStaticMarkup(<KitAddressCard address={address} selected onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(html).toContain('aria-label="Editar endereço"');
    expect(html).toContain('aria-label="Excluir endereço"');
    expect(html).toMatch(/<\/label><div class="kit-checkout-address-actions">/u);
    expect(html).not.toMatch(/<label[^>]*>(?:(?!<\/label>).)*<button/su);
  });

  it("only opens the confirmation on delete: the card never calls the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    const tree = KitAddressCard({ address, selected: false, onSelect, onEdit, onDelete });
    const click = (label: string) => (findAll(tree, props => props["aria-label"] === label)[0]!.onClick as () => void)();
    click("Excluir endereço");
    click("Editar endereço");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for confirmation in an accessible dialog and deletes only on Excluir", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const html = renderToStaticMarkup(<KitAddressDeleteDialog address={address} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Excluir endereço?");
    expect(html).toContain("Tem certeza?");
    expect(html).toContain("Rua da Bahia, 10");
    expect(html).toContain(">Cancelar</button>");
    expect(html).toContain(">Excluir</button>");
    expect(html).not.toContain('role="alert"');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
