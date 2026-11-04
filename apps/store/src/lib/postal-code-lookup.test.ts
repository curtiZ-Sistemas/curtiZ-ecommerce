import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostalCodeLookup } from "./postal-code-lookup";

afterEach(() => vi.unstubAllGlobals());
const address = { logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" };
const fields = () => ({ street: { value: "" }, district: { value: "" }, city: { value: "" }, state: { value: "" } });

describe("postal code lookup", () => {
  it("fills only blank address fields and leaves customer input untouched", async () => {
    const form = fields(); form.street.value = "Minha rua";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(address)));
    const status = vi.fn();
    await createPostalCodeLookup(() => form, status).update("01001-000");
    expect(form.street.value).toBe("Minha rua");
    expect([form.district.value, form.city.value, form.state.value]).toEqual(["Sé", "São Paulo", "SP"]);
    expect(status).toHaveBeenLastCalledWith("found");
  });

  it("ignores old responses and changes made during a request", async () => {
    const form = fields();
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve))));
    const lookup = createPostalCodeLookup(() => form, vi.fn());
    const first = lookup.update("01001000");
    const second = lookup.update("30110000");
    form.city.value = "Cidade escolhida";
    pending[1]!(Response.json({ ...address, logradouro: "Rua nova", localidade: "Belo Horizonte", uf: "MG" }));
    await second;
    pending[0]!(Response.json(address));
    await first;
    expect(form.street.value).toBe("Rua nova");
    expect(form.city.value).toBe("Cidade escolhida");
    expect(form.state.value).toBe("MG");
  });

  it("preserves a field the customer edited and cleared while the lookup was pending", async () => {
    const form = fields();
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; })));
    const lookup = createPostalCodeLookup(() => form, vi.fn());
    const request = lookup.update("01001000");
    form.street.value = "texto"; lookup.markEdited("street");
    form.street.value = ""; lookup.markEdited("street");
    resolve(Response.json(address));
    await request;
    expect(form.street.value).toBe("");
    expect(form.city.value).toBe("São Paulo");
  });

  it("clears only previously autofilled fields when the CEP changes", async () => {
    const form = fields();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(address)));
    const lookup = createPostalCodeLookup(() => form, vi.fn());
    await lookup.update("01001000");
    form.street.value = "Alterada pelo cliente";
    await lookup.update("01001");
    expect(form.street.value).toBe("Alterada pelo cliente");
    expect(form.city.value).toBe("");
  });

  it("updates unchanged saved address fields when editing the CEP, but preserves edits", async () => {
    const form = fields();
    form.street.value = "Rua antiga"; form.city.value = "Cidade antiga";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(address)));
    const lookup = createPostalCodeLookup(() => form, vi.fn(), { initialCode: "30110000", replaceUntouchedOnChange: true });
    form.street.value = "Rua escolhida"; lookup.markEdited("street");
    await lookup.update("01001000");
    expect(form.street.value).toBe("Rua escolhida");
    expect(form.city.value).toBe("São Paulo");
  });

  it("handles partial, missing and unavailable results without blocking manual entry", async () => {
    const form = fields(); const status = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ localidade: "Cidade", uf: "MG" }))
      .mockResolvedValueOnce(Response.json({ erro: true })).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const lookup = createPostalCodeLookup(() => form, status);
    await lookup.update("12345678"); expect(status).toHaveBeenLastCalledWith("partial");
    await lookup.update("99999999"); expect(status).toHaveBeenLastCalledWith("missing");
    await lookup.update("87654321"); expect(status).toHaveBeenLastCalledWith("unavailable");
    await lookup.update("123"); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
