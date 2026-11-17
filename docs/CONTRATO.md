# ENVCA — Contrato técnico (Fase 1 operación + Fase 2 finanzas)

Fuente de verdad para base de datos, función edge y frontend. Si algo aquí es
imposible o inseguro, NO improvises en silencio: repórtalo en tu informe final.

## 0. Contexto
- Empresa: ENVCA (paquetería Oaxaca → EE. UU.). Idioma de toda la UI: español (México).
- Supabase project_id: `axyzkxannqpyxlxehaoc` — URL `https://axyzkxannqpyxlxehaoc.supabase.co`
- Clave publicable (frontend): `sb_publishable_8stpdoWnMvxl2Rx8cpBMbA_9mk0_MUD`
- NUNCA poner service_role / secret key en el frontend ni en archivos del repo.
- Zona horaria de negocio: `America/Mexico_City`.

## 1. Estado EXISTENTE de la base (hay datos reales: NO borrar ni alterar filas)
Tablas public (RLS activo en todas):
- `sucursales(codigo text pk, nombre, ciudad, activa)` — filas: SPH (matriz San Pablo Huixtepec), SEA (Seaside).
- `perfiles(id uuid pk → auth.users, nombre, sucursal → sucursales.codigo, rol text check in ('administrador','sucursal') default 'sucursal')` — 3 filas (2 administrador, 1 sucursal:SPH).
- `guias(id uuid pk default gen_random_uuid(), folio text unique not null, sucursal not null → sucursales, creada_por → auth.users, creada_en, modificada_en, anulada bool, fecha_recepcion timestamp, fecha_envio date, remitente, remitente_telefono, remitente_id, remitente_municipio, remitente_direccion, destinatario, destinatario_telefonos, direccion_eeuu, ciudad, estado, zip, contenido, bultos int, peso_kg numeric, valor_declarado_mxn numeric, perecedero bool, pago numeric, moneda, estado_pago, metodo_pago, recibe, punto_recepcion, notas)` — 1 fila (folio 'SPH-2', metodo_pago 'Efectivo', estado_pago 'Por cobrar en destino', moneda 'MXN').
- `config_guia(id int =1, encabezado jsonb {name,l1,slogan,phones,rfc,titular,logo}, nota text, ...)` — 1 fila.
Funciones public: `es_admin()` (SECURITY DEFINER, rol='administrador'), `mi_sucursal()` (SECURITY DEFINER), `tocar_modificada()` trigger.
Políticas actuales: sucursales/config_guia lectura a authenticated, escritura es_admin(); perfiles lectura propia o admin, escritura admin; guias leer/actualizar `sucursal = mi_sucursal() or es_admin()`, insertar `sucursal = mi_sucursal() and creada_por = auth.uid()`, borrar es_admin().
`anon` tiene GRANT completo sobre las 4 tablas (a revocar).

## 2. Roles (columna `perfiles.rol`)
| valor | nombre en UI | alcance |
|---|---|---|
| `administrador` | Administrador nivel 1 | TODO: conteos, guías/cobros, tarifas, cierres, KPIs, catálogos, usuarios |
| `admin_n2` | Administrador nivel 2 | SOLO recepción: conteos por ruta y salidas por localidad; lectura de localidades y rutas. NO ve guías, cobros, tarifas ni datos de paquetes |
| `rutero` | Rutero | captura conteos (recepción por ruta+localidad, salida por localidad); puede crear localidades nuevas marcando si tienen punto de recepción; ve solo sus conteos |
| `sucursal` | Agente de caja | registra guía = cobro por peso + datos del paquete; ve solo las guías que él creó; ve tarifas |
Nueva columna `perfiles.activo boolean not null default true`. Usuario inactivo = sin acceso a nada.
Regla: rol `sucursal` requiere `sucursal` no nulo.

## 3. Cambios de base de datos (migración ADITIVA, idempotente donde se pueda)
Esquema `private` (no expuesto) para helpers SECURITY DEFINER con `set search_path = ''`:
- `private.mi_rol() returns text` → rol del usuario si `activo`, si no NULL.
- Actualizar `public.es_admin()` y `public.mi_sucursal()` para exigir `activo` (mantener firma; siguen sin EXECUTE para anon).
- Dar `usage` en `private` y `execute` de los helpers solo a `authenticated`.

