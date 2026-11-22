-- Zakres prac zaznaczony na rysunku auta: element nadwozia i co przy nim zrobić. Bez kwot: widzą wszyscy.
create table zlecenia_elementy (
  zlecenie_id uuid not null references zlecenia (id) on delete cascade,
  element     text not null,     -- np. maska, drzwi_przednie_l
  czynnosci   text[] not null check (czynnosci <@ array['wymiana', 'blacharka', 'lakierowanie', 'cieniowanie', 'polerowanie']::text[] and cardinality(czynnosci) > 0),
  uwagi       text,
  zmieniono   timestamptz not null default now(),
  primary key (zlecenie_id, element)
);
alter table zlecenia_elementy enable row level security;
create policy zlecenia_elementy_uzytkownicy on zlecenia_elementy for all using (jest_uzytkownikiem()) with check (jest_uzytkownikiem());
grant select, insert, update, delete on zlecenia_elementy to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on zlecenia_elementy from anon; end if;
end $$;
create trigger zlecenia_elementy_rejestr after insert or update or delete on zlecenia_elementy
  for each row execute function zapisz_zmiane();
