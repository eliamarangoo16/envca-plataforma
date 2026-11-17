import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _cerrarParaPruebas, DB_NOMBRE, leerCatalogos, leerMisConteos } from '../src/lib/db';
import { contarOutbox, descartar, editarEnBandeja, encolar, enviarBandeja, listarOutbox, reintentarErrores, type ResultadoRemoto, type Transport } from '../src/lib/outbox';
import { COD_SIN_FILAS } from '../src/lib/errors';

const U = 'user-1';
const RED: ResultadoRemoto = { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
const OK: ResultadoRemoto = { error: null, status: 201 };
const E400 = (code = '23514', message = 'violates check'): ResultadoRemoto => ({ error: { message, code }, status: 400 });

interface Llamada { op: 'upsert' | 'update'; tabla: string; fila?: Record<string, unknown>; id?: string; onConflict?: string }

/** Servidor falso con semántica "ignore duplicates", idempotente por clave. */
function falso(regla?: (l: Llamada) => ResultadoRemoto | undefined) {
  const llamadas: Llamada[] = [];
  const filas = new Map<string, Record<string, unknown>>();
  const t: Transport = {
    async upsert(tabla, fila, onConflict) {
      const l: Llamada = { op: 'upsert', tabla, fila, onConflict };
      llamadas.push(l);
      const r = regla?.(l);
      if (r) return r;
      const clave = `${tabla}:${onConflict === 'id' ? fila.id : `${fila.ruta_id}|${fila.localidad_id}`}`;
      if (!filas.has(clave)) filas.set(clave, fila);   // ignoreDuplicates
      return OK;
    },
    async update(tabla, id, cambios) {
      const l: Llamada = { op: 'update', tabla, id, fila: cambios };
      llamadas.push(l);
      const r = regla?.(l);
      if (r) return r;
      const k = `${tabla}:${id}`;
      // Igual que PostgREST con RLS: si no hay fila que actualizar, 0 filas y SIN error (el transporte real lo convierte en error).
      if (!filas.has(k)) return { error: { message: 'La actualización no afectó ninguna fila.', code: COD_SIN_FILAS }, status: 403 };
      filas.set(k, { ...filas.get(k), ...cambios });
      return OK;
    },
  };
  return { t, llamadas, filas };
}

const conteo = (id: string, loc = 'loc-1', cantidad = 3) => encolar({ tipo: 'conteo', rid: id, usuario_id: U, payload: { id, tipo: 'recepcion', fecha: '2026-11-16', ruta_id: 'r1', localidad_id: loc, cantidad, notas: null, usuario_id: U, capturado_en: '2026-11-16T15:00:00Z' } });
const localidad = (id: string) => encolar({ tipo: 'localidad', rid: id, usuario_id: U, payload: { id, nombre: 'Nueva', municipio: null, referencia: null, tiene_punto_recepcion: false, activa: true } });
const vinculo = (r: string, l: string) => encolar({ tipo: 'ruta_localidad', rid: `${r}|${l}`, usuario_id: U, payload: { ruta_id: r, localidad_id: l, dia_semana: null, orden: 0 } });

beforeEach(async () => {
  await _cerrarParaPruebas();
  await new Promise<void>((res, rej) => { const rq = indexedDB.deleteDatabase(DB_NOMBRE); rq.onsuccess = () => res(); rq.onerror = () => rej(rq.error); rq.onblocked = () => res(); });
});

describe('orden de envío', () => {
  it('envía localidades -> ruta_localidades -> conteos aunque se hayan capturado al revés', async () => {
    await conteo('c1', 'loc-n'); await vinculo('r1', 'loc-n'); await conteo('c2', 'loc-n'); await localidad('loc-n');
    const s = falso();
    const r = await enviarBandeja(s.t, U);
    expect(s.llamadas.map((l) => l.tabla)).toEqual(['localidades', 'ruta_localidades', 'conteos', 'conteos']);
    expect(s.llamadas.map((l) => l.onConflict)).toEqual(['id', 'ruta_id,localidad_id', 'id', 'id']);
    expect(s.llamadas.filter((l) => l.tabla === 'conteos').map((l) => l.fila!.id)).toEqual(['c1', 'c2']);   // por antigüedad
    expect(r).toMatchObject({ enviados: 4, restantes: 0, detenido: null });
    expect((await listarOutbox(U)).length).toBe(0);
  });
  it('lo confirmado queda en la copia local (catálogo y mis conteos)', async () => {
    await localidad('loc-n'); await conteo('c1', 'loc-n');
    await enviarBandeja(falso().t, U);
    expect((await leerCatalogos()).localidades.map((l) => l.id)).toContain('loc-n');
    expect((await leerMisConteos('2026-11-01')).map((c) => c.id)).toEqual(['c1']);
  });
});

describe('idempotencia', () => {
  it('reencolar el mismo id no duplica; reenviar tras una confirmación perdida no duplica en el servidor', async () => {
    await conteo('c1'); await conteo('c1', 'loc-1', 5);
    expect((await listarOutbox(U)).length).toBe(1);
    const s = falso();
    await enviarBandeja(s.t, U);
    // la respuesta "se perdió": el cliente vuelve a tener el mismo registro y lo reenvía
    await conteo('c1', 'loc-1', 5);
    await enviarBandeja(s.t, U);
    expect(s.llamadas.length).toBe(2);
    expect([...s.filas.keys()]).toEqual(['conteos:c1']);       // una sola fila
  });
  it('dos disparadores simultáneos envían cada registro una sola vez', async () => {
    await conteo('c1'); await conteo('c2');
    const s = falso();
    const [a, b] = await Promise.all([enviarBandeja(s.t, U), enviarBandeja(s.t, U)]);
    expect(s.llamadas.length).toBe(2);
    expect(a).toBe(b);
  });
});

describe('error de red: no se pierde nada', () => {
  it('respuesta con status 0 deja todo pendiente y detiene el envío', async () => {
    await localidad('l1'); await conteo('c1', 'l1'); await conteo('c2', 'l1');
    const s = falso(() => RED);
    const r = await enviarBandeja(s.t, U);
    expect(r).toMatchObject({ enviados: 0, restantes: 3, detenido: 'network' });
    expect(s.llamadas.length).toBe(1);                        // no insiste con cada registro
    const l = await listarOutbox(U);
    expect(l.every((i) => i.estado === 'pendiente')).toBe(true);
  });
  it('una excepción de fetch también es error de red', async () => {
    await conteo('c1');
    const t: Transport = { upsert: async () => { throw new TypeError('Failed to fetch'); }, update: async () => OK };
    const r = await enviarBandeja(t, U);
    expect(r).toMatchObject({ restantes: 1, detenido: 'network' });
    expect((await contarOutbox(U))).toMatchObject({ pendientes: 1, errores: 0 });
  });
  it('al volver la red se envía todo lo pendiente', async () => {
    await conteo('c1'); await conteo('c2');
    await enviarBandeja(falso(() => RED).t, U);
    const s = falso();
    const r = await enviarBandeja(s.t, U);
    expect(r).toMatchObject({ enviados: 2, restantes: 0 });
  });
  it('si la red cae a mitad, lo ya confirmado sale y lo demás se queda', async () => {
    await conteo('c1'); await conteo('c2'); await conteo('c3');
    let n = 0;
    const s = falso(() => (++n === 2 ? RED : undefined));
    const r = await enviarBandeja(s.t, U);
    expect(r).toMatchObject({ enviados: 1, restantes: 2, detenido: 'network' });
    expect((await listarOutbox(U)).map((i) => i.rid)).toEqual(['c2', 'c3']);
  });
});

describe('error permanente: se marca y no bloquea', () => {
  it('un 4xx de datos marca ese registro y continúa con los demás', async () => {
    await conteo('malo'); await conteo('bueno1'); await conteo('bueno2');
    const s = falso((l) => (l.fila?.id === 'malo' ? E400('23514') : undefined));
    const r = await enviarBandeja(s.t, U);
    expect(r).toMatchObject({ enviados: 2, conError: 1, restantes: 1, detenido: null });
    const [malo] = await listarOutbox(U);
    expect(malo).toMatchObject({ rid: 'malo', estado: 'error' });
    expect(malo.error).toMatch(/fuera del rango/);
    expect([...s.filas.keys()].sort()).toEqual(['conteos:bueno1', 'conteos:bueno2']);
  });
  it('RLS (42501) es permanente', async () => {
    await conteo('c1');
    const r = await enviarBandeja(falso(() => ({ error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 })).t, U);
    expect(r).toMatchObject({ conError: 1, detenido: null });
    expect((await listarOutbox(U))[0].error).toMatch(/fecha posterior a mañana ni de hace más de 30 días/);   // RLS de INSERT de conteos
  });
  it('los registros con error no se reenvían solos; "reintentar" los devuelve a pendiente', async () => {
    await conteo('c1');
    const s = falso(() => E400());
    await enviarBandeja(s.t, U);
    await enviarBandeja(s.t, U);
    expect(s.llamadas.length).toBe(1);
    expect(await reintentarErrores(U)).toBe(1);
    const s2 = falso();
    expect(await enviarBandeja(s2.t, U)).toMatchObject({ enviados: 1, restantes: 0 });
  });
  it('si una localidad nueva falla, lo que depende de ella se marca sin intentar enviarlo; lo independiente sale', async () => {
    await localidad('lmala'); await vinculo('r1', 'lmala'); await conteo('dep', 'lmala'); await conteo('indep', 'loc-1');
    const s = falso((l) => (l.tabla === 'localidades' ? E400('23505', 'dup') : undefined));
    const r = await enviarBandeja(s.t, U);
    expect(r).toMatchObject({ enviados: 1, conError: 3 });
    expect(s.llamadas.map((l) => l.tabla)).toEqual(['localidades', 'conteos']);   // dependientes no se intentaron
    expect((await listarOutbox(U)).every((i) => i.estado === 'error')).toBe(true);
  });
  it('descartar quita un registro con error', async () => {
    await conteo('c1');
    await enviarBandeja(falso(() => E400()).t, U);
    await descartar((await listarOutbox(U))[0].seq!);
    expect((await contarOutbox(U)).total).toBe(0);
  });
});

describe('errores transitorios y de sesión', () => {
  it('5xx se queda pendiente (no es permanente) y se sigue con los demás', async () => {
    await conteo('c1'); await conteo('c2');
    const s = falso((l) => (l.fila?.id === 'c1' ? { error: { message: 'boom', code: '' }, status: 503 } : undefined));
    const r = await enviarBandeja(s.t, U);
    expect(r).toMatchObject({ enviados: 1, conError: 0, restantes: 1 });
    expect((await listarOutbox(U))[0]).toMatchObject({ rid: 'c1', estado: 'pendiente', intentos: 1 });
  });
  it('401: renueva la sesión y reintenta una vez', async () => {
    await conteo('c1');
    let primera = true;
    const s = falso(() => { if (primera) { primera = false; return { error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }; } });
    let refrescos = 0;
    const r = await enviarBandeja(s.t, U, { refrescarSesion: async () => { refrescos++; return true; } });
    expect(refrescos).toBe(1);
    expect(r).toMatchObject({ enviados: 1, restantes: 0 });
  });
  it('401 sin poder renovar: se detiene, el registro sigue pendiente', async () => {
    await conteo('c1');
    const s = falso(() => ({ error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }));
    const r = await enviarBandeja(s.t, U, { refrescarSesion: async () => false });
    expect(r).toMatchObject({ enviados: 0, restantes: 1, detenido: 'auth' });
    expect((await contarOutbox(U)).pendientes).toBe(1);
  });
});

describe('otras reglas', () => {
  it('solo envía los registros del usuario con sesión', async () => {
    await conteo('c1');
    await encolar({ tipo: 'conteo', rid: 'ajeno', usuario_id: 'otro', payload: { id: 'ajeno', localidad_id: 'x' } });
    const s = falso();
    await enviarBandeja(s.t, U);
    expect(s.llamadas.map((l) => l.fila!.id)).toEqual(['c1']);
    expect((await listarOutbox('otro')).length).toBe(1);
  });
  it('editar un registro pendiente cambia lo que se envía; si ya no está, devuelve false', async () => {
    await conteo('c1', 'loc-1', 3);
    expect(await editarEnBandeja('conteo', 'c1', { cantidad: 9 })).toBe(true);
    const s = falso();
    await enviarBandeja(s.t, U);
    expect(s.llamadas[0].fila!.cantidad).toBe(9);
    expect(await editarEnBandeja('conteo', 'c1', { cantidad: 1 })).toBe(false);
  });
  it('una edición hecha mientras se enviaba no se pierde: se reenvía como UPDATE', async () => {
    await conteo('c1', 'loc-1', 3);
    const s = falso((l) => { if (l.op === 'upsert') void editarEnBandeja('conteo', 'c1', { cantidad: 7 }); return undefined; });
    await enviarBandeja(s.t, U);
    await new Promise((r) => setTimeout(r, 20));
    const quedan = await listarOutbox(U);
    expect(quedan.length).toBe(1);
    expect(quedan[0].enviado_previo).toBe(true);
    await enviarBandeja(s.t, U);
    expect(s.llamadas.at(-1)).toMatchObject({ op: 'update', id: 'c1', fila: { cantidad: 7 } });
    expect((await contarOutbox(U)).total).toBe(0);
  });
});


describe('confirmación perdida + edición (el servidor no debe quedarse con el valor viejo)', () => {
  /** El primer upsert LLEGA al servidor pero la respuesta se pierde (error de red). */
  function conPrimeraRespuestaPerdida(s: ReturnType<typeof falso>, alVer?: () => Promise<void>): Transport {
    let n = 0;
    return {
      upsert: async (tabla, fila, oc) => { await alVer?.(); const r = await s.t.upsert(tabla, fila, oc); return ++n === 1 ? RED : r; },
      update: (tabla, id, c) => s.t.update(tabla, id, c),
    };
  }

  it('se persiste "pudo llegar" ANTES de la primera petición; tras editar, el servidor termina con la cantidad nueva', async () => {
    await conteo('c1', 'loc-1', 3);
    const s = falso();
    let marcaAntes: number | undefined;
    const t = conPrimeraRespuestaPerdida(s, async () => { marcaAntes = (await listarOutbox(U))[0].pudo_llegar_rev; });
    expect(await enviarBandeja(t, U)).toMatchObject({ restantes: 1, detenido: 'network' });
    expect(marcaAntes).toBe(1);                                         // guardado en IndexedDB antes de enviar
    expect(s.filas.get('conteos:c1')!.cantidad).toBe(3);                 // llegó, aunque el cliente no lo supo

    expect(await editarEnBandeja('conteo', 'c1', { cantidad: 9, notas: 'corregido' })).toBe(true);
    expect(await enviarBandeja(t, U)).toMatchObject({ enviados: 1, restantes: 0, detenido: null });
    expect(s.filas.get('conteos:c1')).toMatchObject({ cantidad: 9, notas: 'corregido', fecha: '2026-11-16' });
    expect(s.llamadas.map((l) => l.op)).toEqual(['upsert', 'upsert', 'update']);   // insertar-ignorar y luego UPDATE por id
    expect(s.llamadas.at(-1)).toMatchObject({ op: 'update', id: 'c1', fila: { cantidad: 9, notas: 'corregido', fecha: '2026-11-16' } });
  });

  it('si el UPDATE falla por red tras el insert, el siguiente intento vuelve a hacer el UPDATE (no se pierde la edición)', async () => {
    await conteo('c1', 'loc-1', 3);
    const s = falso();
    await enviarBandeja(conPrimeraRespuestaPerdida(s), U);
    await editarEnBandeja('conteo', 'c1', { cantidad: 9 });
    let updates = 0;
    const t: Transport = { upsert: s.t.upsert, update: async (tabla, id, c) => (++updates === 1 ? RED : s.t.update(tabla, id, c)) };
    expect(await enviarBandeja(t, U)).toMatchObject({ restantes: 1, detenido: 'network' });
    expect(s.filas.get('conteos:c1')!.cantidad).toBe(3);                 // aún el valor viejo
    expect(await enviarBandeja(t, U)).toMatchObject({ enviados: 1, restantes: 0 });
    expect(s.filas.get('conteos:c1')!.cantidad).toBe(9);
  });

  it('si no hubo edición, reintentar es solo "insertar ignorando duplicados" (sin UPDATE)', async () => {
    await conteo('c1', 'loc-1', 3);
    const s = falso();
    const t = conPrimeraRespuestaPerdida(s);
    await enviarBandeja(t, U);
    await enviarBandeja(t, U);
    expect(s.llamadas.map((l) => l.op)).toEqual(['upsert', 'upsert']);
    expect((await contarOutbox(U)).total).toBe(0);
  });

  it('UPDATE que afecta 0 filas (p. ej. fuera de la ventana de edición): error permanente con mensaje claro', async () => {
    await conteo('c1', 'loc-1', 3);
    await enviarBandeja(falso(() => RED).t, U);                          // pudo haber llegado
    await editarEnBandeja('conteo', 'c1', { cantidad: 9 });
    const s = falso();                                                   // el servidor NO tiene la fila y el UPDATE no toca nada
    const t: Transport = { upsert: async (tabla, fila, oc) => { s.llamadas.push({ op: 'upsert', tabla, fila, onConflict: oc }); return OK; }, update: s.t.update };
    const r = await enviarBandeja(t, U);
    expect(r).toMatchObject({ conError: 1, detenido: null });
    const [it] = await listarOutbox(U);
    expect(it.estado).toBe('error');
    expect(it.error).toMatch(/Solo puedes corregir registros de hoy y de ayer; pide el cambio a un administrador/);
  });
});

describe('tiempos máximos: nada se cuelga para siempre', () => {
  const colgado: Transport = { upsert: () => new Promise<ResultadoRemoto>(() => {}), update: () => new Promise<ResultadoRemoto>(() => {}) };

  it('una llamada que nunca responde se corta como error de red: el registro sigue pendiente y la bandeja se libera', async () => {
    await conteo('c1');
    const r = await enviarBandeja(colgado, U, { topeLlamadaMs: 30 });
    expect(r).toMatchObject({ enviados: 0, restantes: 1, detenido: 'network' });
    expect((await contarOutbox(U))).toMatchObject({ pendientes: 1, errores: 0 });
    const s = falso();
    expect(await enviarBandeja(s.t, U)).toMatchObject({ enviados: 1, restantes: 0 });   // enCurso se liberó
  });

  it('tope de la pasada completa: devuelve control aunque cada llamada tarde, y la pasada huérfana se detiene', async () => {
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) await conteo(id);
    const enviadosIds: string[] = [];
    const lento: Transport = {
      upsert: async (_t, fila) => { await new Promise((r) => setTimeout(r, 60)); enviadosIds.push(fila.id as string); return OK; },
      update: async () => OK,
    };
    const t0 = Date.now();
    const r = await enviarBandeja(lento, U, { topePasadaMs: 100, topeLlamadaMs: 1000 });
    expect(Date.now() - t0).toBeLessThan(250);
    expect(r.detenido).toBe('network');
    await new Promise((res) => setTimeout(res, 300));                    // la pasada abandonada no sigue enviando todo
    expect(enviadosIds.length).toBeLessThan(5);
    const resto = await enviarBandeja(falso().t, U);                     // y la bandeja quedó libre
    expect(resto.restantes).toBe(0);
  });
});

