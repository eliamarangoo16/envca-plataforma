import { clasificarError, desdeExcepcion, mensajeError, type ClaseError, type ErrorRemoto } from './errors';

export interface Resp<T> { data: T | null; error: string | null; clase: ClaseError | null; raw?: ErrorRemoto | null }

interface Resultado<T> { data: T | null; error: ErrorRemoto | null; status: number }

/** Ejecuta una consulta de Supabase y devuelve un resultado uniforme (nunca lanza). */
export async function q<T>(p: PromiseLike<Resultado<T>>): Promise<Resp<T>> {
  try {
    const r = await p;
    if (r.error) return { data: null, error: mensajeError(r.error, r.status), clase: clasificarError(r.error, r.status), raw: r.error };
    return { data: r.data, error: null, clase: null };
  } catch (x) {
    const e = desdeExcepcion(x);
    return { data: null, error: mensajeError(e, 0), clase: 'network', raw: e };
  }
}

/**
 * Pagina de 1000 en 1000 (el límite por defecto de PostgREST) hasta traer todo.
 * IMPORTANTE: la consulta DEBE tener un orden TOTAL (que termine en una llave única: id, o la llave compuesta);
 * sin desempate, Postgres puede repetir u omitir filas entre páginas. `tests/paginacion.test.ts` lo vigila.
 */
export async function traerTodo<T>(pagina: (desde: number, hasta: number) => PromiseLike<Resultado<T[]>>): Promise<Resp<T[]>> {
  const out: T[] = [];
  const TAM = 1000;
  for (let i = 0; i < 200; i++) {
    const r = await q<T[]>(pagina(i * TAM, i * TAM + TAM - 1));
    if (r.error) return { data: null, error: r.error, clase: r.clase, raw: r.raw };
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < TAM) break;
  }
  return { data: out, error: null, clase: null };
}
