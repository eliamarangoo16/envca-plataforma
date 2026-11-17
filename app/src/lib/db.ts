import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conteo, Localidad, Perfil, Ruta, RutaLocalidad, RutaRutero } from './types';

export type TipoOutbox = 'localidad' | 'ruta_localidad' | 'conteo';

export interface ItemOutbox {
  seq?: number;
  /** "tipo:id" (único: reencolar el mismo registro lo reemplaza). */
  clave: string;
  tipo: TipoOutbox;
  /** id del registro (para ruta_localidad: "ruta|localidad"). */
  rid: string;
  usuario_id: string;
  payload: Record<string, unknown>;
  estado: 'pendiente' | 'error';
  error?: string | null;
  intentos: number;
  creado_en: string;
  /** Se incrementa en cada edición local. */
  rev: number;
  /** El servidor CONFIRMÓ una versión anterior; si se edita después, se envía como UPDATE. */
  enviado_previo?: boolean;
  /**
   * Mayor `rev` con el que se intentó un INSERT (ignorar duplicados) y la respuesta pudo perderse: el servidor
   * podría tener esa versión aunque aquí no haya confirmación. Se guarda ANTES de la petición. Si el registro se
   * edita después (rev > este valor), un nuevo "ignorar duplicados" dejaría los valores viejos: hay que hacer UPDATE.
   */
  pudo_llegar_rev?: number;
}

interface EnvcaDB extends DBSchema {
  kv: { key: string; value: unknown };
  localidades: { key: string; value: Localidad };
  rutas: { key: string; value: Ruta };
  ruta_localidades: { key: string; value: RutaLocalidad & { k: string } };
  ruta_ruteros: { key: string; value: RutaRutero & { k: string } };
  mis_conteos: { key: string; value: Conteo; indexes: { por_fecha: string } };
  outbox: { key: number; value: ItemOutbox; indexes: { por_clave: string } };
}

export const DB_NOMBRE = 'envca-offline';
let promesa: Promise<IDBPDatabase<EnvcaDB>> | null = null;

export function db(): Promise<IDBPDatabase<EnvcaDB>> {
  if (!promesa) {
    promesa = openDB<EnvcaDB>(DB_NOMBRE, 1, {
      upgrade(d) {
        d.createObjectStore('kv');
        d.createObjectStore('localidades', { keyPath: 'id' });
        d.createObjectStore('rutas', { keyPath: 'id' });
        d.createObjectStore('ruta_localidades', { keyPath: 'k' });
        d.createObjectStore('ruta_ruteros', { keyPath: 'k' });
        const mc = d.createObjectStore('mis_conteos', { keyPath: 'id' });
        mc.createIndex('por_fecha', 'fecha');
        const ob = d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        ob.createIndex('por_clave', 'clave', { unique: true });
      },
    });
    promesa.catch(() => { promesa = null; });
  }
  return promesa;
}

/** Solo para pruebas: reinicia la conexión. */
export async function _cerrarParaPruebas(): Promise<void> {
  if (promesa) { (await promesa).close(); promesa = null; }
}

// ---- kv / perfil ----------------------------------------------------------
export async function kvGet<T>(k: string): Promise<T | undefined> {
  return (await (await db()).get('kv', k)) as T | undefined;
}
export async function kvSet(k: string, v: unknown): Promise<void> {
  await (await db()).put('kv', v, k);
}
export async function kvDel(k: string): Promise<void> {
  await (await db()).delete('kv', k);
}

export const getPerfilLocal = () => kvGet<Perfil>('perfil');
export const setPerfilLocal = (p: Perfil) => kvSet('perfil', p);
export const delPerfilLocal = () => kvDel('perfil');

// ---- catálogos --------------------------------------------------------------
export interface Catalogos {
  localidades: Localidad[];
  rutas: Ruta[];
  ruta_localidades: RutaLocalidad[];
  ruta_ruteros: RutaRutero[];
}

export async function guardarCatalogos(c: Catalogos): Promise<void> {
  const d = await db();
  const tx = d.transaction(['localidades', 'rutas', 'ruta_localidades', 'ruta_ruteros', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('localidades').clear(),
    tx.objectStore('rutas').clear(),
    tx.objectStore('ruta_localidades').clear(),
    tx.objectStore('ruta_ruteros').clear(),
  ]);
  for (const x of c.localidades) tx.objectStore('localidades').put(x);
  for (const x of c.rutas) tx.objectStore('rutas').put(x);
  for (const x of c.ruta_localidades) tx.objectStore('ruta_localidades').put({ ...x, k: `${x.ruta_id}|${x.localidad_id}` });
  for (const x of c.ruta_ruteros) tx.objectStore('ruta_ruteros').put({ ...x, k: `${x.ruta_id}|${x.usuario_id}` });
  tx.objectStore('kv').put(new Date().toISOString(), 'catalogos_en');
  await tx.done;
}

export async function leerCatalogos(): Promise<Catalogos & { actualizado: string | null }> {
  const d = await db();
  const [localidades, rutas, rl, rr, act] = await Promise.all([
    d.getAll('localidades'), d.getAll('rutas'), d.getAll('ruta_localidades'), d.getAll('ruta_ruteros'),
    d.get('kv', 'catalogos_en'),
  ]);
  return {
    localidades, rutas,
    ruta_localidades: rl.map(({ k: _k, ...r }) => r),
    ruta_ruteros: rr.map(({ k: _k, ...r }) => r),
    actualizado: (act as string | undefined) ?? null,
  };
}

// ---- cache de mis conteos enviados ----------------------------------------
export async function guardarMisConteos(lista: Conteo[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('mis_conteos', 'readwrite');
  for (const c of lista) tx.store.put(c);
  await tx.done;
}
export async function leerMisConteos(desde: string): Promise<Conteo[]> {
  const d = await db();
  return d.getAllFromIndex('mis_conteos', 'por_fecha', IDBKeyRange.lowerBound(desde));
}
export async function podarMisConteos(antesDe: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('mis_conteos', 'readwrite');
  let cur = await tx.store.index('por_fecha').openCursor(IDBKeyRange.upperBound(antesDe, true));
  while (cur) { await cur.delete(); cur = await cur.continue(); }
  await tx.done;
}

/** Borra TODO lo guardado del usuario excepto la bandeja de salida (no se pierden pendientes). */
export async function limpiarDatosUsuario(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['kv', 'localidades', 'rutas', 'ruta_localidades', 'ruta_ruteros', 'mis_conteos'], 'readwrite');
  await Promise.all([
    tx.objectStore('kv').clear(), tx.objectStore('localidades').clear(), tx.objectStore('rutas').clear(),
    tx.objectStore('ruta_localidades').clear(), tx.objectStore('ruta_ruteros').clear(), tx.objectStore('mis_conteos').clear(),
  ]);
  await tx.done;
}

/** Reemplaza lo guardado desde `desde` con la lista del servidor (refleja ediciones y borrados). */
export async function reemplazarMisConteos(desde: string, lista: Conteo[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('mis_conteos', 'readwrite');
  let cur = await tx.store.index('por_fecha').openCursor(IDBKeyRange.lowerBound(desde));
  while (cur) { await cur.delete(); cur = await cur.continue(); }
  for (const c of lista) tx.store.put(c);
  await tx.done;
}
