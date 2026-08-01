export type MockRow = Record<string, unknown>;

export type MockSupabaseErrorShape = {
  code: string;
  message: string;
  details: string;
  hint: string;
};

export class MockSupabaseError extends Error implements MockSupabaseErrorShape {
  readonly details: string;
  readonly hint: string;

  constructor(
    readonly code: string,
    message: string,
    options: { details?: string; hint?: string } = {}
  ) {
    super(message);
    this.name = "MockSupabaseError";
    this.details = options.details ?? "";
    this.hint = options.hint ?? "";
  }
}

type QueryResult<T = MockRow[]> = { data: T | null; error: MockSupabaseError | null };
type Filter = { column: string; operator: "eq" | "neq" | "in"; value: unknown };
type Order = { column: string; ascending: boolean };

export type MockAuthUser = {
  id: string;
  email?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

export type MockSupabaseOptions = {
  tables?: Record<string, MockRow[]>;
  storage?: Record<string, Record<string, Uint8Array>>;
  user?: MockAuthUser | null;
  errors?: Record<string, MockSupabaseError>;
  rpc?: Record<string, unknown>;
};

const clone = <T>(value: T): T => structuredClone(value);

const comparableString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value) ?? "";
};

class MockQueryBuilder implements PromiseLike<QueryResult> {
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private orderBy?: Order;
  private rowLimit?: number;
  private values: MockRow[] = [];
  private selectedColumns = "*";

  constructor(
    private readonly table: string,
    private readonly rows: MockRow[],
    private readonly configuredErrors: Record<string, MockSupabaseError>
  ) {}

  select(columns = "*") {
    this.selectedColumns = columns;
    return this;
  }

  insert(values: MockRow | MockRow[]) {
    this.action = "insert";
    this.values = clone(Array.isArray(values) ? values : [values]);
    return this;
  }

  update(values: MockRow) {
    this.action = "update";
    this.values = [clone(values)];
    return this;
  }

