-- ENVCA migración 2 (aplicada como "perfiles_roles_nuevos_checks").
-- Reemplaza los checks: el anterior perfiles_check exigía sucursal a todo rol != administrador.
alter table public.perfiles drop constraint perfiles_rol_check;
alter table public.perfiles drop constraint perfiles_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('administrador','admin_n2','rutero','sucursal'));
alter table public.perfiles add constraint perfiles_sucursal_requerida
  check (rol <> 'sucursal' or sucursal is not null);
