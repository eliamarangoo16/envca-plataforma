// Prueba de humo en navegador real (Chrome headless) contra `vite preview`.
// NO usa credenciales reales ni escribe en la base: todo el tráfico a Supabase se simula con route().
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PUERTO = 4173;
const URL_APP = `http://127.0.0.1:${PUERTO}/`;
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const UID = '11111111-1111-4111-8111-111111111111';
const RUTERO = '22222222-2222-4222-8222-222222222222';

const resultados = [];
function check(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle && !ok ? '  -> ' + detalle : ''}`);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;

// ---------------- servidor Supabase simulado ----------------
function crearMock(rol) {
  const m = { modo: 'ok', log: [], rol, malos: new Set(), conteos: [], guias: [], perderRespuestaGuia: false, activo: true, perfilErrorCodigo: null, patchVacio: false, adminError: null };
  const sesion = () => ({
    access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + Math.random(),
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'prueba@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  });
  const LOCS = [
    { id: 'a0000000-0000-4000-8000-000000000001', nombre: 'San Pablo Huixtepec', municipio: 'Zimatlán', referencia: null, tiene_punto_recepcion: true, activa: true },
    { id: 'a0000000-0000-4000-8000-000000000002', nombre: 'Zimatlán de Álvarez', municipio: 'Zimatlán', referencia: null, tiene_punto_recepcion: false, activa: true },
  ];
  const RUTA = { id: 'b0000000-0000-4000-8000-000000000001', nombre: 'Valles Centrales', activa: true };
  const TARIFAS = [
    { id: 'c0000000-0000-4000-8000-000000000001', destino: 'Seaside', precio_por_kg: 240, moneda: 'MXN', activa: true },
    { id: 'c0000000-0000-4000-8000-000000000002', destino: 'Otro destino', precio_por_kg: null, moneda: 'MXN', activa: true },
  ];
  const GUIA = { id: 'd0000000-0000-4000-8000-000000000001', folio: 'SPH-9', sucursal: 'SPH', creada_en: '2026-11-16T18:00:00Z', anulada: false, fecha_recepcion: '2026-11-16T12:00:00', fecha_envio: '2026-11-17', remitente: 'Ana Pérez', remitente_telefono: '951 000 0000', destinatario: 'Luis Gómez', direccion_eeuu: '1 Main St', ciudad: 'Seaside', estado: 'CA', zip: '93955', contenido: 'Mole', bultos: 2, peso_kg: 2.35, perecedero: false, pago: 564, moneda: 'MXN', metodo_pago: 'Efectivo', estado_pago: 'Pagado', tarifa_por_kg: 240 };
  m.handler = async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (cuerpo, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(cuerpo) });
    if (req.method() === 'OPTIONS') return json({}, 204);
    if (m.modo === 'abort') return route.abort('internetdisconnected');
    const p = u.pathname;
    m.log.push({ metodo: req.method(), ruta: p + u.search, prefer: req.headers()['prefer'] || '', cuerpo: req.postData() || '' });
    if (p === '/auth/v1/health') return json({ ok: true });
    if (p === '/auth/v1/token') {
      const gt = u.searchParams.get('grant_type');
      if (gt === 'password') {
        const c = JSON.parse(req.postData() || '{}');
        if (c.password !== 'correcta') return json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      }
      return json(sesion());
    }
    if (p === '/auth/v1/logout') return json({}, 204);
    const un = (arr) => (req.headers()['accept'] || '').includes('pgrst.object') ? json(arr[0] ?? null, arr.length ? 200 : 406) : json(arr);
    if (req.method() === 'GET') {
      switch (p) {
        case '/rest/v1/perfiles': {
          if (m.perfilErrorCodigo) return json({ code: m.perfilErrorCodigo, message: 'column perfiles.activo does not exist', details: null, hint: null }, 400);
          const yo = { id: UID, nombre: 'Persona de Prueba', sucursal: m.rol === 'sucursal' ? 'SPH' : null, rol: m.rol, activo: m.activo };
          if (u.searchParams.get('id')) return json([yo]);                         // consulta de mi propio perfil
          const rut = { id: RUTERO, nombre: 'Rutero Uno', sucursal: null, rol: 'rutero', activo: true };
          return json(u.searchParams.get('rol') === 'eq.rutero' ? [rut] : [yo, rut]);   // lista: nivel 2 solo recibe ruteros (RLS)
        }
        case '/rest/v1/localidades': return json(LOCS);
        case '/rest/v1/rutas': return json([RUTA]);
        case '/rest/v1/ruta_localidades': return json(LOCS.map((l, i) => ({ ruta_id: RUTA.id, localidad_id: l.id, dia_semana: i === 0 ? 1 : null, orden: i })));
        case '/rest/v1/ruta_ruteros': return json([{ ruta_id: RUTA.id, usuario_id: UID }]);
        case '/rest/v1/conteos': return json(m.conteos);
        case '/rest/v1/tarifas': return json(TARIFAS);
        case '/rest/v1/guias': return un(m.guias.length ? [m.guias.at(-1)] : [GUIA]);
        case '/rest/v1/config_guia': return un([{ id: 1, encabezado: { name: 'ENVCA Logística', l1: 'Oaxaca - EE. UU.', slogan: 'Tu envío, a casa', phones: '951 111 2222', rfc: 'XAXX010101000', titular: 'Titular Prueba', logo: '' }, nota: 'Gracias por su preferencia.' }]);
        case '/rest/v1/sucursales': return json([{ codigo: 'SPH', nombre: 'Matriz' }]);
        default: return json([]);        // vistas v_* y demás: vacías
      }
    }
    if (req.method() === 'POST' && p === '/functions/v1/admin-usuarios') return json({ error: m.adminError ?? 'Error' }, 403);
    if (req.method() === 'PATCH' && p === '/rest/v1/conteos') return m.patchVacio ? json([]) : json([{ id: 'x' }]);
    if (req.method() === 'POST' && p === '/rest/v1/guias') {
      // La base fija folio, tarifa_por_kg y pago (trigger); un id repetido responde 23505 sobre la llave primaria.
      const cuerpo = JSON.parse(req.postData() || '{}');
      if (m.guias.some((g) => g.id === cuerpo.id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint "guias_pkey"', details: `Key (id)=(${cuerpo.id}) already exists.`, hint: null }, 409);
      const fila = { ...GUIA, ...cuerpo, folio: 'SPH-77', tarifa_por_kg: cuerpo.tarifa_id ? 240 : null, pago: cuerpo.tarifa_id ? Math.round(cuerpo.peso_kg * 240 * 100) / 100 : cuerpo.pago };
      m.guias.push(fila);
      if (m.perderRespuestaGuia) return route.abort('connectionreset');     // llegó al servidor, pero el cliente no lo supo
      return route.fulfill({ status: 201, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([fila]) });
    }
    if (req.method() === 'POST' && p.startsWith('/rest/v1/')) {
      const cuerpo = JSON.parse(req.postData() || '{}');
      if (p.endsWith('/conteos') && m.malos.has(cuerpo.cantidad)) return json({ code: '23514', message: 'check violation', details: null, hint: null }, 400);
      if (p.endsWith('/conteos') && !m.conteos.some((c) => c.id === cuerpo.id)) m.conteos.push(cuerpo);   // ignore-duplicates
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    return json({ message: 'no simulado' }, 404);
  };
  return m;
}

// ---------------- utilidades de página ----------------
async function nuevaPagina(browser, mock, opciones = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-MX', timezoneId: 'America/Mexico_City', ...opciones });
  await ctx.route(/supabase\.co/, mock.handler);
  const page = await ctx.newPage();
  const errores = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
  page.on('pageerror', (e) => errores.push('PAGEERROR ' + e.message));
  return { ctx, page, errores };
}
const sinRuidoDeRed = (l) => l.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch|AuthRetryableFetchError/i.test(e));

async function login(page, clave = 'correcta') {
  await page.goto(URL_APP);
  await page.getByLabel('Correo electrónico').fill('prueba@example.com');
  await page.getByLabel('Contraseña').fill(clave);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

const shot = async (page, nombre) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${nombre}.png` }); };

