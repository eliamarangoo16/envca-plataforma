import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';
import { contarOutbox, enviarBandeja, suscribirOutbox } from './outbox';
import { transportSupabase } from './transport';
import { refrescarCatalogos } from './catalogos';
import { refrescarMisConteos } from './local';
import { debeRefrescarCatalogos, type EstadoCatalogos } from './politicaSync';
import { conTope } from './tiempo';

/** Tope de toda una sincronización (ping + envío + catálogos): `sincronizando` siempre se libera. */
const TOPE_SYNC_MS = 120_000;

interface Ctx {
  /** true = hay conexión real con el servidor (no solo "navigator.onLine"). */
  enLinea: boolean;
  pendientes: number;
  conError: number;
  sincronizando: boolean;
  ultimaSync: Date | null;
  /** Incrementa tras cada refresco de catálogos o envío; las pantallas lo usan para recargar. */
  version: number;
  /** Si ya hay una sincronización en curso, devuelve esa misma promesa. */
  sincronizar(): Promise<void>;
}
const SyncCtx = createContext<Ctx | null>(null);
export const useSync = (): Ctx => { const c = useContext(SyncCtx); if (!c) throw new Error('SyncProvider faltante'); return c; };

/** Prueba real de alcance al servidor (cualquier respuesta HTTP cuenta como "hay red"). */
async function ping(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY }, signal: ctl.signal, cache: 'no-store' });
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}

async function refrescarSesion(): Promise<boolean> {
  try { const r = await conTope(supabase.auth.refreshSession(), 20_000, () => null); return !!r?.data.session; } catch { return false; }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { estado, perfil, userId, refrescarPerfil, usuarioActual } = useAuth();
  const [enLinea, setEnLinea] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
  const [conError, setConError] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSync, setUltima] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);
  const corrida = useRef<Promise<void> | null>(null);
  const cat = useRef<EstadoCatalogos>({ ultimoOk: 0, ultimoIntento: 0, forzar: true });
  const activo = estado === 'dentro' && !!userId && !!perfil;

  const recontar = useCallback(async () => {
    if (!userId) { setPendientes(0); setConError(0); return; }
    const c = await contarOutbox(userId).catch(() => ({ pendientes: 0, errores: 0, total: 0 }));
    setPendientes(c.pendientes);
    setConError(c.errores);
  }, [userId]);

  useEffect(() => { void recontar(); return suscribirOutbox(() => { void recontar(); }); }, [recontar]);

  const sincronizar = useCallback((): Promise<void> => {
    if (!activo || !userId) return Promise.resolve();
    if (corrida.current) return corrida.current;       // ya hay una en curso: quien llama espera a esa
    const trabajo = async () => {
      const alcanzable = await ping();
      setEnLinea(alcanzable);
      if (!alcanzable) { cat.current.forzar = true; return; }   // al volver la red se bajan los catálogos
      const r = await enviarBandeja(transportSupabase, userId, { refrescarSesion, sesionVigente: () => usuarioActual() === userId });
      if (r.detenido === 'network') { setEnLinea(false); cat.current.forzar = true; return; }
      if (r.detenido === 'sesion') return;
      if (r.detenido !== 'auth') {
        void refrescarPerfil();
        if (perfil?.rol === 'rutero') {
          // Catálogos completos: al abrir, al volver la red y como mucho cada 10 min. Lo pendiente se envía siempre.
          const ahora = Date.now();
          let bajoCatalogos = false;
          if (debeRefrescarCatalogos(ahora, cat.current)) {
            cat.current.ultimoIntento = ahora;
            const c = await refrescarCatalogos(userId, true);
            if (c.red) { setEnLinea(false); return; }
            if (c.ok) { cat.current.ultimoOk = Date.now(); cat.current.forzar = false; bajoCatalogos = true; }
          }
          if (bajoCatalogos || r.enviados > 0) {
            const m = await refrescarMisConteos(userId);
            if (m.red) { setEnLinea(false); return; }
          }
        }
      }
      setUltima(new Date());
    };
    const p = (async () => {
      setSincronizando(true);
      try {
        await conTope(trabajo(), TOPE_SYNC_MS, () => { setEnLinea(false); });
      } catch { /* un fallo inesperado no debe dejar la sincronización colgada */ }
      finally {
        corrida.current = null;
        setSincronizando(false);
        setVersion((v) => v + 1);
        void recontar();
      }
    })();
    corrida.current = p;
    return p;
  }, [activo, userId, perfil?.rol, refrescarPerfil, usuarioActual, recontar]);

  const ref = useRef(sincronizar);
  ref.current = sincronizar;

  // Disparadores: al abrir, evento online/offline, volver a primer plano, y reintento periódico.
  useEffect(() => {
    if (!activo) return;
    cat.current = { ultimoOk: 0, ultimoIntento: 0, forzar: true };   // al abrir: catálogos frescos
    void ref.current();
    const alOnline = () => { setEnLinea(true); cat.current.forzar = true; void ref.current(); };
    const alOffline = () => setEnLinea(false);
    const alVisible = () => { if (document.visibilityState === 'visible') void ref.current(); };
    window.addEventListener('online', alOnline);
    window.addEventListener('offline', alOffline);
    document.addEventListener('visibilitychange', alVisible);
    const iv = setInterval(() => { if (document.visibilityState === 'visible') void ref.current(); }, 30000);
    return () => {
      window.removeEventListener('online', alOnline);
      window.removeEventListener('offline', alOffline);
      document.removeEventListener('visibilitychange', alVisible);
      clearInterval(iv);
    };
  }, [activo]);

  const valor = useMemo<Ctx>(() => ({ enLinea, pendientes, conError, sincronizando, ultimaSync, version, sincronizar }),
    [enLinea, pendientes, conError, sincronizando, ultimaSync, version, sincronizar]);
  return <SyncCtx.Provider value={valor}>{children}</SyncCtx.Provider>;
}