  upsert(values: MockRow | MockRow[]) {
    this.action = "upsert";
    this.values = clone(Array.isArray(values) ? values : [values]);
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, operator: "neq", value });
    return this;
  }

  in(column: string, value: readonly unknown[]) {
    this.filters.push({ column, operator: "in", value });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderBy = { column, ascending: options.ascending ?? true };
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  async single(): Promise<QueryResult<MockRow>> {
    const result = await this.execute();
    if (result.error) return { data: null, error: result.error };
    if (!result.data || result.data.length !== 1) {
      return {
        data: null,
        error: new MockSupabaseError("PGRST116", "Expected exactly one row")
      };
    }
    return { data: result.data[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<QueryResult<MockRow>> {
    const result = await this.execute();
    if (result.error) return { data: null, error: result.error };
    if ((result.data?.length ?? 0) > 1) {
      return { data: null, error: new MockSupabaseError("PGRST116", "Expected zero or one row") };
    }
    return { data: result.data?.[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: MockRow): boolean {
    return this.filters.every((filter) => {
      if (filter.operator === "eq") return row[filter.column] === filter.value;
      if (filter.operator === "neq") return row[filter.column] !== filter.value;
      return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
    });
  }

  private project(row: MockRow): MockRow {
    if (this.selectedColumns === "*" || this.selectedColumns.includes("(")) return clone(row);
    const columns = this.selectedColumns.split(",").map((item) => item.trim());
    return Object.fromEntries(columns.map((column) => [column, row[column]]));
  }

  private async execute(): Promise<QueryResult> {
    const error =
      this.configuredErrors[`from:${this.table}:${this.action}`] ??
      this.configuredErrors[`from:${this.table}`];
    if (error) return { data: null, error };

    if (this.action === "insert") {
      this.rows.push(...clone(this.values));
      return { data: this.values.map((row) => this.project(row)), error: null };
    }
    if (this.action === "upsert") {
      for (const value of this.values) {
        const id = value.id;
        const index = id === undefined ? -1 : this.rows.findIndex((row) => row.id === id);
        if (index >= 0) this.rows[index] = { ...this.rows[index], ...clone(value) };
        else this.rows.push(clone(value));
      }
      return { data: this.values.map((row) => this.project(row)), error: null };
    }

    const matching = this.rows.filter((row) => this.matches(row));
    if (this.action === "update") {
      for (const row of matching) Object.assign(row, clone(this.values[0] ?? {}));
    } else if (this.action === "delete") {
      for (let index = this.rows.length - 1; index >= 0; index -= 1) {
        const row = this.rows[index];
        if (row && this.matches(row)) this.rows.splice(index, 1);
      }
    }

    let result = this.action === "delete" ? matching : matching.map((row) => this.project(row));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((left, right) => {
        const comparison = comparableString(left[column]).localeCompare(comparableString(right[column]));
        return ascending ? comparison : -comparison;
      });
    }
    if (this.rowLimit !== undefined) result = result.slice(0, this.rowLimit);
    return { data: clone(result), error: null };
  }
}

export const createMockSupabaseClient = (options: MockSupabaseOptions = {}) => {
  const tables = clone(options.tables ?? {});
  const buckets = clone(options.storage ?? {});
  const errors = options.errors ?? {};
  let currentUser = clone(options.user ?? null);

  return {
    auth: {
      getUser: async () => ({
        data: { user: clone(currentUser) },
        error: errors["auth:getUser"] ?? null
      }),
      getSession: async () => ({
        data: {
          session: currentUser
            ? { user: clone(currentUser), access_token: "mock-access-token" }
            : null
        },
        error: errors["auth:getSession"] ?? null
      }),
      getClaims: async () => ({
        data: currentUser ? { claims: { sub: currentUser.id, ...currentUser.app_metadata } } : null,
        error: errors["auth:getClaims"] ?? null
      }),
      signInWithPassword: async ({ email }: { email: string; password: string }) => {
        const error = errors["auth:signInWithPassword"];
        if (error) return { data: { user: null, session: null }, error };
        currentUser ??= { id: "mock-user", email, app_metadata: {}, user_metadata: {} };
        return {
          data: { user: clone(currentUser), session: { user: clone(currentUser) } },
          error: null
        };
      },
      signUp: async ({ email }: { email: string; password: string }) => {
        const error = errors["auth:signUp"];
        if (error) return { data: { user: null, session: null }, error };
        currentUser = { id: "mock-user", email, app_metadata: {}, user_metadata: {} };
        return { data: { user: clone(currentUser), session: null }, error: null };
      },
      signOut: async () => {
        const error = errors["auth:signOut"] ?? null;
        if (!error) currentUser = null;
        return { error };
      }
    },
    from: (table: string) => {
      tables[table] ??= [];
      return new MockQueryBuilder(table, tables[table], errors);
    },
    rpc: async (name: string, params?: MockRow) => {
      const error = errors[`rpc:${name}`];
      if (error) return { data: null, error };
      const configured = options.rpc?.[name];
      const data =
        typeof configured === "function"
          ? await (configured as (input?: MockRow) => unknown)(params)
          : (configured ?? null);
      return { data: clone(data), error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: Uint8Array, uploadOptions?: { upsert?: boolean }) => {
          const error = errors[`storage:${bucket}:upload`];
          if (error) return { data: null, error };
          buckets[bucket] ??= {};
          if (buckets[bucket][path] && !uploadOptions?.upsert) {
            return {
              data: null,
              error: new MockSupabaseError("Duplicate", "Object already exists")
            };
          }
          buckets[bucket][path] = new Uint8Array(file);
          return { data: { path, fullPath: `${bucket}/${path}` }, error: null };
        },
        download: async (path: string) => {
          const error = errors[`storage:${bucket}:download`];
          if (error) return { data: null, error };
          const value = buckets[bucket]?.[path];
          return value
            ? { data: new Uint8Array(value), error: null }
            : { data: null, error: new MockSupabaseError("not_found", "Object not found") };
        },
        remove: async (paths: string[]) => {
          const error = errors[`storage:${bucket}:remove`];
          if (error) return { data: null, error };
          const removed = paths.filter((path) => buckets[bucket]?.[path]);
          for (const path of removed) delete buckets[bucket]?.[path];
          return { data: removed.map((name) => ({ name })), error: null };
        },
        list: async (prefix = "") => ({
          data: Object.keys(buckets[bucket] ?? {})
            .filter((path) => path.startsWith(prefix))
            .map((name) => ({ name })),
          error: errors[`storage:${bucket}:list`] ?? null
        }),
        createSignedUrl: async (path: string, expiresIn: number) => {
          const error = errors[`storage:${bucket}:createSignedUrl`];
          if (error) return { data: null, error };
          if (!buckets[bucket]?.[path]) {
            return { data: null, error: new MockSupabaseError("not_found", "Object not found") };
          }
          return {
            data: {
              signedUrl: `https://mock.supabase.local/storage/${bucket}/${path}?expires=${expiresIn}`
            },
            error: null
          };
        }
      })
    },
    __mock: { tables, buckets }
  };
};
