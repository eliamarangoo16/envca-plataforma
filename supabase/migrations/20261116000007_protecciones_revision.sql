-- ENVCA migración 7: protecciones derivadas de la revisión de código.

-- 1) perfiles: nadie cambia su propio rol/estado y siempre queda un administrador activo.
create or replace function private.proteger_perfil()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  pierde_admin boolean;
begin
  if tg_op = 'UPDATE' then
    if yo is not null and old.id = yo
       and (new.rol is distinct from old.rol or new.activo is distinct from old.activo) then
      raise exception 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta'
        using errcode = '42501';
    end if;
    pierde_admin := old.rol = 'administrador' and old.activo
                    and (new.rol <> 'administrador' or not new.activo);
  else
    if yo is not null and old.id = yo then
      raise exception 'No puedes borrar tu propio perfil' using errcode = '42501';
    end if;
    pierde_admin := old.rol = 'administrador' and old.activo;
  end if;

  if pierde_admin then
    -- Serializa cambios concurrentes de administradores.
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
revoke all on function private.proteger_perfil() from public, anon, authenticated;

create or replace trigger perfiles_proteger
  before update or delete on public.perfiles
  for each row execute function private.proteger_perfil();

-- 2) guias: al crear una guía con tarifa, la base fija el precio por kg y el monto.
--    (Las guías sin tarifa_id, p. ej. de la página anterior, no cambian.)
create or replace function private.fijar_cobro_guia()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  precio numeric(10,2);
begin
  if new.tarifa_id is null then
    return new;
  end if;
  select t.precio_por_kg into precio from public.tarifas t where t.id = new.tarifa_id;
  if not found then
    raise exception 'La tarifa seleccionada no existe' using errcode = '23503';
  end if;
  new.tarifa_por_kg := precio;
  if precio is not null then
    if new.peso_kg is null or new.peso_kg <= 0 then
      raise exception 'El peso debe ser mayor a cero para calcular el cobro'
        using errcode = '23514';
    end if;
    new.pago := round(new.peso_kg * precio, 2);
  end if;
  return new;
end $$;
revoke all on function private.fijar_cobro_guia() from public, anon, authenticated;

create or replace trigger guias_cobro
  before insert on public.guias
  for each row execute function private.fijar_cobro_guia();

-- 3) conteos: el rutero no puede registrar fechas futuras ni de hace más de 30 días
--    (30 días da margen a quien estuvo varios días sin señal).
alter policy conteos_insertar on public.conteos
  with check (
    usuario_id = (select auth.uid())
    and (
      (select private.es_admin())
      or ((select private.mi_rol()) = 'rutero'
          and fecha <= ((now() at time zone 'America/Mexico_City')::date + 1)
          and fecha >= ((now() at time zone 'America/Mexico_City')::date - 30))
    )
  );
