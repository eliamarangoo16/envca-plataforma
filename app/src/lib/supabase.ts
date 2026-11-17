import { createClient } from '@supabase/supabase-js';
import { fetchConTope } from './tiempo';

// URL y clave PUBLICABLE (son públicas por diseño). Nunca poner aquí la service key.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://axyzkxannqpyxlxehaoc.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_8stpdoWnMvxl2Rx8cpBMbA_9mk0_MUD';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // Toda petición (datos y auth) tiene tope de 15 s; al vencer cuenta como error de red.
  global: { fetch: fetchConTope() },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'envca-auth' },
});
