import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

describe("panel access wrapper", () => {
  it("keeps the generated handler and background logging independent", async () => {
    let complete: (value: boolean) => void = () => {};
    const logging = new Promise<boolean>((resolve) => { complete = resolve; });
    const record = vi.fn().mockReturnValue(logging);
    const response = new Response("panel");
    const generatedFetch = vi.fn().mockResolvedValue(response);
    const queue = vi.fn();
    type Context = { waitUntil: ReturnType<typeof vi.fn> };
    type Handler = { fetch(request: Request, env: object, ctx: Context): Promise<Response>; queue: typeof queue };
    const module = { exports: {} as { default: Handler } };
    const source = readFileSync(resolve(process.cwd(), "apps/panel/custom-worker.ts"), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(compiled, { module, exports: module.exports, require: (specifier: string) => {
      if (specifier === "@curtiz/security/application-access-log") return { recordApplicationAccess: record };
      if (specifier === "./.open-next/worker.js") return { default: { fetch: generatedFetch, queue } };
      throw new Error("Unexpected dependency");
    } });
    const request = new Request("https://painel.example.invalid");
    const context = { waitUntil: vi.fn() };
    const environment = {};
    expect(await module.exports.default.fetch(request, environment, context)).toBe(response);
    expect(record).toHaveBeenCalledWith(request, environment, "panel");
    expect(generatedFetch).toHaveBeenCalledWith(request, environment, context);
    expect(context.waitUntil).toHaveBeenCalledWith(logging);
    expect(module.exports.default.queue).toBe(queue);
    complete(true);
    await logging;
  });
});
