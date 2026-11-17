/**
 * Bandeja de salida (IndexedDB). Reglas:
 *  - Los IDs se generan en el cliente; el envío es un upsert con ignoreDuplicates (idempotente).
 *  - Orden de envío: localidades -> ruta_localidades -> conteos (y por antigüedad dentro de cada tipo).
 *  - Un registro SOLO sale de la bandeja cuando el servidor confirma (sin error).
 *  - Error de red/sesión/5xx: se queda y se reintenta. Error permanente (4xx de datos): se marca con el
 *    mensaje y NO bloquea a los demás.
 */
import { db, type ItemOutbox, type TipoOutbox } from './db';
import { clasificarError, COD_SIN_FILAS, desdeExcepcion, mensajeError, MSG_CONTEO_RECHAZADO, MSG_VENTANA_EDICION, type ErrorRemoto } from './errors';
import { conTope } from './tiempo';
import type { Conteo, Localidad, RutaLocalidad } from './types';

export interface ResultadoRemoto { error: ErrorRemoto | null; status?: number; paso?: 'insertar' | 'actualizar' }

/** Tope por llamada al transporte (la red ya aborta a los 15 s; esto cubre transportes que no abortan). */
export const TOPE_LLAMADA_MS = 20_000;
/** Tope de una pasada completa: pase lo que pase, `enCurso` se libera. */
export const TOPE_PASADA_MS = 90_000;

export interface Transport {
  upsert(tabla: string, fila: Record<string, unknown>, onConflict: string): Promise<ResultadoRemoto>;
  update(tabla: string, id: string, cambios: Record<string, unknown>): Promise<ResultadoRemoto>;
}

const TABLA: Record<TipoOutbox, string> = { localidad: 'localidades', ruta_localidad: 'ruta_localidades', conteo: 'conteos' };
const CONFLICTO: Record<TipoOutbox, string> = { localidad: 'id', ruta_localidad: 'ruta_id,localidad_id', conteo: 'id' };
const ORDEN: Record<TipoOutbox, number> = { localidad: 0, ruta_localidad: 1, conteo: 2 };

type Oyente = () => void;
const oyentes = new Set<Oyente>();
/** Avisa a la UI que la bandeja cambió. */
export function suscribirOutbox(fn: Oyente): () => void { oyentes.add(fn); return () => { oyentes.delete(fn); }; }
function avisar(): void { oyentes.forEach((f) => { try { f(); } catch { /* la UI no debe romper el envío */ } }); }

export function claveDe(tipo: TipoOutbox, rid: string): string { return `${tipo}:${rid}`; }

// ---- alta / consulta ---------------------------------------------------------
export async function encolar(x: { tipo: TipoOutbox; rid: string; usuario_id: string; payload: Record<string, unknown> }): Promise<void> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const clave = claveDe(x.tipo, x.rid);
  const previo = await tx.store.index('por_clave').get(clave);
  if (previo) await tx.store.delete(previo.seq!);
  const item: ItemOutbox = {
    clave, tipo: x.tipo, rid: x.rid, usuario_id: x.usuario_id, payload: x.payload,
    estado: 'pendiente', error: null, intentos: 0, creado_en: new Date().toISOString(), rev: (previo?.rev ?? 0) + 1,
    enviado_previo: previo?.enviado_previo,
    pudo_llegar_rev: previo?.pudo_llegar_rev,
  };
  await tx.store.add(item);
  await tx.done;
  avisar();
}

export async function listarOutbox(usuario_id?: string): Promise<ItemOutbox[]> {
  const todos = await (await db()).getAll('outbox');
  const f = usuario_id ? todos.filter((i) => i.usuario_id === usuario_id) : todos;
  return f.sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo] || (a.seq ?? 0) - (b.seq ?? 0));
}

