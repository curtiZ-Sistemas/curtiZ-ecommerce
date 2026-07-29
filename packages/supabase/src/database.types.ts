/**
 * Tipos mínimos para permitir o primeiro build sem Docker.
 * Execute `pnpm supabase:types` após iniciar o Supabase local para regenerar este arquivo.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<string, {
      Row: Record<string, unknown>;
      Insert: Record<string, unknown>;
      Update: Record<string, unknown>;
      Relationships: [];
    }>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      app_role: "customer" | "operational" | "admin" | "manager" | "technical";
    };
    CompositeTypes: Record<string, never>;
  };
};
