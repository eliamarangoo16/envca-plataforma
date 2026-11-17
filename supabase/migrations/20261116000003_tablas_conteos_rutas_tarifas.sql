-- ENVCA migración 3: localidades, rutas, conteos, tarifas + RLS.

create table if not exists public.localidades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  municipio text,
  referencia text,
  tiene_punto_recepcion boolean not null default false,
  activa boolean not null default true,
  creada_por uuid default auth.uid() references auth.users (id) on delete set null,
  creada_en timestamptz default now()
);

create table if not exists public.rutas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean default true,
  creada_en timestamptz default now()
);

create table if not exists public.ruta_localidades (
  ruta_id uuid not null references public.rutas (id) on delete cascade,
  localidad_id uuid not null references public.localidades (id) on delete cascade,
  dia_semana smallint check (dia_semana between 0 and 6),
  orden int default 0,
  primary key (ruta_id, localidad_id)
);

create table if not exists public.ruta_ruteros (
  ruta_id uuid not null references public.rutas (id) on delete cascade,
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  primary key (ruta_id, usuario_id)
);

create table if not exists public.conteos (
  id uuid primary key,
  tipo text not null check (tipo in ('recepcion','salida')),
  fecha date not null,
  ruta_id uuid references public.rutas (id),
  localidad_id uuid not null references public.localidades (id),
  cantidad int not null check (cantidad >= 0),
  notas text,
  usuario_id uuid not null default auth.uid() references auth.users (id),
  capturado_en timestamptz,
  creado_en timestamptz not null default now(),
  check (tipo <> 'recepcion' or ruta_id is not null)
);

create table if not exists public.tarifas (
  id uuid primary key default gen_random_uuid(),
  destino text not null unique,
  precio_por_kg numeric(10,2) check (precio_por_kg > 0),
  moneda text not null default 'MXN',
  activa boolean default true,
  actualizada_en timestamptz default now(),
  actualizada_por uuid references auth.users (id) on delete set null
);

-- Índices en FKs y filtros frecuentes
create index if not exists localidades_creada_por_idx on public.localidades (creada_por);
create index if not exists ruta_localidades_localidad_idx on public.ruta_localidades (localidad_id);
create index if not exists ruta_ruteros_usuario_idx on public.ruta_ruteros (usuario_id);
create index if not exists conteos_ruta_idx on public.conteos (ruta_id);
create index if not exists conteos_localidad_idx on public.conteos (localidad_id);
create index if not exists conteos_usuario_fecha_idx on public.conteos (usuario_id, fecha);
create index if not exists conteos_fecha_idx on public.conteos (fecha);
create index if not exists tarifas_actualizada_por_idx on public.tarifas (actualizada_por);

-- Trigger de tarifas: fija actualizada_en / actualizada_por
create or replace function private.fijar_actualizacion_tarifa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizada_en := now();
  new.actualizada_por := (select auth.uid());
  return new;
end $$;
revoke all on function private.fijar_actualizacion_tarifa() from public, anon, authenticated;

create or replace trigger tarifas_actualizacion before insert or update on public.tarifas
  for each row execute function private.fijar_actualizacion_tarifa();

-- Privilegios: nada para anon; authenticated solo CRUD (RLS decide filas)
alter table public.localidades enable row level security;
alter table public.rutas enable row level security;
alter table public.ruta_localidades enable row level security;
alter table public.ruta_ruteros enable row level security;
alter table public.conteos enable row level security;
alter table public.tarifas enable row level security;

revoke all on public.localidades, public.rutas, public.ruta_localidades,
  public.ruta_ruteros, public.conteos, public.tarifas from anon, authenticated;
grant select, insert, update, delete on public.localidades, public.rutas,
  public.ruta_localidades, public.ruta_ruteros, public.conteos, public.tarifas to authenticated;

-- localidades
create policy localidades_leer on public.localidades for select to authenticated
  using ((select private.mi_rol()) is not null);
create policy localidades_insertar on public.localidades for insert to authenticated
  with check ((select private.mi_rol()) in ('administrador','rutero')
              and creada_por = (select auth.uid()));
create policy localidades_actualizar on public.localidades for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy localidades_borrar on public.localidades for delete to authenticated
  using ((select private.es_admin()));

-- rutas
create policy rutas_leer on public.rutas for select to authenticated
  using ((select private.mi_rol()) in ('administrador','admin_n2','rutero'));
create policy rutas_insertar on public.rutas for insert to authenticated
  with check ((select private.es_admin()));
create policy rutas_actualizar on public.rutas for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy rutas_borrar on public.rutas for delete to authenticated
  using ((select private.es_admin()));

-- ruta_localidades
create policy ruta_localidades_leer on public.ruta_localidades for select to authenticated
  using ((select private.mi_rol()) in ('administrador','admin_n2','rutero'));
create policy ruta_localidades_insertar on public.ruta_localidades for insert to authenticated
  with check (
    (select private.es_admin())
    or ((select private.mi_rol()) = 'rutero' and exists (
          select 1 from public.ruta_ruteros rr
          where rr.ruta_id = ruta_localidades.ruta_id
            and rr.usuario_id = (select auth.uid())))
  );
create policy ruta_localidades_actualizar on public.ruta_localidades for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy ruta_localidades_borrar on public.ruta_localidades for delete to authenticated
  using ((select private.es_admin()));

-- ruta_ruteros
create policy ruta_ruteros_leer on public.ruta_ruteros for select to authenticated
  using ((select private.mi_rol()) in ('administrador','admin_n2')
         or (usuario_id = (select auth.uid()) and (select private.mi_rol()) is not null));
create policy ruta_ruteros_insertar on public.ruta_ruteros for insert to authenticated
  with check ((select private.es_admin()));
create policy ruta_ruteros_actualizar on public.ruta_ruteros for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy ruta_ruteros_borrar on public.ruta_ruteros for delete to authenticated
  using ((select private.es_admin()));

-- conteos
create policy conteos_leer on public.conteos for select to authenticated
  using ((select private.mi_rol()) in ('administrador','admin_n2')
         or ((select private.mi_rol()) = 'rutero' and usuario_id = (select auth.uid())));
create policy conteos_insertar on public.conteos for insert to authenticated
  with check ((select private.mi_rol()) in ('administrador','rutero')
              and usuario_id = (select auth.uid()));
create policy conteos_actualizar on public.conteos for update to authenticated
  using (
    (select private.es_admin())
    or ((select private.mi_rol()) = 'rutero' and usuario_id = (select auth.uid())
        and fecha >= (((now() at time zone 'America/Mexico_City')::date) - 1))
  )
  with check (
    (select private.es_admin())
    or ((select private.mi_rol()) = 'rutero' and usuario_id = (select auth.uid())
        and fecha >= (((now() at time zone 'America/Mexico_City')::date) - 1))
  );
create policy conteos_borrar on public.conteos for delete to authenticated
  using ((select private.es_admin()));

-- tarifas (admin_n2 y rutero: sin acceso)
create policy tarifas_leer on public.tarifas for select to authenticated
  using ((select private.mi_rol()) in ('administrador','sucursal'));
create policy tarifas_insertar on public.tarifas for insert to authenticated
  with check ((select private.es_admin()));
create policy tarifas_actualizar on public.tarifas for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy tarifas_borrar on public.tarifas for delete to authenticated
  using ((select private.es_admin()));

-- Semilla de tarifas
insert into public.tarifas (destino, precio_por_kg)
values ('San José', 240), ('Seaside', 240)
on conflict (destino) do nothing;