export async function contarOutbox(usuario_id?: string): Promise<{ pendientes: number; errores: number; total: number }> {
  const l = await listarOutbox(usuario_id);
  const errores = l.filter((i) => i.estado === 'error').length;
  return { pendientes: l.length - errores, errores, total: l.length };
}

/** Edita el payload de un registro aún en bandeja. Devuelve false si ya no está (ya se envió). */
export async function editarEnBandeja(tipo: TipoOutbox, rid: string, cambios: Record<string, unknown>): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const it = await tx.store.index('por_clave').get(claveDe(tipo, rid));
  if (!it) { await tx.done; return false; }
  it.payload = { ...it.payload, ...cambios };
  it.rev += 1;
  it.estado = 'pendiente';
  it.error = null;
  await tx.store.put(it);
  await tx.done;
  avisar();
  return true;
}

export async function descartar(seq: number): Promise<void> { await (await db()).delete('outbox', seq); avisar(); }

/** Devuelve a "pendiente" los registros con error para intentar de nuevo. */
export async function reintentarErrores(usuario_id: string): Promise<number> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  let n = 0;
  for (const it of await tx.store.getAll()) {
    if (it.usuario_id === usuario_id && it.estado === 'error') { it.estado = 'pendiente'; it.error = null; await tx.store.put(it); n++; }
  }
  await tx.done;
  avisar();
  return n;
}

// ---- envío ---------------------------------------------------------------------
export interface ResultadoFlush {
  enviados: number;
  conError: number;
  restantes: number;
  /** Por qué se detuvo antes de terminar: sin señal / tiempo agotado, sesión vencida, o cambió la sesión activa. */
  detenido: 'network' | 'auth' | 'sesion' | null;
}

async function actualizarItem(seq: number, fn: (i: ItemOutbox) => void): Promise<void> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const it = await tx.store.get(seq);
  if (it) { fn(it); await tx.store.put(it); }
  await tx.done;
}

/** Quita el registro de la bandeja solo si no cambió mientras se enviaba. */
async function confirmar(item: ItemOutbox, escribirCache: boolean): Promise<void> {
  const d = await db();
  const tx = d.transaction(['outbox', 'localidades', 'ruta_localidades', 'mis_conteos'], 'readwrite');
  const actual = await tx.objectStore('outbox').get(item.seq!);
  if (actual) {
    if (actual.rev === item.rev) await tx.objectStore('outbox').delete(item.seq!);
    else { actual.enviado_previo = true; await tx.objectStore('outbox').put(actual); }
  }
  // El catálogo local refleja lo confirmado hasta el siguiente refresco completo (solo si la sesión sigue siendo la misma).
  if (escribirCache) {
    if (item.tipo === 'localidad') tx.objectStore('localidades').put(item.payload as unknown as Localidad);
    if (item.tipo === 'ruta_localidad') { const r = item.payload as unknown as RutaLocalidad; tx.objectStore('ruta_localidades').put({ ...r, k: `${r.ruta_id}|${r.localidad_id}` }); }
    if (item.tipo === 'conteo') tx.objectStore('mis_conteos').put(item.payload as unknown as Conteo);
  }
  await tx.done;
}

type Modo = 'upsert' | 'upsert+update' | 'update';

/**
 * Decide CÓMO enviar y deja constancia en IndexedDB ANTES de la primera petición ("pudo haber llegado").
 *  - upsert:         nunca pudo llegar una versión distinta -> insertar ignorando duplicados basta.
 *  - upsert+update:  pudo llegar una versión anterior y luego se editó -> insertar (por si no llegó) y luego
 *                    UPDATE por id con los valores actuales, verificando filas afectadas.
 *  - update:         el servidor confirmó una versión anterior -> solo UPDATE.
 * `pudo_llegar_rev` solo avanza en el modo "upsert": en "upsert+update" el servidor puede quedarse con la versión
 * vieja hasta que el UPDATE se confirme, así que el registro debe seguir mereciendo UPDATE si ese paso falla.
 */