Tablas nuevas (todas con RLS, GRANT solo a `authenticated`, nada a `anon`; índices en FKs):
```
localidades(id uuid pk default gen_random_uuid(),  -- el cliente puede mandar el id (offline)
  nombre text not null, municipio text, referencia text,
  tiene_punto_recepcion boolean not null default false,
  activa boolean not null default true,
  creada_por uuid default auth.uid() references auth.users, creada_en timestamptz default now())
rutas(id uuid pk default gen_random_uuid(), nombre text not null, activa boolean default true, creada_en timestamptz default now())
ruta_localidades(ruta_id → rutas on delete cascade, localidad_id → localidades on delete cascade,
  dia_semana smallint null check 0..6 (0=domingo), orden int default 0, primary key(ruta_id, localidad_id))
ruta_ruteros(ruta_id → rutas on delete cascade, usuario_id uuid → perfiles(id) on delete cascade, primary key(ruta_id, usuario_id))
conteos(id uuid pk,                      -- SIEMPRE generado en el cliente (idempotencia offline)
  tipo text not null check in ('recepcion','salida'),
  fecha date not null, ruta_id uuid null → rutas, localidad_id uuid not null → localidades,
  cantidad int not null check (cantidad >= 0), notas text,
  usuario_id uuid not null default auth.uid() → auth.users,
  capturado_en timestamptz, creado_en timestamptz not null default now(),
  check (tipo <> 'recepcion' or ruta_id is not null))
tarifas(id uuid pk default gen_random_uuid(), destino text not null unique,
  precio_por_kg numeric(10,2) null check (precio_por_kg > 0),   -- null = "por definir"
  moneda text not null default 'MXN', activa boolean default true,
  actualizada_en timestamptz default now(), actualizada_por uuid → auth.users)
```
Semilla tarifas: ('San José', 240), ('Seaside', 240). (Son destinos en EE. UU.; MXN por kg.)
`guias`: agregar `tarifa_id uuid null → tarifas`, `tarifa_por_kg numeric(10,2) null` (copia del precio al cobrar; cambiar una tarifa no altera guías previas).
Folio automático: trigger BEFORE INSERT en guias: si `folio` es null o '' → `<sucursal>-<n>` con n consecutivo por sucursal (contador en `private.folio_contador`, inicializado con el máximo existente; el folio 'SPH-2' ya existe → el siguiente SPH es 3). Seguro ante concurrencia.

Políticas RLS (siempre `to authenticated`, usar `(select auth.uid())` y `(select private.mi_rol())`):
- perfiles: conservar las actuales. Añadir check de rol nuevo: `rol in ('administrador','admin_n2','rutero','sucursal')`.
- localidades: SELECT cualquier rol activo; INSERT rol in (administrador, rutero) con creada_por = auth.uid(); UPDATE/DELETE administrador.
- rutas: SELECT rol in (administrador, admin_n2, rutero); escritura administrador.
- ruta_localidades: SELECT igual que rutas; escritura administrador; INSERT también para rutero asignado a esa ruta (existe en ruta_ruteros).
- ruta_ruteros: SELECT administrador, admin_n2 o usuario_id = auth.uid(); escritura administrador.
- conteos: SELECT administrador, admin_n2, o (rutero y usuario_id = auth.uid()); INSERT rol in (administrador, rutero) con usuario_id = auth.uid(); UPDATE administrador, o rutero dueño con fecha >= (hoy México − 1 día) (USING y WITH CHECK); DELETE administrador.
- tarifas: SELECT rol in (administrador, sucursal); escritura administrador. Trigger que fija actualizada_en/actualizada_por.
- guias (REEMPLAZAR políticas): SELECT es_admin() o (rol 'sucursal' y creada_por = auth.uid() y sucursal = mi_sucursal()); INSERT creada_por = auth.uid() y (es_admin() o (rol 'sucursal' y sucursal = mi_sucursal())); UPDATE mismo predicado que SELECT en USING y WITH CHECK; DELETE es_admin().
- admin_n2 y rutero NO deben poder leer guias ni tarifas por ninguna vía (ni vistas).
- Revocar todos los privilegios de `anon` en las tablas de public.

Vistas (`with (security_invoker = true)`, GRANT select a authenticated):
- `v_cierre_diario`: de guias no anuladas → `fecha` (creada_en en hora de México ::date), `sucursal`, `metodo_pago`, `estado_pago`, `guias` (count), `bultos`, `peso_kg`, `monto` (sum pago).
- `v_conteos_diarios`: `fecha, tipo, ruta_id, localidad_id, total` (sum cantidad), `registros` (count).

Pruebas obligatorias de RLS (dentro de transacciones con ROLLBACK; no dejar datos de prueba; no tocar filas existentes): simular cada rol con `set local role authenticated` + `set local request.jwt.claims` y verificar: n2 y rutero ven 0 guias y 0 tarifas; rutero no ve conteos ajenos; caja no ve guías ajenas; inactivo no ve nada; upsert idempotente de conteos (`insert ... on conflict (id) do nothing`) funciona para rutero; folio automático. Al final correr advisors de seguridad y rendimiento y corregir lo atribuible a esta migración.

