-- Tamaño de la guía editable desde la app (solo administrador) y sellado de quién/cuándo la cambió.
alter table public.config_guia
  add column if not exists ancho_mm numeric(6,2) not null default 101.60 check (ancho_mm between 50 and 300),
  add column if not exists alto_mm numeric(6,2) not null default 152.40 check (alto_mm between 50 and 300);

create or replace function private.sellar_config_guia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists config_guia_sellar on public.config_guia;
create trigger config_guia_sellar
  before update on public.config_guia
  for each row execute function private.sellar_config_guia();
