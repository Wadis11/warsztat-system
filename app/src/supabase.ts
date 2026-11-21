import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KLUCZ_PUBLICZNY, SUPABASE_URL } from "./konfiguracja.ts";

export const db = createClient(SUPABASE_URL, SUPABASE_KLUCZ_PUBLICZNY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const zl = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " zł";

export const normRej = (t: string | null | undefined) => (t ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
