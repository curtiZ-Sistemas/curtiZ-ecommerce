import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepresentativeAccessCard } from "./representative-access-card";

describe("RepresentativeAccessCard", () => {
  it("direciona cliente sem papel para a solicitação", () => {
    const html = renderToStaticMarkup(<RepresentativeAccessCard active={false} />);
    expect(html).toContain("/representante/solicitacao");
    expect(html).toContain("Iniciar solicitação");
  });

  it("preserva a conta de cliente e oferece troca para o portal", () => {
    const html = renderToStaticMarkup(<RepresentativeAccessCard active />);
    expect(html).toContain('href="/representante"');
    expect(html).toContain("sem perder o acesso de cliente");
  });
});
