-- La caja (no administrador) puede corregir sus guías, pero el cobro lo calcula siempre el servidor
-- con la tarifa guardada, y no puede cambiar folio, sucursal, creador ni fecha de creación.
create or replace function private.proteger_guia_caja()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  precio numeric(10,2);
begin
  if private.es_admin() then
    return new;
  end if;

  new.creada_por := old.creada_por;
  new.sucursal := old.sucursal;
  new.folio := old.folio;
  new.creada_en := old.creada_en;

  if new.tarifa_id is distinct from old.tarifa_id then
    if new.tarifa_id is null then
      precio := null;
    else
      select t.precio_por_kg into precio from public.tarifas t where t.id = new.tarifa_id;
      if not found then
        raise exception 'La tarifa seleccionada no existe' using errcode = '23503';
      end if;
    end if;
  else
    precio := old.tarifa_por_kg;
  end if;

  new.tarifa_por_kg := precio;
  if precio is not null then
    if new.peso_kg is null or new.peso_kg <= 0 then
      raise exception 'El peso debe ser mayor a cero para calcular el cobro' using errcode = '23514';
    end if;
    new.pago := round(new.peso_kg * precio, 2);
  else
    new.pago := old.pago;
  end if;

  return new;
end;
$$;

drop trigger if exists guias_proteger_caja on public.guias;
create trigger guias_proteger_caja
  before update on public.guias
  for each row execute function private.proteger_guia_caja();