## 4. Función edge `admin-usuarios`
Los administradores nivel 1 crean cuentas (los ruteros no se registran solos).
`POST {SUPABASE_URL}/functions/v1/admin-usuarios` con `Authorization: Bearer <access_token del usuario>`.
- Valida el token (getUser), y que el llamador tenga perfil `administrador` activo; si no → 403.
- Body `{accion:'crear', email, password (>=8), nombre, rol, sucursal?}` → crea usuario con `email_confirm: true` e inserta perfil → `{ok:true, id}`.
- Body `{accion:'actualizar', id, nombre?, rol?, sucursal?, activo?, password?}` → actualiza perfil y/o contraseña → `{ok:true}`. Un admin no puede desactivarse ni quitarse el rol a sí mismo.
- Errores: `{error:'mensaje en español'}` con status 4xx. CORS completo (OPTIONS).
- La service key solo desde variables de entorno de la función.
Listar usuarios: el frontend lee `perfiles` (el admin ve todos por RLS). El email no se lista (no es necesario).

## 5. Frontend
Carpeta `/home/claude/envca/app`. Vite + React + TypeScript, `vite-plugin-pwa`, `@supabase/supabase-js`, `idb`. Versiones fijadas y lockfile.
`base: './'` y HashRouter (debe funcionar en cualquier hosting estático o subcarpeta). Salida `dist/`.
PWA instalable en Android e iPhone (manifest, iconos generados, apple-touch-icon, service worker que cachea el shell).

### Sin señal (requisito central: los puntos de acopio NO tienen señal)
- El rutero debe poder abrir la app sin conexión con sesión ya iniciada: guardar perfil/rol y catálogos (rutas, ruta_localidades, ruta_ruteros propias, localidades) en IndexedDB; si no hay red, usar la copia.
- Bandeja de salida en IndexedDB para: conteos nuevos, localidades nuevas, y vínculos ruta_localidades. IDs uuid generados en el cliente (`crypto.randomUUID()` con respaldo).
- Envío en orden (localidades → ruta_localidades → conteos) con `upsert(..., {onConflict:'id', ignoreDuplicates:true})` (ruta_localidades: onConflict 'ruta_id,localidad_id'). Un registro solo se quita de la bandeja cuando Supabase confirma. Error de red → se queda y se reintenta; error permanente (4xx de datos) → se marca con el mensaje y no bloquea a los demás.
- iOS no tiene Background Sync: sincronizar al abrir, en evento `online`, al volver a primer plano y con botón "Enviar pendientes". Indicador siempre visible: en línea / sin señal y número de pendientes.
- La caja y los administradores trabajan en línea (no necesitan bandeja), pero deben mostrar errores claros si no hay red.

### Pantallas por rol (navegación inferior en móvil, lateral en escritorio)
- Login (email + contraseña). Usuario sin perfil o inactivo → mensaje "Tu cuenta no está activa, contacta a un administrador".
- Rutero: Inicio (ruta(s) asignadas, fecha, pendientes) · Captura (tipo recepción/salida, ruta, localidad con buscador, cantidad con botones grandes +/−, notas; "Nueva localidad" con nombre, municipio, referencia y casilla "tiene punto de recepción") · Mis registros (hoy y ayer, con estado enviado/pendiente; editar los propios de hoy/ayer) · Perfil/cerrar sesión.
- Agente de caja: Nueva guía (remitente, destinatario, dirección EE. UU., contenido, bultos, peso kg, perecedero, valor declarado, destino/tarifa; monto = peso × precio/kg calculado y mostrado; si la tarifa del destino está "por definir" el monto se captura a mano y se avisa; método de pago: Efectivo / Transferencia / Zelle; estado de pago: Pagado / Por cobrar en destino; guarda `tarifa_id` y `tarifa_por_kg`; folio lo pone la base) · tras guardar: vista imprimible de la guía con encabezado de `config_guia` (original + copia cliente, `window.print()`, CSS para ancho térmico 80 mm; el modelo de impresora se define después) · Mis guías · Cierre de mi turno (hoy: guías, kg, monto, desglose por método).
- Admin nivel 2: Conteos (filtros fecha/ruta/localidad/tipo; totales por ruta y por localidad; exportar CSV) · Localidades y Rutas en solo lectura. Nada de dinero ni paquetes.
- Admin nivel 1: Tablero (rango de fechas; paquetes recibidos por ruta, salidas por localidad, kg, ingresos totales y por método de pago, ingreso por día; gráficas simples sin librerías pesadas) · Conteos (como N2 + editar/borrar) · Guías (lista, búsqueda, detalle, anular, reimprimir, exportar CSV) · Cierre diario (por fecha y sucursal) · Tarifas (editar precio, agregar destino, dejar "por definir") · Localidades (CRUD) · Rutas (CRUD, localidades por ruta con día de la semana, asignar ruteros) · Usuarios (lista de perfiles; crear/editar vía función edge; activar/desactivar).
- La UI oculta lo que el rol no puede ver, pero la seguridad real es RLS: nunca asumir permisos en el cliente.

### Calidad
- Móvil primero, botones grandes, alto contraste (se usa al sol), sin dependencias de UI pesadas. Marca sobria; nombre visible "ENVCA".
- Dinero con 2 decimales en MXN; fechas en hora de México.
- `npm run build` y `tsc --noEmit` sin errores. Incluir README breve (cómo correr, cómo desplegar `dist/`).
