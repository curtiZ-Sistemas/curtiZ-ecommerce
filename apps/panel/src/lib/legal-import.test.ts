import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { boundedLegalUnzip, importLegalFiles } from "./legal-import";
describe("limites e importação de texto sem conversores", () => {
  it("importa múltiplos textos e ignora o guia administrativo", async () => {
    const result = await importLegalFiles([
      new File(
        ["Política de Privacidade\n1 Responsável\nA empresa é [RAZAO_SOCIAL]."],
        "02-politica-de-privacidade.txt"
      ),
      new File(["Guia de preenchimento e publicação"], "00-guia-de-preenchimento-e-publicacao.txt")
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.slug).toBe("aviso-de-privacidade");
    expect(result.ignored).toHaveLength(1);
  });
  it("respeita manifesto sem tratá-lo como conteúdo ou data ISO", async () => {
    const result = await importLegalFiles([
      new File(
        [
          JSON.stringify({
            documentos: [
              {
                slug: "aviso-de-privacidade",
                arquivos: { txt: "documento.txt" },
                vigencia: "A partir da publicação",
                referencias: ["BRASIL. LGPD."]
              }
            ]
          })
        ],
        "Mapa_de_Publicacao.json"
      ),
      new File(["Documento\n1 Conteúdo\nIntrodução completa com dados [CNPJ]."], "documento.txt")
    ]);
    expect(result.candidates[0]?.slug).toBe("aviso-de-privacidade");
    expect(result.candidates[0]?.sections[0]?.content).toContain("Documento");
  });
  it("não escolhe entre documentos conflitantes", async () => {
    const result = await importLegalFiles([
      new File(
        ["Política de Garantia\n1 Conteúdo\nO prazo é 90 dias para reclamar de vícios."],
        "garantia.txt"
      ),
      new File(
        ["Política de Garantia\n1 Conteúdo\nO prazo é 30 dias para reclamar de vícios."],
        "07-garantia.txt"
      )
    ]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.key).not.toBe(result.candidates[1]?.key);
  });
  it("pede destino no conflito entre arquivo e título", async () => {
    const result = await importLegalFiles([
      new File(
        ["Política de Garantia\n1 Conteúdo\nTexto completo com direitos do consumidor."],
        "privacidade.txt"
      )
    ]);
    expect(result.candidates[0]?.slug).toBeUndefined();
    expect(result.candidates[0]?.warnings).toHaveLength(1);
  });
  it("respeita substituição explícita e avisa divergência", async () => {
    const result = await importLegalFiles(
      [
        new File(
          ["Política de Garantia\n1 Conteúdo\nTexto completo com direitos do consumidor."],
          "garantia.txt"
        )
      ],
      "aviso-de-privacidade"
    );
    expect(result.candidates[0]?.slug).toBe("aviso-de-privacidade");
    expect(result.candidates[0]?.warnings[0]).toContain("outra política");
  });
  it("rejeita vazios, formatos ilegíveis e contagem excessiva", async () => {
    const result = await importLegalFiles([
      new File([], "garantia.txt"),
      new File([new Uint8Array([255, 254])], "privacidade.txt")
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    await expect(
      importLegalFiles(Array.from({ length: 41 }, () => new File(["texto"], "test.txt")))
    ).rejects.toThrow("40 arquivos");
  });
  it("rejeita ZIP perigoso antes de descompactar", () => {
    expect(() => boundedLegalUnzip(zipSync({ "../garantia.txt": strToU8("texto") }))).toThrow(
      "caminhos perigosos"
    );
    expect(() =>
      boundedLegalUnzip(zipSync({ "enorme.txt": new Uint8Array(5 * 1024 * 1024) }))
    ).toThrow("descompactação excessiva");
    expect(() => boundedLegalUnzip(new Uint8Array([80, 75]))).toThrow("ZIP inválido");
  });
  it("descompacta pacote de textos sem publicar o manifesto", async () => {
    const result = await importLegalFiles([
      new File(
        [
          new Uint8Array(
            zipSync({
              "garantia.txt": strToU8(
                "Política de Garantia\n1 Consumidor\nA garantia legal preserva os direitos do consumidor."
              )
            })
          )
        ],
        "politicas.zip"
      )
    ]);
    expect(result.candidates[0]?.slug).toBe("garantia");
    expect(result.errors).toEqual([]);
  });
});
