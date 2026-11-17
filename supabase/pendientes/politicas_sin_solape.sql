-- PENDIENTE (NO aplicada): requiere confirmar DROP POLICY. Elimina el aviso
-- multiple_permissive_policies (perfiles y sucursales: la politica ALL de admin solapa con SELECT).
-- Misma semantica de acceso que hoy.
drop policy perfiles_admin on public.perfiles;
create policy perfiles_admin_insertar on public.perfiles for insert to authenticated
  with check ((select private.es_admin()));
create policy perfiles_admin_actualizar on public.perfiles for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy perfiles_admin_borrar on public.perfiles for delete to authenticated
  using ((select private.es_admin()));

drop policy sucursales_admin on public.sucursales;
create policy sucursales_admin_insertar on public.sucursales for insert to authenticated
  with check ((select private.es_admin()));
create policy sucursales_admin_actualizar on public.sucursales for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy sucursales_admin_borrar on public.sucursales for delete to authenticated
  using ((select private.es_admin()));
