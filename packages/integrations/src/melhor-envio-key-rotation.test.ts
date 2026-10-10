import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEncryptedMelhorEnvioTokenStore,
  decryptMelhorEnvioToken,
  encryptMelhorEnvioToken,
  inspectMelhorEnvioCredentialKeys,
  MelhorEnvioProvider,
  melhorEnvioTokenKeyId,
  parseMelhorEnvioPreviousKeys,
  type EncryptedMelhorEnvioTokenRecord,
  type MelhorEnvioCiphertextPair,
  type MelhorEnvioConfig,
  type MelhorEnvioTokenKeyring
} from "./melhor-envio";

const oldKey = Buffer.alloc(32, 1).toString("base64");
const newKey = Buffer.alloc(32, 2).toString("base64");
const lostKey = Buffer.alloc(32, 3).toString("base64");
const rotating: MelhorEnvioTokenKeyring = { activeKey: newKey, previousKeys: [oldKey] };

const config: MelhorEnvioConfig = {
  environment: "sandbox", clientId: "123", clientSecret: "secret",
  redirectUri: "https://panel.example.com/api/integrations/melhor-envio/callback",
  applicationName: "curti Z", technicalContact: "tech@example.com"
};

/** Reproduz o formato v1 legado (AES-256-GCM sem key ID nem AAD) gravado antes da rotação. */
async function legacyV1(value: string, encodedKey: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", Buffer.from(encodedKey, "base64"), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`;
}

async function legacyRecord(key = oldKey, expiresAt = "2099-01-01T00:00:00.000Z"): Promise<EncryptedMelhorEnvioTokenRecord> {
  return { accessTokenCiphertext: await legacyV1("legacy-access", key),
    refreshTokenCiphertext: await legacyV1("legacy-refresh", key),
    accessTokenExpiresAt: expiresAt, refreshTokenExpiresAt: "2099-02-01T00:00:00.000Z" };
}

/** Linha de private.integration_credentials com as mesmas garantias das RPCs (CAS e lock com prazo). */
function fakeDatabase(initial: EncryptedMelhorEnvioTokenRecord | null) {
  const state = { record: initial, lockId: null as string | null, saves: 0, replacements: 0 };
  return {
    state,
    load: async () => state.record ? { ...state.record } : null,
    save: async (record: EncryptedMelhorEnvioTokenRecord) => { state.saves += 1; state.record = { ...record }; },
    replaceCiphertexts: async (expected: MelhorEnvioCiphertextPair, next: MelhorEnvioCiphertextPair) => {
      if (!state.record || state.record.accessTokenCiphertext !== expected.accessTokenCiphertext
        || state.record.refreshTokenCiphertext !== expected.refreshTokenCiphertext) return false;
      state.replacements += 1;
      state.record = { ...state.record, ...next };
      return true;
    },
    claimRefreshLock: async (lockId: string) => {
      if (state.lockId && state.lockId !== lockId) return false;
      state.lockId = lockId;
      return true;
    },
    releaseRefreshLock: async (lockId: string) => { if (state.lockId === lockId) state.lockId = null; }
  };
}

const storeFor = (database: ReturnType<typeof fakeDatabase>, encryptionKey: string | MelhorEnvioTokenKeyring,
  overrides: Partial<Parameters<typeof createEncryptedMelhorEnvioTokenStore>[0]> = {}) =>
  createEncryptedMelhorEnvioTokenStore({ encryptionKey, ...database, ...overrides });

afterEach(() => vi.unstubAllGlobals());