async function prepararEnvio(seq: number): Promise<{ it: ItemOutbox; modo: Modo } | null> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  const it = await tx.store.get(seq);
  if (!it || it.estado !== 'pendiente') { await tx.done; return null; }
  let modo: Modo = 'upsert';
  if (it.tipo === 'conteo') {
    if (it.enviado_previo) modo = 'update';
    else if (it.pudo_llegar_rev !== undefined && it.pudo_llegar_rev < it.rev) modo = 'upsert+update';
    else { it.pudo_llegar_rev = it.rev; await tx.store.put(it); }
  }
  await tx.done;
  return { it, modo };
}

const ERR_TOPE: ResultadoRemoto = { error: { message: 'Tiempo de espera agotado', code: '', name: 'TimeoutError', status: 0 }, status: 0 };

async function enviarUno(t: Transport, it: ItemOutbox, modo: Modo, topeMs: number): Promise<ResultadoRemoto> {
  const llamar = (f: () => Promise<ResultadoRemoto>) => conTope(f(), topeMs, () => ERR_TOPE);
  try {
    if (it.tipo === 'conteo' && modo !== 'upsert') {
      if (modo === 'upsert+update') {
        const r1 = await llamar(() => t.upsert(TABLA.conteo, it.payload, CONFLICTO.conteo));
        if (r1.error) return { ...r1, paso: 'insertar' };
      }
      const p = it.payload as { cantidad: number; notas: string | null; fecha: string };
      const r2 = await llamar(() => t.update('conteos', it.rid, { cantidad: p.cantidad, notas: p.notas, fecha: p.fecha }));
      return { ...r2, paso: 'actualizar' };
    }
    const r = await llamar(() => t.upsert(TABLA[it.tipo], it.payload, CONFLICTO[it.tipo]));
    return { ...r, paso: 'insertar' };
  } catch (x) {
    return { error: desdeExcepcion(x), status: 0 };
  }
}

/** Mensaje para un error permanente; para conteos explica las reglas de fecha / ventana de edición. */
function mensajeDeItem(it: ItemOutbox, r: ResultadoRemoto): string {
  if (it.tipo === 'conteo' && r.error) {
    const c = r.error.code;
    if (r.paso === 'insertar' && c === '42501') return MSG_CONTEO_RECHAZADO;   // RLS de INSERT: fecha futura / de más de 30 días
    if (r.paso === 'actualizar' && (c === '42501' || c === COD_SIN_FILAS)) return `No se pudo enviar la corrección. ${MSG_VENTANA_EDICION}`;
  }
  return mensajeError(r.error, r.status);
}

/** Una ejecución a la vez POR USUARIO; si llegan más disparadores, se repite al terminar. */
const enCurso = new Map<string, { promesa: Promise<ResultadoFlush>; repetir: boolean }>();

export interface OpcionesFlush {
  /** Intenta renovar la sesión; true si quedó una sesión válida. */
  refrescarSesion?: () => Promise<boolean>;
  alProgresar?: () => void;
  /** true mientras la sesión activa siga siendo la del dueño de los registros; si no, la pasada se detiene. */
  sesionVigente?: () => boolean | Promise<boolean>;
  /** Solo para pruebas. */
  topeLlamadaMs?: number;
  topePasadaMs?: number;
}

/** Envía la bandeja del usuario. Una sola ejecución a la vez por usuario; siempre termina (tope de tiempo). */
export function enviarBandeja(t: Transport, usuario_id: string, op: OpcionesFlush = {}): Promise<ResultadoFlush> {
  const act = enCurso.get(usuario_id);
  if (act) { act.repetir = true; return act.promesa; }
  const est = { promesa: null as unknown as Promise<ResultadoFlush>, repetir: false };
  est.promesa = (async () => {
    const ctl = { cancelado: false };
    const trabajo = (async () => {
      let ultimo: ResultadoFlush;
      do {
        est.repetir = false;
        ultimo = await pasada(t, usuario_id, op, ctl);
        if (ultimo.detenido) break;
      } while (est.repetir && !ctl.cancelado);
      return ultimo;
    })();
    return conTope(trabajo, op.topePasadaMs ?? TOPE_PASADA_MS, async () => {
      ctl.cancelado = true;
      const c = await contarOutbox(usuario_id);
      return { enviados: 0, conError: c.errores, restantes: c.total, detenido: 'network' as const };
    });
  })().finally(() => { if (enCurso.get(usuario_id) === est) enCurso.delete(usuario_id); });
  enCurso.set(usuario_id, est);
  return est.promesa;
}

