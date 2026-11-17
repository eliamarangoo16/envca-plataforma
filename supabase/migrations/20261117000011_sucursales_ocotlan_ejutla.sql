-- Alta de las sucursales Ocotlán (OCO) y Ejutla (EJU).
insert into public.sucursales (codigo, nombre, ciudad, activa) values
  ('OCO', 'Ocotlán de Morelos, Oaxaca', 'Ocotlán', true),
  ('EJU', 'Ejutla de Crespo, Oaxaca', 'Ejutla', true)
on conflict (codigo) do nothing;
