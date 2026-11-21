-- Nowe projekty Supabase nie nadają rolom API uprawnień do tabel automatycznie.
-- Nadajemy je jawnie; o tym, co kto widzi, nadal decyduje RLS.
-- anon (niezalogowany) nie dostaje nic.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
  revoke truncate, references, trigger on all tables in schema public from authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on all tables in schema public to service_role;
    grant usage, select on all sequences in schema public to service_role;
    grant execute on function kandydaci_dopasowania() to service_role;
    grant execute on function zapisz_fakture_ksef(jsonb) to service_role;
  end if;
end $$;