async function pasada(t: Transport, usuario_id: string, op: OpcionesFlush, ctl: { cancelado: boolean }): Promise<ResultadoFlush> {
  const items = (await listarOutbox(usuario_id));
  const fallidas = new Set(items.filter((i) => i.tipo === 'localidad' && i.estado === 'error').map((i) => i.rid));
  let enviados = 0, conError = 0;
  let detenido: ResultadoFlush['detenido'] = null;
  const topeMs = op.topeLlamadaMs ?? TOPE_LLAMADA_MS;
  const vigente = async (): Promise<boolean> => {
    if (ctl.cancelado) return false;
    if (!op.sesionVigente) return true;
    try { return !!(await op.sesionVigente()); } catch { return false; }
  };
  const motivoParada = (): 'network' | 'sesion' => (ctl.cancelado ? 'network' : 'sesion');

  for (const it0 of items) {
    if (it0.estado !== 'pendiente') continue;
    if (!(await vigente())) { detenido = motivoParada(); break; }

    // Dependencia con una localidad que no se pudo enviar: no tiene caso intentar.
    const locId = it0.tipo === 'conteo' ? (it0.payload.localidad_id as string) : it0.tipo === 'ruta_localidad' ? (it0.payload.localidad_id as string) : null;
    if (locId && fallidas.has(locId)) {
      await actualizarItem(it0.seq!, (x) => { x.estado = 'error'; x.error = 'Depende de una localidad nueva que no se pudo enviar. Descártalo o reintenta.'; });
      conError++;
      continue;
    }

    // Constancia en IndexedDB de que pudo llegar, ANTES de la petición; y datos frescos (puede haberse editado).
    const prep = await prepararEnvio(it0.seq!);
    if (!prep) continue;
    const { it, modo } = prep;

    let r = await enviarUno(t, it, modo, topeMs);
    let clase = r.error ? clasificarError(r.error, r.status) : null;

    if (clase === 'auth' && op.refrescarSesion) {
      let ok = false;
      try { ok = await op.refrescarSesion(); } catch { ok = false; }
      if (ok && (await vigente())) { r = await enviarUno(t, it, modo, topeMs); clase = r.error ? clasificarError(r.error, r.status) : null; }
    }

    if (!r.error) {
      await confirmar(it, await vigente());
      enviados++;
      op.alProgresar?.();
      continue;
    }
    // Si la sesión cambió durante la petición, el error no es del registro (p. ej. RLS por otro usuario): no marcarlo.
    if (!(await vigente())) { detenido = motivoParada(); break; }
    if (clase === 'network' || clase === 'auth') { detenido = clase; break; }
    if (clase === 'transient') {
      await actualizarItem(it.seq!, (x) => { if (x.rev !== it.rev) return; x.intentos += 1; x.error = mensajeDeItem(it, r); });
      continue;
    }
    // permanente
    await actualizarItem(it.seq!, (x) => { if (x.rev !== it.rev) return; x.estado = 'error'; x.intentos += 1; x.error = mensajeDeItem(it, r); });
    if (it.tipo === 'localidad') fallidas.add(it.rid);
    conError++;
    op.alProgresar?.();
  }
  avisar();
  const c = await contarOutbox(usuario_id);
  return { enviados, conError, restantes: c.total, detenido };
}
