-- ENVCA migración 8: bitácora de guías (quién creó, anuló, modificó o borró cada guía y qué cambió).
-- Solo administradores nivel 1 leen la bitácora. Nadie la escribe desde la app: la escribe un trigger.

create table if not exists public.guias_bitacora (
  id bigint generated always as identity primary key,
  -- Sin llave foránea a guias: la bitácora debe sobrevivir a un borrado de la guía.
  guia_id uuid not null,
  folio text not null,
  accion text not null check (accion in ('creada', 'modificada', 'anulada', 'borrada')),
  usuario_id uuid references auth.users (id) on delete set null,
  rol text,
  cambios jsonb not null default '{}'::jsonb,
  creada_en timestamptz not null default now()
);

create index if not exists guias_bitacora_guia_idx on public.guias_bitacora (guia_id, creada_en);
create index if not exists guias_bitacora_creada_idx on public.guias_bitacora (creada_en);
create index if not exists guias_bitacora_usuario_idx on public.guias_bitacora (usuario_id);

alter table public.guias_bitacora enable row level security;
revoke all on public.guias_bitacora from anon, authenticated;
grant select on public.guias_bitacora to authenticated;

create policy guias_bitacora_leer on public.guias_bitacora for select to authenticated
  using ((select private.es_admin()));
-- Sin políticas de escritura: solo el trigger (SECURITY DEFINER) inserta.

create or replace function private.registrar_bitacora_guia()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  quien uuid := (select auth.uid());
  rol_actual text := (select private.mi_rol());
  accion text;
  cambios jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    accion := 'creada';
    cambios := jsonb_build_object(
      'sucursal', jsonb_build_object('despues', new.sucursal),
      'pago', jsonb_build_object('despues', new.pago),
      'peso_kg', jsonb_build_object('despues', new.peso_kg),
      'metodo_pago', jsonb_build_object('despues', new.metodo_pago),
      'estado_pago', jsonb_build_object('despues', new.estado_pago),
      'tarifa_por_kg', jsonb_build_object('despues', new.tarifa_por_kg)
    );
    insert into public.guias_bitacora (guia_id, folio, accion, usuario_id, rol, cambios)
    values (new.id, new.folio, accion, quien, rol_actual, cambios);

  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, jsonb_build_object('antes', o.value, 'despues', n.value)), '{}'::jsonb)
      into cambios
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
    where o.value is distinct from n.value
      and o.key <> 'modificada_en';

    if cambios = '{}'::jsonb then
      return null;  -- actualización sin cambios reales (p. ej. la misma fila reenviada)
    end if;

    accion := case when new.anulada and not coalesce(old.anulada, false) then 'anulada' else 'modificada' end;
    insert into public.guias_bitacora (guia_id, folio, accion, usuario_id, rol, cambios)
    values (new.id, new.folio, accion, quien, rol_actual, cambios);

  elsif tg_op = 'DELETE' then
    insert into public.guias_bitacora (guia_id, folio, accion, usuario_id, rol, cambios)
    values (old.id, old.folio, 'borrada', quien, rol_actual,
            jsonb_build_object('pago', jsonb_build_object('antes', old.pago),
                               'sucursal', jsonb_build_object('antes', old.sucursal)));
  end if;
  return null;
end $$;
revoke all on function private.registrar_bitacora_guia() from public, anon, authenticated;

create or replace trigger guias_bitacora_trg
  after insert or update or delete on public.guias
  for each row execute function private.registrar_bitacora_guia();
