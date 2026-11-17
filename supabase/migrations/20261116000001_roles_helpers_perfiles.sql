-- ENVCA migración 1 (aplicada como "roles_helpers_perfiles"): helpers privados, perfiles.activo,
-- funciones públicas como envoltorios, predicados de políticas existentes con helpers.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.perfiles add column if not exists activo boolean not null default true;

create index if not exists perfiles_sucursal_idx on public.perfiles (sucursal);

create or replace function private.mi_rol()
returns text
language sql stable security definer
set search_path = ''
as $$
  select p.rol from public.perfiles p
  where p.id = (select auth.uid()) and p.activo
$$;

create or replace function private.es_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.activo and p.rol = 'administrador'
  )
$$;

create or replace function private.mi_sucursal()
returns text
language sql stable security definer
set search_path = ''
as $$
  select p.sucursal from public.perfiles p
  where p.id = (select auth.uid()) and p.activo
$$;

revoke all on function private.mi_rol(), private.es_admin(), private.mi_sucursal() from public, anon;
grant execute on function private.mi_rol(), private.es_admin(), private.mi_sucursal() to authenticated;

create or replace function public.es_admin()
returns boolean language sql stable security invoker
set search_path = ''
as $$ select private.es_admin() $$;

create or replace function public.mi_sucursal()
returns text language sql stable security invoker
set search_path = ''
as $$ select private.mi_sucursal() $$;

revoke all on function public.es_admin(), public.mi_sucursal() from public, anon;
grant execute on function public.es_admin(), public.mi_sucursal() to authenticated;

revoke all on function public.tocar_modificada() from public, anon, authenticated;

alter policy perfiles_leer on public.perfiles
  using (id = (select auth.uid()) or (select private.es_admin()));
alter policy perfiles_admin on public.perfiles
  using ((select private.es_admin())) with check ((select private.es_admin()));

alter policy sucursales_leer on public.sucursales
  using ((select private.mi_rol()) is not null);
alter policy sucursales_admin on public.sucursales
  using ((select private.es_admin())) with check ((select private.es_admin()));

alter policy config_leer on public.config_guia
  using ((select private.mi_rol()) is not null);
alter policy config_admin_editar on public.config_guia
  using ((select private.es_admin())) with check ((select private.es_admin()));
