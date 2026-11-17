-- Pruebas RLS parte B (UPDATE/DELETE). Se revierte siempre: termina con una excepcion deliberada.
-- Ejecutar en el SQL editor o con execute_sql (requiere confirmar sentencias UPDATE/DELETE).
-- El texto de la excepcion (REPORTE_PRUEBAS_B) lista PASS/FAIL por prueba.
do $$
declare
  rep text := '';
  n int; ok boolean; vu uuid;
  uadm uuid := gen_random_uuid(); un2 uuid := gen_random_uuid(); ur1 uuid := gen_random_uuid(); ur2 uuid := gen_random_uuid();
  uc1 uuid := gen_random_uuid(); uc2 uuid := gen_random_uuid();
  rta uuid := gen_random_uuid(); rtb uuid := gen_random_uuid();
  l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  hoy date := (now() at time zone 'America/Mexico_City')::date;
begin
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', u::text || '@test.local' from unnest(array[uadm,un2,ur1,ur2,uc1,uc2]) u;
  insert into public.perfiles (id,nombre,rol,sucursal,activo) values
    (uadm,'t_adm','administrador',null,true),(un2,'t_n2','admin_n2',null,true),(ur1,'t_r1','rutero',null,true),
    (ur2,'t_r2','rutero',null,true),(uc1,'t_c1','sucursal','SPH',true),(uc2,'t_c2','sucursal','SPH',true);
  insert into public.rutas (id,nombre) values (rta,'t_rutaA'),(rtb,'t_rutaB');
  insert into public.localidades (id,nombre,creada_por) values (l1,'t_l1',uadm),(l2,'t_l2',uadm);
  insert into public.conteos (id,tipo,fecha,ruta_id,localidad_id,cantidad,usuario_id) values
    (c1,'recepcion',hoy,rta,l1,5,ur1),(c2,'recepcion',hoy,rtb,l2,7,ur2),(c3,'salida',hoy-3,null,l1,2,ur1);
  insert into public.guias (sucursal,creada_por,pago) values ('SPH',uc1,240),('SPH',uc2,100);

  perform set_config('request.jwt.claims', json_build_object('sub',ur1,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.conteos set cantidad=9 where id=c1; get diagnostics n = row_count;
  rep := rep || case when n=1 then 'PASS' else 'FAIL' end || ' rutero edita propio de hoy filas=' || n || E'\n';
  update public.conteos set cantidad=9 where id=c3; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' rutero NO edita propio de hace 3 dias filas=' || n || E'\n';
  begin update public.conteos set fecha=hoy-5 where id=c1; get diagnostics n = row_count; ok := (n=0);
  exception when others then ok := (sqlstate='42501'); end;
  rep := rep || case when ok then 'PASS' else 'FAIL' end || ' rutero no mueve registro a fecha antigua (WITH CHECK)' || E'\n';
  update public.conteos set fecha=hoy-1 where id=c1; get diagnostics n = row_count;
  rep := rep || case when n=1 then 'PASS' else 'FAIL' end || ' rutero mueve a ayer filas=' || n || E'\n';
  begin update public.conteos set usuario_id=ur2 where id=c1; get diagnostics n = row_count; ok := (n=0);
  exception when others then ok := (sqlstate='42501'); end;
  rep := rep || case when ok then 'PASS' else 'FAIL' end || ' rutero no reasigna conteo a otro usuario' || E'\n';
  update public.conteos set cantidad=99 where id=c2; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' rutero no edita ajeno filas=' || n || E'\n';
  update public.localidades set nombre='hack' where id=l1; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' rutero no edita localidades filas=' || n || E'\n';
  delete from public.conteos where id=c1; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' rutero no borra conteos filas=' || n || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',un2,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.conteos set cantidad=99 where id=c1; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' n2 no edita conteos filas=' || n || E'\n';
  delete from public.conteos where id=c2; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' n2 no borra conteos filas=' || n || E'\n';
  update public.tarifas set precio_por_kg=1 where destino='Seaside'; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' n2 no edita tarifas filas=' || n || E'\n';
  update public.guias set notas='hack' where sucursal='SPH'; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' n2 no edita guias filas=' || n || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uc1,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.guias set notas='hack' where creada_por=uc2; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' caja no edita guias ajenas filas=' || n || E'\n';
  update public.guias set notas='ok' where creada_por=uc1; get diagnostics n = row_count;
  rep := rep || case when n=1 then 'PASS' else 'FAIL' end || ' caja edita las suyas filas=' || n || E'\n';
  begin update public.guias set creada_por=uc2 where creada_por=uc1; get diagnostics n=row_count; ok:=false; exception when others then ok := (sqlstate='42501'); end;
  rep := rep || case when ok then 'PASS' else 'FAIL' end || ' caja no reasigna guia a otro (WITH CHECK)' || E'\n';
  delete from public.guias where creada_por=uc1; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' caja no borra guias filas=' || n || E'\n';
  update public.tarifas set precio_por_kg=1 where destino='Seaside'; get diagnostics n = row_count;
  rep := rep || case when n=0 then 'PASS' else 'FAIL' end || ' caja no edita tarifas filas=' || n || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uadm,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.tarifas set precio_por_kg=250 where destino='Seaside'; get diagnostics n = row_count;
  select actualizada_por into vu from public.tarifas where destino='Seaside';
  rep := rep || case when n=1 and vu=uadm then 'PASS' else 'FAIL' end || ' admin edita tarifa y trigger fija actualizada_por' || E'\n';
  update public.conteos set cantidad=1 where id=c2; get diagnostics n = row_count;
  rep := rep || case when n=1 then 'PASS' else 'FAIL' end || ' admin edita conteo ajeno' || E'\n';
  update public.guias set anulada=true where creada_por=uc2; get diagnostics n = row_count;
  rep := rep || case when n=1 then 'PASS' else 'FAIL' end || ' admin anula guia ajena' || E'\n';
  delete from public.conteos where id=c3; get diagnostics n = row_count;
  rep := rep || case when n=1 then 'PASS' else 'FAIL' end || ' admin borra conteo' || E'\n';
  execute 'reset role';

  raise exception E'REPORTE_PRUEBAS_B\n%', rep;
end $$;
