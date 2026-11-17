-- ENVCA migración 4: guias (tarifa, folio automático, RLS por creador), vistas, privilegios.

alter table public.guias
  add column if not exists tarifa_id uuid references public.tarifas (id),
  add column if not exists tarifa_por_kg numeric(10,2);

create index if not exists guias_tarifa_idx on public.guias (tarifa_id);
create index if not exists guias_creada_por_idx on public.guias (creada_por);
create index if not exists guias_sucursal_idx on public.guias (sucursal);
create index if not exists guias_creada_en_idx on public.guias (creada_en);

-- Contador de folios por sucursal (inicializado con el máximo existente)
create table if not exists private.folio_contador (
  sucursal text primary key,
  ultimo int not null default 0
);

insert into private.folio_contador (sucursal, ultimo)
select s.codigo,
       coalesce(max((regexp_match(g.folio, '^' || s.codigo || '-([0-9]+)$'))[1]::int), 0)
from public.sucursales s
left join public.guias g on g.sucursal = s.codigo
group by s.codigo
on conflict (sucursal) do nothing;

create or replace function private.asignar_folio()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  n int;
  f text;
begin
  if coalesce(new.folio, '') <> '' or new.sucursal is null then
    return new;
  end if;
  loop
    insert into private.folio_contador as c (sucursal, ultimo)
    values (new.sucursal, 1)
    on conflict (sucursal) do update set ultimo = c.ultimo + 1
    returning c.ultimo into n;
    f := new.sucursal || '-' || n;
    exit when not exists (select 1 from public.guias g where g.folio = f);
  end loop;
  new.folio := f;
  return new;
end $$;
revoke all on function private.asignar_folio() from public, anon, authenticated;

create or replace trigger guias_folio before insert on public.guias
  for each row execute function private.asignar_folio();

-- Políticas de guias (mismos nombres, nuevos predicados)
alter policy guias_leer on public.guias
  using (
    (select private.es_admin())
    or ((select private.mi_rol()) = 'sucursal'
        and creada_por = (select auth.uid())
        and sucursal = (select private.mi_sucursal()))
  );
alter policy guias_insertar on public.guias
  with check (
    creada_por = (select auth.uid())
    and ((select private.es_admin())
         or ((select private.mi_rol()) = 'sucursal'
             and sucursal = (select private.mi_sucursal())))
  );
alter policy guias_actualizar on public.guias
  using (
    (select private.es_admin())
    or ((select private.mi_rol()) = 'sucursal'
        and creada_por = (select auth.uid())
        and sucursal = (select private.mi_sucursal()))
  )
  with check (
    (select private.es_admin())
    or ((select private.mi_rol()) = 'sucursal'
        and creada_por = (select auth.uid())
        and sucursal = (select private.mi_sucursal()))
  );
alter policy guias_borrar on public.guias
  using ((select private.es_admin()));

-- Vistas con permisos del invocador (RLS de las tablas base aplica)
create or replace view public.v_cierre_diario with (security_invoker = true) as
select
  (g.creada_en at time zone 'America/Mexico_City')::date as fecha,
  g.sucursal,
  g.metodo_pago,
  g.estado_pago,
  count(*)::int as guias,
  coalesce(sum(g.bultos), 0)::bigint as bultos,
  coalesce(sum(g.peso_kg), 0) as peso_kg,
  coalesce(sum(g.pago), 0) as monto
from public.guias g
where not g.anulada
group by 1, 2, 3, 4;

create or replace view public.v_conteos_diarios with (security_invoker = true) as
select
  c.fecha, c.tipo, c.ruta_id, c.localidad_id,
  sum(c.cantidad)::bigint as total,
  count(*)::int as registros
from public.conteos c
group by c.fecha, c.tipo, c.ruta_id, c.localidad_id;

revoke all on public.v_cierre_diario, public.v_conteos_diarios from anon, authenticated;
grant select on public.v_cierre_diario, public.v_conteos_diarios to authenticated;

-- Privilegios de las tablas existentes: nada para anon; authenticated solo CRUD
revoke all on public.sucursales, public.perfiles, public.guias, public.config_guia from anon;
revoke all on public.sucursales, public.perfiles, public.guias, public.config_guia from authenticated;
grant select, insert, update, delete on public.sucursales, public.perfiles,
  public.guias, public.config_guia to authenticated;
