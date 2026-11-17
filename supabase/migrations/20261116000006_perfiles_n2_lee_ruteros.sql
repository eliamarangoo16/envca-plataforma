-- El administrador nivel 2 necesita ver el nombre del rutero en los conteos.
create policy perfiles_n2_lee_ruteros on public.perfiles for select to authenticated
  using ((select private.mi_rol()) = 'admin_n2' and rol = 'rutero');
