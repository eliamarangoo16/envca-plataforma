import { useEffect, useState } from 'react';
import { leerCatalogos, leerMisConteos, reemplazarMisConteos, podarMisConteos, type Catalogos } from './db';
import { listarOutbox, suscribirOutbox } from './outbox';
import { supabase } from './supabase';
import { q } from './api';
import { fechaMX, sumarDias } from './time';
import type { Conteo, Localidad, RutaLocalidad } from './types';
import type { ItemOutbox } from './db';
import { useSync } from './sync';

export interface CatalogoVista extends Catalogos { actualizado: string | null; cargado: boolean }

/** Catálogos locales + lo que está en bandeja (localidades y vínculos aún no confirmados). */
export function useCatalogosLocal(userId: string | null): CatalogoVista {
  const { version } = useSync();
  const [v, setV] = useState<CatalogoVista>({ localidades: [], rutas: [], ruta_localidades: [], ruta_ruteros: [], actualizado: null, cargado: false });
  const [tick, setTick] = useState(0);
  useEffect(() => suscribirOutbox(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [c, ob] = await Promise.all([leerCatalogos(), userId ? listarOutbox(userId) : Promise.resolve([] as ItemOutbox[])]);
      const locs = new Map<string, Localidad>(c.localidades.map((l) => [l.id, l]));
      const links = new Map<string, RutaLocalidad>(c.ruta_localidades.map((r) => [`${r.ruta_id}|${r.localidad_id}`, r]));
      for (const it of ob) {
        if (it.tipo === 'localidad' && !locs.has(it.rid)) locs.set(it.rid, { ...(it.payload as unknown as Localidad), pendiente: true });
        if (it.tipo === 'ruta_localidad') { const r = it.payload as unknown as RutaLocalidad; const k = `${r.ruta_id}|${r.localidad_id}`; if (!links.has(k)) links.set(k, r); }
      }
      if (!vivo) return;
      setV({ ...c, localidades: [...locs.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), ruta_localidades: [...links.values()], cargado: true });
    })();
    return () => { vivo = false; };
  }, [userId, version, tick]);
  return v;
}

export interface RegistroVista {
  conteo: Conteo;
  estado: 'enviado' | 'pendiente' | 'error';
  error?: string | null;
  seq?: number;
}

/** Mis conteos de hoy y ayer (enviados desde la copia local + los de la bandeja). */
export function useMisRegistros(userId: string | null): { registros: RegistroVista[]; otros: ItemOutbox[]; cargado: boolean } {
  const { version } = useSync();
  const [r, setR] = useState<{ registros: RegistroVista[]; otros: ItemOutbox[]; cargado: boolean }>({ registros: [], otros: [], cargado: false });
  const [tick, setTick] = useState(0);
  useEffect(() => suscribirOutbox(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const ayer = sumarDias(fechaMX(), -1);
      const [enviados, ob] = await Promise.all([leerMisConteos(ayer), userId ? listarOutbox(userId) : Promise.resolve([] as ItemOutbox[])]);
      const pend = new Map<string, RegistroVista>();
      for (const it of ob) if (it.tipo === 'conteo') pend.set(it.rid, { conteo: it.payload as unknown as Conteo, estado: it.estado === 'error' ? 'error' : 'pendiente', error: it.error, seq: it.seq });
      const lista: RegistroVista[] = [...pend.values()];
      for (const c of enviados) if (!pend.has(c.id) && (!userId || c.usuario_id === userId)) lista.push({ conteo: c, estado: 'enviado' });
      lista.sort((a, b) => (b.conteo.capturado_en ?? b.conteo.fecha).localeCompare(a.conteo.capturado_en ?? a.conteo.fecha));
      if (!vivo) return;
      setR({ registros: lista, otros: ob.filter((i) => i.tipo !== 'conteo'), cargado: true });
    })();
    return () => { vivo = false; };
  }, [userId, version, tick]);
  return r;
}

/** Baja del servidor mis conteos de hoy y ayer y los guarda en la copia local. */
export async function refrescarMisConteos(userId: string): Promise<{ ok: boolean; red: boolean }> {
  const ayer = sumarDias(fechaMX(), -1);
  const r = await q<Conteo[]>(supabase.from('conteos').select('id,tipo,fecha,ruta_id,localidad_id,cantidad,notas,usuario_id,capturado_en,creado_en').eq('usuario_id', userId).gte('fecha', ayer).order('capturado_en', { ascending: false }).order('id').limit(1000));
  if (r.error) return { ok: false, red: r.clase === 'network' };
  await reemplazarMisConteos(ayer, r.data ?? []);
  await podarMisConteos(sumarDias(ayer, -7));
  return { ok: true, red: false };
}