// ---------------- main ----------------
const servidor = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PUERTO), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(URL_APP); if (r.ok) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // 1) Login sin red ni sesión: carga sin errores de consola y sin llamar a Supabase
  {
    const peticiones = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX' });
    const page = await ctx.newPage();
    const errores = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push('PAGEERROR ' + e.message));
    page.on('request', (r) => peticiones.push(r.url()));
    page.on('requestfailed', (r) => errores.push('REQUESTFAILED ' + r.url()));
    await page.goto(URL_APP);
    await page.getByRole('button', { name: 'Entrar' }).waitFor();
    await shot(page, 'login');
    check('Login: se muestra la marca ENVCA', (await page.locator('.login .logo b').innerText()) === 'ENVCA');
    check('Login: formulario en español', await page.getByLabel('Contraseña').isVisible());
    check('Login: sin errores de consola', errores.length === 0, errores.join(' | '));
    check('Login: no llama a Supabase al arrancar sin sesión', !peticiones.some((u) => /supabase\.co/.test(u)), peticiones.filter((u) => /supabase/.test(u)).join(','));
    const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    check('Manifest: nombre, start_url relativo, 3 iconos', manifest.short_name === 'ENVCA' && manifest.start_url === './' && manifest.icons.length === 3);
    check('iPhone: apple-touch-icon y meta', (await page.locator('link[rel=apple-touch-icon]').count()) === 1 && (await page.locator('meta[name=apple-mobile-web-app-capable]').count()) === 1);
    await ctx.close();
  }

  // 2) Credenciales incorrectas (respuesta simulada)
  {
    const mock = crearMock('rutero');
    const { ctx, page } = await nuevaPagina(browser, mock);
    await login(page, 'mala');
    await page.getByText('Correo o contraseña incorrectos.').waitFor({ timeout: 5000 });
    check('Login: mensaje claro con contraseña incorrecta', true);
    await ctx.close();
  }

  // 3) Rutero: sesión, catálogos, SIN señal (inicio en frío), captura, envío al volver la red
  {
    const mock = crearMock('rutero');
    const { ctx, page, errores } = await nuevaPagina(browser, mock);
    await login(page);
    await page.getByText('Hola, Persona').waitFor({ timeout: 8000 });
    check('Rutero: entra y ve Inicio', true);
    await page.getByText('Valles Centrales').first().waitFor();
    check('Rutero: catálogos descargados y mostrados', true);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForTimeout(500);
    await page.reload();                                       // ya controlado por el service worker
    await page.getByText('Hola, Persona').waitFor();
    check('PWA: service worker activo y controlando la página', await page.evaluate(() => !!navigator.serviceWorker.controller));

    // sin señal + reinicio de la app
    mock.modo = 'abort';
    await ctx.setOffline(true);
    await page.reload();
    await page.getByText('Hola, Persona').waitFor({ timeout: 8000 });
    check('Sin señal: la app abre con la sesión previa (shell desde caché, perfil desde IndexedDB)', true);
    await page.getByText('Sin señal', { exact: true }).first().waitFor({ timeout: 10000 });
    check('Sin señal: indicador permanente muestra "Sin señal"', true);
    check('Sin señal: catálogos locales disponibles', await page.getByText('Valles Centrales').first().isVisible());

    // sesión vencida + sin señal (la renovación del token falla por red): NO debe cerrar sesión
    await page.evaluate(() => { const k = 'envca-auth'; const s = JSON.parse(localStorage.getItem(k)); s.expires_at = 1; localStorage.setItem(k, JSON.stringify(s)); });
    await page.reload();
    await page.getByText('Hola, Persona').waitFor({ timeout: 10000 });
    check('Sin señal + token vencido: se mantiene dentro (no cierra sesión por fallo de red)', true);

    await page.getByRole('link', { name: 'Captura', exact: true }).click();
    await page.getByRole('option', { name: /San Pablo Huixtepec/ }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Sumar uno' }).click();
    await page.getByRole('button', { name: 'Guardar conteo' }).click();
    await page.getByText('Guardado en este teléfono').waitFor();
    await shot(page, 'captura');
    // un segundo registro que el servidor rechazará (error permanente) y un tercero válido
    await page.getByRole('option', { name: /Zimatlán de Álvarez/ }).click();
    for (let i = 0; i < 99; i++) await page.getByRole('button', { name: 'Sumar uno' }).click();
    await page.getByRole('button', { name: 'Guardar conteo' }).click();
    await page.getByRole('option', { name: /Zimatlán de Álvarez/ }).click();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Sumar uno' }).click();
    await page.getByRole('button', { name: 'Guardar conteo' }).click();
    await page.waitForTimeout(300);
    const chip = await page.getByTestId('pendientes').innerText();
    check('Sin señal: 3 registros quedan pendientes y el chip los cuenta', /^3 pendientes$/.test(chip), chip);

    // vuelve la señal; el servidor rechaza el de 99 (400) y acepta los demás
    mock.malos.add(99);
    mock.modo = 'ok';
    await ctx.setOffline(false);
    await page.waitForFunction(() => /^1 pendiente$/.test(document.querySelector('[data-testid=pendientes]')?.textContent?.trim() || ''), null, { timeout: 15000 });
    check('Al volver la señal: se envían solos; el rechazado queda marcado y no bloquea (1 con error)', true);
    const posts = mock.log.filter((l) => l.metodo === 'POST' && l.ruta.startsWith('/rest/v1/conteos'));
    check('Envío idempotente: upsert con on_conflict=id e ignore-duplicates', posts.length >= 3 && posts.every((p) => p.ruta.includes('on_conflict=id') && /resolution=ignore-duplicates/.test(p.prefer)), JSON.stringify(posts[0]));
    check('Envío: los IDs vienen del cliente (uuid)', posts.every((p) => /"id":"[0-9a-f-]{36}"/.test(p.cuerpo)));
    await page.getByRole('link', { name: 'Mis registros', exact: true }).click();
    await page.getByText('Con error').first().waitFor();
    await shot(page, 'registros');
    check('Mis registros: muestra Enviado y Con error', (await page.getByText('Enviado', { exact: true }).count()) >= 2 && (await page.getByText('Con error', { exact: true }).count()) >= 1);
    check('Mis registros: mensaje de error en español para el rechazado', await page.getByText(/fuera del rango/).isVisible());
    check('Rutero: sin errores de consola inesperados', sinRuidoDeRed(errores).length === 0, sinRuidoDeRed(errores).join(' | '));
    // editar un registro ya enviado cuando la base ya no lo permite (0 filas, fuera de hoy/ayer)
    mock.patchVacio = true;
    await page.locator('.item', { hasText: 'Enviado' }).first().getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByText('Solo puedes corregir registros de hoy y de ayer; pide el cambio a un administrador.').waitFor({ timeout: 5000 });
    check('Editar fuera de la ventana: mensaje claro (no "No tienes permiso")', true);
    await page.keyboard.press('Escape');
    // rutas protegidas por rol
    await page.goto(URL_APP + '#/tablero');
    await page.waitForTimeout(300);
    check('Rutero: #/tablero redirige a su inicio', page.url().endsWith('#/inicio'), page.url());
    await ctx.close();
  }

  // 3b) Cerrar sesión con registros sin enviar: advierte, no borra la bandeja, y se envían al volver a entrar con la misma cuenta
  {
    const mock = crearMock('rutero');
    const { ctx, page } = await nuevaPagina(browser, mock);
    await login(page);
    await page.getByText('Hola, Persona').waitFor({ timeout: 8000 });
    await page.getByText('Valles Centrales').first().waitFor();
    mock.modo = 'abort';
    await ctx.setOffline(true);
    await page.getByRole('link', { name: 'Captura', exact: true }).click();
    await page.getByRole('option', { name: /San Pablo Huixtepec/ }).click();
    await page.getByRole('button', { name: 'Sumar uno' }).click();
    await page.getByRole('button', { name: 'Guardar conteo' }).click();
    await page.getByText('Guardado en este teléfono').waitFor();
    await page.getByRole('link', { name: 'Perfil', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.getByText(/Tienes 1 registro sin enviar/).waitFor({ timeout: 15000 });
    const texto = await page.getByRole('dialog').innerText();
    check('Cerrar sesión con pendientes: advierte cuántos quedan', /Tienes 1 registro sin enviar/.test(texto));
    check('Cerrar sesión con pendientes: dice que solo se envían cuando esa misma cuenta vuelva a entrar en este teléfono', /solo se enviarán cuando esta misma cuenta .* vuelva a iniciar sesión en este teléfono/.test(texto), texto);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    check('Cerrar sesión: cancelar mantiene la sesión', await page.getByRole('button', { name: 'Cerrar sesión' }).isVisible());
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.getByRole('button', { name: 'Cerrar sesión de todos modos' }).click();
    await page.getByRole('button', { name: 'Entrar' }).waitFor({ timeout: 8000 });
    const enBandeja = () => page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('envca-offline');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => { const c = r.result.transaction('outbox').objectStore('outbox').count(); c.onsuccess = () => { r.result.close(); res(c.result); }; };
    }));
    check('Cerrar sesión: la bandeja NO se borra (1 registro sigue en IndexedDB)', (await enBandeja()) === 1);
    mock.modo = 'ok';
    await ctx.setOffline(false);
    await login(page);
    await page.getByText('Hola, Persona').waitFor({ timeout: 8000 });
    await page.waitForFunction(() => /^0 pendientes$/.test(document.querySelector('[data-testid=pendientes]')?.textContent?.trim() || ''), null, { timeout: 15000 });
    check('Al volver a entrar con la misma cuenta, el registro pendiente se envía', mock.log.some((l) => l.metodo === 'POST' && l.ruta.startsWith('/rest/v1/conteos')) && (await enBandeja()) === 0);
    await ctx.close();
  }

  // 3c) Refresco de catálogos: al abrir, y como mucho cada 10 min; el envío de pendientes sigue intentándose cada 30 s
  {
    const mock = crearMock('rutero');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', timezoneId: 'America/Mexico_City', serviceWorkers: 'block' });
    await ctx.route(/supabase\.co/, mock.handler);
    const page = await ctx.newPage();
    await page.clock.install();
    await login(page);
    await page.getByText('Hola, Persona').waitFor({ timeout: 8000 });
    await page.getByText('Valles Centrales').first().waitFor();
    const cuenta = (ruta) => mock.log.filter((l) => l.metodo === 'GET' && l.ruta.startsWith(ruta)).length;
    const pings0 = cuenta('/auth/v1/health');
    check('Catálogos: se bajan al abrir (1 vez)', cuenta('/rest/v1/localidades') === 1, String(cuenta('/rest/v1/localidades')));
    for (let i = 0; i < 6; i++) { await page.clock.runFor(31_000); await page.waitForTimeout(150); }
    check('Catálogos: en 3 minutos (6 sincronizaciones) NO se vuelven a bajar', cuenta('/rest/v1/localidades') === 1, String(cuenta('/rest/v1/localidades')));
    check('Envío de pendientes: la sincronización sí sigue intentándose cada 30 s', cuenta('/auth/v1/health') - pings0 >= 5, String(cuenta('/auth/v1/health') - pings0));
    for (let i = 0; i < 24; i++) { await page.clock.runFor(31_000); await page.waitForTimeout(100); }
    const n = cuenta('/rest/v1/localidades');
    check('Catálogos: pasados 10 minutos se vuelven a bajar (una vez, no en cada ciclo)', n >= 2 && n <= 3, String(n));
    await ctx.close();
  }

  // 3d) Cuenta inactiva: se cierra la sesión local y se explica
  {
    const mock = crearMock('rutero');
    mock.activo = false;
    const { ctx, page } = await nuevaPagina(browser, mock);
    await login(page);
    await page.getByText('Tu cuenta no está activa, contacta a un administrador').waitFor({ timeout: 8000 });
    check('Usuario inactivo: mensaje "Tu cuenta no está activa, contacta a un administrador"', true);
    check('Usuario inactivo: no entra a la app', (await page.getByText('Hola, Persona').count()) === 0);
    check('Usuario inactivo: la sesión local se cerró', await page.evaluate(() => localStorage.getItem('envca-auth') === null));
    await ctx.close();
  }

  // 3e) Sin fail-open: si la columna `activo` no existe (o el perfil falla) NO se entra como si fuera activo
  {
    const mock = crearMock('rutero');
    mock.perfilErrorCodigo = '42703';
    const { ctx, page } = await nuevaPagina(browser, mock);
    await login(page);
    await page.getByText(/La base de datos aún no está actualizada/).waitFor({ timeout: 8000 });
    check('Perfil con error (42703): muestra el error y NO entra como activo', (await page.getByText('Hola, Persona').count()) === 0);
    check('Perfil con error: no se reintenta sin la columna `activo`', mock.log.filter((l) => l.ruta.startsWith('/rest/v1/perfiles')).every((l) => /activo/.test(l.ruta)));
    await ctx.close();
  }

  // 4) Agente de caja: cálculo de monto, tarifa por definir, impresión
  {
    const mock = crearMock('sucursal');
    const { ctx, page, errores } = await nuevaPagina(browser, mock);
    await login(page);
    await page.getByRole('heading', { name: 'Nueva guía' }).waitFor({ timeout: 8000 });
    await page.locator('label.campo', { hasText: 'Destino' }).first().locator('select').selectOption({ label: 'Seaside · $240.00 por kg' });
    await page.getByLabel('Peso (kg)').fill('2.35');
    await shot(page, 'guia');
    check('Caja: monto = peso × precio/kg (2.35 × 240 = $564.00)', (await page.getByTestId('monto').innerText()).includes('564.00'));
    await page.getByLabel('Peso (kg)').fill('0.333');
    check('Caja: redondeo a 2 decimales (0.333 × 240 = $79.92)', (await page.getByTestId('monto').innerText()).includes('79.92'));
    await page.locator('label.campo', { hasText: 'Destino' }).first().locator('select').selectOption({ index: 2 });
    await page.getByText(/«por definir»/).waitFor();
    check('Caja: tarifa por definir avisa y pide monto manual', await page.getByLabel('Monto a cobrar (MXN)').isVisible());
    check('Caja: no ve pantallas de administración', (await page.getByRole('link', { name: 'Tablero' }).count()) === 0 && (await page.locator('.nav a').count()) === 4);
    await page.goto(URL_APP + '#/usuarios'); await page.waitForTimeout(300);
    check('Caja: #/usuarios redirige a Nueva guía', page.url().endsWith('#/guia/nueva'), page.url());

    await page.goto(URL_APP + '#/guia/d0000000-0000-4000-8000-000000000001/imprimir');
    await page.getByText('COPIA CLIENTE').waitFor();
    await shot(page, 'imprimir');
    check('Impresión: original y copia cliente con encabezado de config_guia', (await page.getByText('ORIGINAL', { exact: true }).count()) === 1 && (await page.getByText('ENVCA Logística').count()) === 2 && (await page.getByText('Gracias por su preferencia.').count()) === 2);
    await page.emulateMedia({ media: 'print' });
    const vis = await page.evaluate(() => ({
      nav: getComputedStyle(document.querySelector('.nav')).display,
      hoja: document.querySelector('.hoja').getBoundingClientRect().width,
      salto: getComputedStyle(document.querySelector('.hoja')).breakAfter,
    }));
    check('Impresión: en @media print se oculta la navegación y la hoja mide 72 mm', vis.nav === 'none' && Math.abs(vis.hoja - (72 / 25.4) * 96) < 3 && vis.salto === 'page', JSON.stringify(vis));
    const pdf = await page.pdf({ preferCSSPageSize: true });
    check('Impresión: genera PDF con tamaño de página definido por CSS (80 mm)', pdf.length > 1000);
    check('Caja: sin errores de consola inesperados', sinRuidoDeRed(errores).length === 0, sinRuidoDeRed(errores).join(' | '));
    await ctx.close();
  }

  // 4b) Caja: la guía no se duplica si la confirmación se pierde (mismo id al salir y volver), y se muestran los valores de la base
  {
    const mock = crearMock('sucursal');
    const { ctx, page, errores } = await nuevaPagina(browser, mock);
    await login(page);
    await page.getByRole('heading', { name: 'Nueva guía' }).waitFor({ timeout: 8000 });
    const llenar = async () => {
      await page.locator('label.campo', { hasText: 'Destino' }).first().locator('select').selectOption({ label: 'Seaside · $240.00 por kg' });
      await page.locator('label.campo', { hasText: 'Nombre completo' }).nth(0).locator('input').fill('Ana Pérez');
      await page.locator('label.campo', { hasText: 'Nombre completo' }).nth(1).locator('input').fill('Luis Gómez');
      await page.getByLabel('Dirección (calle y número)').fill('1 Main St');
      await page.getByLabel('Contenido').fill('Mole');
      await page.getByLabel('Peso (kg)').fill('2');
    };
    await llenar();
    mock.perderRespuestaGuia = true;
    await page.getByRole('button', { name: 'Guardar guía' }).click();
    await page.getByText(/No se pudo confirmar si la guía se guardó/).waitFor({ timeout: 8000 });
    check('Caja: si la respuesta se pierde, avisa que puede reintentar sin duplicar', true);
    await page.goto(URL_APP + '#/cierre'); await page.getByRole('heading', { name: 'Cierre de mi turno' }).waitFor();
    await page.goto(URL_APP + '#/guia/nueva'); await page.getByRole('heading', { name: 'Nueva guía' }).waitFor();
    check('Caja: al salir y volver se recupera el formulario en captura', (await page.locator('label.campo', { hasText: 'Nombre completo' }).nth(0).locator('input').inputValue()) === 'Ana Pérez');
    mock.perderRespuestaGuia = false;
    await page.getByRole('button', { name: 'Guardar guía' }).click();
    await page.getByText(/Esta guía ya estaba guardada/).waitFor({ timeout: 8000 });
    const posts = mock.log.filter((l) => l.metodo === 'POST' && l.ruta.startsWith('/rest/v1/guias'));
    const ids = posts.map((l) => JSON.parse(l.cuerpo).id);
    check('Caja: el reintento usa el MISMO id; el servidor responde 23505 y se muestra la guía existente (1 sola guía)', posts.length === 2 && ids[0] === ids[1] && mock.guias.length === 1, JSON.stringify(ids));
    check('Caja: se muestra el folio y el monto que fijó la base (SPH-77, $480.00)', (await page.getByText('SPH-77').first().isVisible()) && /\$480\.00/.test(await page.locator('.aviso.ok').innerText()));
    check('Caja: el insert pide la fila de vuelta (select=*) y no manda tarifa_por_kg', posts.every((l) => /select=\*/.test(l.ruta) && !/tarifa_por_kg/.test(l.cuerpo)), posts[0]?.ruta);
    // una guía nueva después de confirmar usa otro id y empieza vacía
    await page.getByRole('link', { name: 'Nueva guía' }).first().click();
    await page.getByRole('heading', { name: 'Nueva guía' }).waitFor();
    check('Caja: tras confirmar, el borrador se limpia', (await page.locator('label.campo', { hasText: 'Nombre completo' }).nth(0).locator('input').inputValue()) === '');
    await llenar();
    await page.getByRole('button', { name: 'Guardar guía' }).click();
    await page.getByText(/Guía guardada con folio/).waitFor({ timeout: 8000 });
    const ids2 = mock.log.filter((l) => l.metodo === 'POST' && l.ruta.startsWith('/rest/v1/guias')).map((l) => JSON.parse(l.cuerpo).id);
    check('Caja: la siguiente guía usa un id distinto y muestra folio, monto y tarifa de la base', ids2.length === 3 && ids2[2] !== ids2[0] && /monto\s*\$480\.00.*tarifa\s*\$240\.00 por kg/s.test(await page.locator('.aviso.ok').innerText()));
    check('Caja (guardado): sin errores de consola inesperados', sinRuidoDeRed(errores).length === 0, sinRuidoDeRed(errores).join(' | '));
    await ctx.close();
  }

  // 5) Administrador nivel 1 y nivel 2
  for (const [rol, esperaNav, esperaUrl] of [['administrador', 10, '#/tablero'], ['admin_n2', 4, '#/conteos']]) {
    const mock = crearMock(rol);
    const hoyMX = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    mock.conteos = [{ id: 'k1', tipo: 'recepcion', fecha: hoyMX, ruta_id: 'b0000000-0000-4000-8000-000000000001', localidad_id: 'a0000000-0000-4000-8000-000000000001', cantidad: 4, notas: null, usuario_id: RUTERO, capturado_en: new Date().toISOString() }];
    const { ctx, page, errores } = await nuevaPagina(browser, mock, { viewport: { width: 1200, height: 800 } });
    await login(page);
    await page.waitForFunction((u) => location.hash === u, esperaUrl, { timeout: 8000 });
    check(`${rol}: aterriza en ${esperaUrl} con ${esperaNav} accesos`, (await page.locator('.nav a').count()) === esperaNav);
    await page.waitForTimeout(500);
    await shot(page, 'admin-' + rol);
    if (rol === 'admin_n2') {
      check('admin_n2: Conteos muestra el nombre del rutero (no «—»)', (await page.getByRole('cell', { name: 'Rutero Uno' }).count()) === 1);
      check('admin_n2: pide solo perfiles de rol rutero (lo que la RLS le permite)', mock.log.some((l) => l.ruta.startsWith('/rest/v1/perfiles') && /rol=eq\.rutero/.test(l.ruta)));
      await page.goto(URL_APP + '#/guias'); await page.waitForTimeout(300);
      check('admin_n2: no accede a Guías ni a Tarifas (redirige a Conteos)', page.url().endsWith('#/conteos'));
      check('admin_n2: no ve nada de dinero en el menú', (await page.getByRole('link', { name: /Tarifas|Guías|Tablero|Cierre/ }).count()) === 0);
    } else {
      for (const h of ['#/guias', '#/cierre-diario', '#/tarifas', '#/usuarios', '#/localidades', '#/rutas', '#/conteos', '#/bitacora']) {
        await page.goto(URL_APP + h); await page.waitForTimeout(250);
        if (page.url().endsWith(h) === false) check(`administrador: ${h} accesible`, false, page.url());
      }
      check('administrador: todas sus pantallas abren', true);
      // Usuarios: el mensaje del servidor (p. ej. trigger de perfiles, 42501) se muestra tal cual
      mock.adminError = 'Debe quedar al menos un administrador nivel 1 activo';
      await page.goto(URL_APP + '#/usuarios');
      await page.locator('.item', { hasText: 'Rutero Uno' }).getByRole('button', { name: 'Editar' }).click();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByText('Debe quedar al menos un administrador nivel 1 activo', { exact: true }).waitFor({ timeout: 5000 });
      check('Usuarios: se muestra tal cual el mensaje del servidor', true);
    }
    check(`${rol}: sin errores de consola inesperados`, sinRuidoDeRed(errores).length === 0, sinRuidoDeRed(errores).join(' | '));
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  check('Ejecución sin excepciones', false, String(e));
} finally {
  await browser?.close();
  servidor.kill();
}
const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} comprobaciones correctas`);
process.exit(fallas.length ? 1 : 0);