describe('envío en curso por usuario y sesión activa', () => {
  const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('dos usuarios pueden enviar a la vez: el envío en curso de uno no se comparte con el otro', async () => {
    await conteo('a1');
    await encolar({ tipo: 'conteo', rid: 'b1', usuario_id: 'user-2', payload: { id: 'b1', tipo: 'salida', fecha: '2026-11-16', ruta_id: null, localidad_id: 'loc-1', cantidad: 1, notas: null, usuario_id: 'user-2' } });
    const a = falso((_l) => undefined); const b = falso();
    const lento: Transport = { upsert: async (...x) => { await pausa(30); return a.t.upsert(...x); }, update: a.t.update };
    const [ra, rb] = await Promise.all([enviarBandeja(lento, U), enviarBandeja(b.t, 'user-2')]);
    expect(ra).not.toBe(rb);
    expect(ra).toMatchObject({ enviados: 1, restantes: 0 });
    expect(rb).toMatchObject({ enviados: 1, restantes: 0 });
    expect(a.llamadas.map((l) => l.fila!.id)).toEqual(['a1']);
    expect(b.llamadas.map((l) => l.fila!.id)).toEqual(['b1']);
  });

  it('si la sesión activa deja de ser la del dueño, la pasada se detiene y no toca los demás registros', async () => {
    await conteo('c1'); await conteo('c2'); await conteo('c3');
    let vigente = true;
    const s = falso((l) => { if (l.fila?.id === 'c1') vigente = false; return undefined; });   // alguien cierra sesión / entra otro
    const r = await enviarBandeja(s.t, U, { sesionVigente: () => vigente });
    expect(r.detenido).toBe('sesion');
    expect(s.llamadas.map((l) => l.fila!.id)).toEqual(['c1']);
    expect((await listarOutbox(U)).map((i) => [i.rid, i.estado])).toEqual([['c2', 'pendiente'], ['c3', 'pendiente']]);
  });

  it('un error devuelto cuando la sesión ya cambió NO marca el registro como rechazado', async () => {
    await conteo('c1');
    let vigente = true;
    const s = falso(() => { vigente = false; return E400('42501', 'new row violates row-level security policy'); });
    const r = await enviarBandeja(s.t, U, { sesionVigente: () => vigente });
    expect(r).toMatchObject({ detenido: 'sesion', conError: 0 });
    expect((await listarOutbox(U))[0]).toMatchObject({ rid: 'c1', estado: 'pendiente', error: null });
  });
});

describe('mensajes de la base para conteos del rutero', () => {
  it('RLS de INSERT (fecha futura o de más de 30 días) es permanente y explica la regla', async () => {
    await conteo('c1');
    const r = await enviarBandeja(falso(() => E400('42501', 'new row violates row-level security policy for table "conteos"')).t, U);
    expect(r).toMatchObject({ conError: 1, detenido: null });
    const [it] = await listarOutbox(U);
    expect(it.estado).toBe('error');
    expect(it.error).toMatch(/posterior a mañana ni de hace más de 30 días/);
  });
});
