import { supabase } from './supabase';
import { traerTodo, q } from './api';
import { guardarCatalogos } from './db';
import type { Localidad, Ruta, RutaLocalidad, RutaRutero } from './types';

export interface ResultadoCatalogos { ok: boolean; red: boolean; error: string | null }

/** Baja los catálogos del servidor y los guarda en IndexedDB (todo o nada). */
export async function refrescarCatalogos(userId: string, esRutero: boolean): Promise<ResultadoCatalogos> {
  const [loc, rut, rl, rr] = await Promise.all([
    traerTodo<Localidad>((a, b) => supabase.from('localidades').select('id,nombre,municipio,referencia,tiene_punto_recepcion,activa,creada_por,creada_en').order('nombre').order('id').range(a, b)),
    q<Ruta[]>(supabase.from('rutas').select('id,nombre,activa,creada_en').order('nombre').order('id')),
    traerTodo<RutaLocalidad>((a, b) => supabase.from('ruta_localidades').select('ruta_id,localidad_id,dia_semana,orden').order('ruta_id').order('localidad_id').range(a, b)),
    traerTodo<RutaRutero>((a, b) => {
      let qy = supabase.from('ruta_ruteros').select('ruta_id,usuario_id');
      if (esRutero) qy = qy.eq('usuario_id', userId);
      return qy.order('ruta_id').order('usuario_id').range(a, b);
    }),
  ]);
  const fallo = [loc, rut, rl, rr].find((x) => x.error);
  if (fallo) return { ok: false, red: fallo.clase === 'network', error: fallo.error };
  await guardarCatalogos({ localidades: loc.data!, rutas: rut.data!, ruta_localidades: rl.data!, ruta_ruteros: rr.data! });
  return { ok: true, red: false, error: null };
}