describe("rotação da chave dos tokens Melhor Envio", () => {
  it("chave atual válida: grava v2 com key ID e lê sem recifrar", async () => {
    const database = fakeDatabase(null);
    const tokens = storeFor(database, rotating);
    await tokens.write({ accessToken: "a", refreshToken: "r", accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", refreshTokenExpiresAt: null });
    const keyId = await melhorEnvioTokenKeyId(newKey);
    expect(keyId).toMatch(/^[0-9a-f]{12}$/u);
    expect(database.state.record?.accessTokenCiphertext.startsWith(`v2.${keyId}.`)).toBe(true);
    expect(database.state.record?.accessTokenCiphertext).not.toContain("a.");
    await expect(tokens.read()).resolves.toMatchObject({ accessToken: "a", refreshToken: "r" });
    expect(database.state.replacements).toBe(0);
  });

  it("registro v1 legado com chave anterior: lê e recifra os dois tokens juntos com a chave ativa", async () => {
    const database = fakeDatabase(await legacyRecord());
    const before = { ...database.state.record };
    await expect(storeFor(database, rotating).read()).resolves.toMatchObject({
      accessToken: "legacy-access", refreshToken: "legacy-refresh", accessTokenExpiresAt: before.accessTokenExpiresAt
    });
    expect(database.state.replacements).toBe(1);
    expect(database.state.saves).toBe(0);
    const keyId = await melhorEnvioTokenKeyId(newKey);
    expect(database.state.record?.accessTokenCiphertext.startsWith(`v2.${keyId}.`)).toBe(true);
    expect(database.state.record?.refreshTokenCiphertext.startsWith(`v2.${keyId}.`)).toBe(true);
    expect(database.state.record?.accessTokenExpiresAt).toBe(before.accessTokenExpiresAt);
    // Depois da migração a chave anterior deixa de ser necessária.
    await expect(storeFor(database, newKey).read()).resolves.toMatchObject({ accessToken: "legacy-access" });
    expect(database.state.replacements).toBe(1);
  });

  it("v2 cifrado com chave que virou anterior também é recifrado", async () => {
    const database = fakeDatabase(null);
    await storeFor(database, oldKey).write({ accessToken: "a", refreshToken: "r",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", refreshTokenExpiresAt: null });
    await expect(storeFor(database, rotating).read()).resolves.toMatchObject({ accessToken: "a", refreshToken: "r" });
    expect(database.state.record?.accessTokenCiphertext.startsWith(`v2.${await melhorEnvioTokenKeyId(newKey)}.`)).toBe(true);
  });

  it("chave anterior indisponível: falha segura sem gravar nada", async () => {
    const legacy = fakeDatabase(await legacyRecord(lostKey));
    await expect(storeFor(legacy, rotating).read()).rejects.toMatchObject({
      code: "authentication", diagnostic: { reason: "token_decryption_failed" }
    });
    const current = fakeDatabase(null);
    await storeFor(current, lostKey).write({ accessToken: "a", refreshToken: "r",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", refreshTokenExpiresAt: null });
    const snapshot = { ...current.state.record };
    await expect(storeFor(current, rotating).read()).rejects.toMatchObject({
      code: "authentication", diagnostic: { reason: "token_key_unavailable" }
    });
    for (const database of [legacy, current]) {
      expect(database.state.replacements).toBe(0);
    }
    expect(current.state.saves).toBe(1);
    expect(current.state.record).toEqual(snapshot);
  });

  it.each([
    ["formato desconhecido", "v9.abc.def"],
    ["base64 inválido", "v1.%%%.###"],
    ["ciphertext adulterado", "tampered"]
  ])("dados cifrados inválidos (%s) falham sem sobrescrever", async (_label, value) => {
    const record = await legacyRecord();
    const database = fakeDatabase({ ...record, refreshTokenCiphertext: value === "tampered"
      ? `${record.refreshTokenCiphertext.slice(0, -4)}AAA=` : value });
    const snapshot = { ...database.state.record };
    await expect(storeFor(database, rotating).read()).rejects.toMatchObject({ diagnostic: { reason: "token_decryption_failed" } });
    expect(database.state.record).toEqual(snapshot);
    expect(database.state.replacements + database.state.saves).toBe(0);
  });

  it("AAD impede trocar o ciphertext do access pelo do refresh", async () => {
    const access = await encryptMelhorEnvioToken("a", newKey, "access_token");
    await expect(decryptMelhorEnvioToken(access, newKey, "refresh_token")).rejects.toMatchObject({
      diagnostic: { reason: "token_decryption_failed" }
    });
    await expect(decryptMelhorEnvioToken(access, newKey, "access_token")).resolves.toBe("a");
  });

  it("falha durante a recifragem não interrompe a leitura e permite retomar depois", async () => {
    const database = fakeDatabase(await legacyRecord());
    const snapshot = { ...database.state.record };
    const failures: unknown[] = [];
    const failing = storeFor(database, rotating, {
      replaceCiphertexts: async () => { throw new Error("rpc offline"); },
      onReencryptionFailure: (error) => failures.push(error)
    });
    await expect(failing.read()).resolves.toMatchObject({ accessToken: "legacy-access" });
    expect(failures).toHaveLength(1);
    expect(database.state.record).toEqual(snapshot);
    // Retomada: a próxima leitura com a RPC disponível conclui a migração.
    await storeFor(database, rotating).read();
    expect(database.state.replacements).toBe(1);
    await expect(storeFor(database, newKey).read()).resolves.toMatchObject({ refreshToken: "legacy-refresh" });
  });

  it("duas instâncias recifrando ao mesmo tempo: só uma grava e o resultado é consistente", async () => {
    const database = fakeDatabase(await legacyRecord());
    const [first, second] = await Promise.all([storeFor(database, rotating).read(), storeFor(database, rotating).read()]);
    expect(first?.accessToken).toBe("legacy-access");
    expect(second?.refreshToken).toBe("legacy-refresh");
    expect(database.state.replacements).toBe(1);
    await expect(storeFor(database, newKey).read()).resolves.toMatchObject({
      accessToken: "legacy-access", refreshToken: "legacy-refresh"
    });
  });

  it("refresh OAuth durante a rotação: recifragem atrasada não sobrescreve os tokens renovados", async () => {
    const database = fakeDatabase(await legacyRecord());
    let releaseReplacement!: () => void;
    const gate = new Promise<void>((resolve) => { releaseReplacement = resolve; });
    const slow = storeFor(database, rotating, {
      replaceCiphertexts: async (expected, next) => { await gate; return database.replaceCiphertexts(expected, next); }
    });
    const pendingRead = slow.read();
    // Outra instância renova o token e grava com a chave ativa antes da recifragem terminar.
    await storeFor(database, rotating).write({ accessToken: "renewed-access", refreshToken: "renewed-refresh",
      accessTokenExpiresAt: "2099-03-01T00:00:00.000Z", refreshTokenExpiresAt: "2099-04-01T00:00:00.000Z" });
    releaseReplacement();
    await pendingRead;
    await expect(storeFor(database, newKey).read()).resolves.toMatchObject({
      accessToken: "renewed-access", refreshToken: "renewed-refresh"
    });
  });

  it("token legado vencido: o provider renova com a chave anterior e grava com a ativa", async () => {
    const database = fakeDatabase(await legacyRecord(oldKey, "2000-01-01T00:00:00.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new MelhorEnvioProvider(config, storeFor(database, rotating)).health()).resolves.toBe("online");
    const refreshInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const refreshBody: unknown = typeof refreshInit.body === "string" ? JSON.parse(refreshInit.body) : null;
    expect(refreshBody).toMatchObject({ grant_type: "refresh_token", refresh_token: "legacy-refresh" });
    expect(database.state.lockId).toBeNull();
    await expect(storeFor(database, newKey).read()).resolves.toMatchObject({
      accessToken: "fresh-access", refreshToken: "fresh-refresh"
    });
  });

  it("loja e painel com a mesma chave ativa produzem o mesmo key ID e leem o mesmo registro", async () => {
    const database = fakeDatabase(await legacyRecord());
    const storeKeyring: MelhorEnvioTokenKeyring = { activeKey: newKey, previousKeys: parseMelhorEnvioPreviousKeys(` ${oldKey},\n`) };
    const panelKeyring: MelhorEnvioTokenKeyring = { activeKey: newKey, previousKeys: [oldKey, oldKey] };
    await storeFor(database, storeKeyring).read();
    await expect(storeFor(database, panelKeyring).read()).resolves.toMatchObject({ accessToken: "legacy-access" });
    const report = await inspectMelhorEnvioCredentialKeys(database.state.record!, panelKeyring);
    expect(report).toEqual({ activeKeyId: await melhorEnvioTokenKeyId(newKey), previousKeyCount: 1,
      accessToken: "active", refreshToken: "active", readable: true, reencryptionPending: false });
  });

  it("diagnóstico distingue registro pendente, chave ausente e dado inválido sem expor tokens", async () => {
    const legacy = await legacyRecord();
    await expect(inspectMelhorEnvioCredentialKeys(legacy, rotating)).resolves.toMatchObject({
      accessToken: "previous", refreshToken: "previous", readable: true, reencryptionPending: true
    });
    const unavailable = { accessTokenCiphertext: await encryptMelhorEnvioToken("a", lostKey),
      refreshTokenCiphertext: await encryptMelhorEnvioToken("r", lostKey, "refresh_token") };
    await expect(inspectMelhorEnvioCredentialKeys(unavailable, rotating)).resolves.toMatchObject({
      accessToken: "unavailable", readable: false, reencryptionPending: false
    });
    const report = await inspectMelhorEnvioCredentialKeys({ ...legacy, accessTokenCiphertext: "v1.x.y" }, rotating);
    expect(report).toMatchObject({ accessToken: "invalid", refreshToken: "previous", readable: false });
    expect(JSON.stringify(report)).not.toContain("legacy");
  });

  it("chave anterior malformada é erro de configuração, nunca ignorada silenciosamente", async () => {
    const database = fakeDatabase(await legacyRecord());
    await expect(storeFor(database, { activeKey: newKey, previousKeys: ["curta"] }).read())
      .rejects.toMatchObject({ code: "configuration" });
  });
});
