import { supabase } from './supabase';
import { COD_SIN_FILAS, desdeExcepcion } from './errors';
import type { Transport, ResultadoRemoto } from './outbox';

/** Transporte real hacia Supabase. Cualquier excepción de fetch (incluido el tope de 15 s de `supabase.ts`) se devuelve como error de red (status 0). */
export const transportSupabase: Transport = {
  async upsert(tabla, fila, onConflict): Promise<ResultadoRemoto> {
    try {
      const r = await supabase.from(tabla).upsert(fila, { onConflict, ignoreDuplicates: true });
      return { error: r.error, status: r.status };
    } catch (x) { return { error: desdeExcepcion(x), status: 0 }; }
  },
  async update(tabla, id, cambios): Promise<ResultadoRemoto> {
    try {
      const r = await supabase.from(tabla).update(cambios).eq('id', id).select('id');
      if (!r.error && (!r.data || r.data.length === 0)) {
        // RLS filtra en silencio: 0 filas SIN error = sin permiso (p. ej. fuera de la ventana de edición) o ya no existe.
        // Se trata como error permanente (403) con un código propio para dar un mensaje claro.
        return { error: { message: 'La actualización no afectó ninguna fila.', code: COD_SIN_FILAS }, status: 403 };
      }
      return { error: r.error, status: r.status };
    } catch (x) { return { error: desdeExcepcion(x), status: 0 }; }
  },
};
