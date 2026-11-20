-- Un administrador normal no puede cambiar rol ni estado de un administrador principal.
create or replace function private.proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  yo uuid := (select auth.uid());
  pierde_admin boolean;
  pierde_principal boolean := false;
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
    if yo is not null and old.super_admin and old.id <> yo and not private.es_super() then
      raise exception 'Solo un administrador principal puede modificar a otro administrador principal' using errcode = '42501';
    end if;
    if yo is not null and old.activo and not new.activo and not private.es_super() then
      raise exception 'Solo un administrador principal puede dar de baja usuarios' using errcode = '42501';
    end if;
    pierde_admin := old.rol = 'administrador' and old.activo
                    and (new.rol <> 'administrador' or not new.activo);
    if old.super_admin and (new.rol <> 'administrador' or not new.activo) then
      new.super_admin := false;   -- al perder el rol o la cuenta, deja de ser principal
      pierde_principal := old.activo;
    end if;
  else
    if yo is not null and old.id = yo then
      raise exception 'No puedes borrar tu propio perfil' using errcode = '42501';
    end if;
    if yo is not null and not private.es_super() then
      raise exception 'Solo un administrador principal puede dar de baja usuarios' using errcode = '42501';
    end if;
    pierde_admin := old.rol = 'administrador' and old.activo;
    pierde_principal := old.super_admin and old.activo;
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

  if pierde_principal then
    if not exists (
      select 1 from public.perfiles p
      where p.super_admin and p.rol = 'administrador' and p.activo and p.id <> old.id
    ) then
      raise exception 'Debe quedar al menos un administrador principal activo' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
