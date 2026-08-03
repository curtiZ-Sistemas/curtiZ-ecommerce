import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperationalConsole } from "./operational-console";

describe("OperationalConsole", () => {
  it("starts with an accessible loading state instead of fabricated metrics", () => {
    const html = renderToStaticMarkup(<OperationalConsole section="" />);

    expect(html).toContain("Carregando operação");
    expect(html).not.toContain("78");
    expect(html).not.toContain("145");
  });
});
