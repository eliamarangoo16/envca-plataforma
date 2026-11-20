-- Administradores principales: solo ellos dan de baja usuarios, cambian el contenido del formato
-- de guías y ven la bitácora de tarifas. El tamaño de impresión queda libre para todo nivel 1.
alter table public.perfiles add column if not exists super_admin boolean not null default false;

update public.perfiles set super_admin = true
where id in ('9ecd21ad-5d60-477e-b96e-74c468a45019',  -- Eliam Arango
             '3d492532-2424-427d-99d8-8c5d62da8e89',  -- Maile Laura
             'e7d1a58e-9a3f-4285-9ba6-4f3388021fef'); -- Francisco Arango Echeverria

create or replace function private.es_super()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.rol = 'administrador' and p.activo and p.super_admin
  );
$$;
revoke all on function private.es_super() from public, anon;
grant execute on function private.es_super() to authenticated;

-- Perfiles: nadie cambia super_admin por la API; solo un principal da de baja o borra usuarios.
create or replace function private.proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  pierde_admin boolean;
begin
  if tg_op = 'INSERT' then
    if yo is not null and new.super_admin then
      raise exception 'No se puede asignar administrador principal desde la aplicación' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if yo is not null and new.super_admin is distinct from old.super_admin then
      raise exception 'No se puede cambiar el administrador principal desde la aplicación' using errcode = '42501';
    end if;
    if yo is not null and old.id = yo
       and (new.rol is distinct from old.rol or new.activo is distinct from old.activo) then
      raise exception 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta'
        using errcode = '42501';
    end if;
    if yo is not null and old.activo and not new.activo and not private.es_super() then
      raise exception 'Solo un administrador principal puede dar de baja usuarios' using errcode = '42501';
    end if;
    pierde_admin := old.rol = 'administrador' and old.activo
                    and (new.rol <> 'administrador' or not new.activo);
  else
    if yo is not null and old.id = yo then
      raise exception 'No puedes borrar tu propio perfil' using errcode = '42501';
    end if;
    if yo is not null and not private.es_super() then
      raise exception 'Solo un administrador principal puede dar de baja usuarios' using errcode = '42501';
    end if;
    pierde_admin := old.rol = 'administrador' and old.activo;
  end if;

  if pierde_admin then
    perform pg_advisory_xact_lock(hashtext('envca_admins_activos'));
    if not exists (
      select 1 from public.perfiles p
      where p.rol = 'administrador' and p.activo and p.id <> old.id
    ) then
      raise exception 'Debe quedar al menos un administrador nivel 1 activo'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists perfiles_proteger on public.perfiles;
create trigger perfiles_proteger
  before insert or update or delete on public.perfiles
  for each row execute function private.proteger_perfil();

-- Formato de guías: contenido (encabezado, logotipo, nota) solo principales; tamaño libre para nivel 1.
create or replace function private.proteger_config_guia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.es_super()
     and (new.encabezado is distinct from old.encabezado or new.nota is distinct from old.nota) then
    raise exception 'Solo un administrador principal puede cambiar el contenido del formato de guías'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.proteger_config_guia() from public, anon;

drop trigger if exists config_guia_proteger on public.config_guia;
create trigger config_guia_proteger
  before update on public.config_guia
  for each row execute function private.proteger_config_guia();

-- Bitácora de tarifas (solo administradores principales la leen).
create table if not exists public.tarifas_bitacora (
  id bigint generated always as identity primary key,
  tarifa_id uuid,
  destino text,
  accion text not null check (accion in ('creada','modificada','borrada')),
  usuario_id uuid,
  cambios jsonb,
  creada_en timestamptz not null default now()
);
create index if not exists tarifas_bitacora_creada_idx on public.tarifas_bitacora (creada_en desc, id desc);
alter table public.tarifas_bitacora enable row level security;
revoke all on public.tarifas_bitacora from anon, authenticated;
grant select on public.tarifas_bitacora to authenticated;
drop policy if exists tarifas_bitacora_leer on public.tarifas_bitacora;
create policy tarifas_bitacora_leer on public.tarifas_bitacora
  for select to authenticated using ((select private.es_super()));

create or replace function private.registrar_bitacora_tarifa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := '{}'::jsonb;
  k text;
  o jsonb;
  n jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.tarifas_bitacora (tarifa_id, destino, accion, usuario_id, cambios)
    values (new.id, new.destino, 'creada', (select auth.uid()),
            jsonb_build_object('precio_por_kg', jsonb_build_object('despues', new.precio_por_kg),
                               'activa', jsonb_build_object('despues', new.activa)));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.tarifas_bitacora (tarifa_id, destino, accion, usuario_id, cambios)
    values (old.id, old.destino, 'borrada', (select auth.uid()),
            jsonb_build_object('precio_por_kg', jsonb_build_object('antes', old.precio_por_kg)));
    return old;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  foreach k in array array['destino','precio_por_kg','moneda','activa'] loop
    if o->k is distinct from n->k then
      c := c || jsonb_build_object(k, jsonb_build_object('antes', o->k, 'despues', n->k));
    end if;
  end loop;
  if c <> '{}'::jsonb then
    insert into public.tarifas_bitacora (tarifa_id, destino, accion, usuario_id, cambios)
    values (new.id, new.destino, 'modificada', (select auth.uid()), c);
  end if;
  return new;
end $$;
revoke all on function private.registrar_bitacora_tarifa() from public, anon;

drop trigger if exists tarifas_bitacora_trg on public.tarifas;
create trigger tarifas_bitacora_trg
  after insert or update or delete on public.tarifas
  for each row execute function private.registrar_bitacora_tarifa();
