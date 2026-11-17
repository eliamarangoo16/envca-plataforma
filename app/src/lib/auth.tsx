import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { q } from './api';
import { getPerfilLocal, limpiarDatosUsuario, setPerfilLocal } from './db';
import type { Perfil, Rol } from './types';

/**
 * Arranque sin red: se usa el perfil guardado en IndexedDB y la sesión local de Supabase.
 * Nada de lo que bloquea el inicio depende de la red; el refresco ocurre en segundo plano.
 */
export type EstadoAuth = 'cargando' | 'fuera' | 'dentro' | 'inactivo' | 'sin_perfil_sin_red';

interface Ctx {
  estado: EstadoAuth;
  perfil: Perfil | null;
  userId: string | null;
  mensaje: string | null;
  entrar(email: string, password: string): Promise<string | null>;
  salir(): Promise<void>;
  refrescarPerfil(): Promise<void>;
  /** Usuario de la sesión activa AHORA (lectura síncrona, sin esperar a React). */
  usuarioActual(): string | null;
}

const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = (): Ctx => { const c = useContext(AuthCtx); if (!c) throw new Error('AuthProvider faltante'); return c; };

const ROLES: Rol[] = ['administrador', 'admin_n2', 'rutero', 'sucursal'];
export const MSG_INACTIVA = 'Tu cuenta no está activa, contacta a un administrador';

type FilaPerfil = { id: string; nombre: string | null; sucursal: string | null; rol: string; activo?: boolean | null };

/**
 * Baja el perfil. NUNCA asume "activo" ante un fallo: si la consulta falla (red u otra causa) devuelve error y el
 * llamador decide (usar la copia guardada si la hay, o mostrar el error). Solo `activo === true` es activo.
 */
export async function bajarPerfil(uid: string): Promise<{ perfil: Perfil | null; red: boolean; error: string | null }> {
  const r = await q<FilaPerfil[]>(supabase.from('perfiles').select('id,nombre,sucursal,rol,activo').eq('id', uid).limit(1));
  if (r.error) return { perfil: null, red: r.clase === 'network', error: r.error };
  const f = r.data?.[0];
  if (!f) return { perfil: null, red: false, error: null };
  const rol = ROLES.includes(f.rol as Rol) ? (f.rol as Rol) : null;
  // Rol desconocido = sin acceso (la UI nunca asume permisos).
  return { perfil: { id: f.id, nombre: f.nombre, sucursal: f.sucursal, rol: (rol ?? 'sucursal') as Rol, activo: rol !== null && f.activo === true }, red: false, error: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAuth>('cargando');
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const userRef = useRef<string | null>(null);

  const cerrarLocal = useCallback(async (msg: string | null) => {
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* sin red: se limpia a mano abajo */ }
    try { Object.keys(localStorage).filter((k) => k.startsWith('envca-auth')).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
    await limpiarDatosUsuario().catch(() => {});   // la bandeja de salida NO se toca
    userRef.current = null;
    setPerfil(null);
    setMensaje(msg);
    setEstado('fuera');
  }, []);

  const aplicarPerfil = useCallback(async (p: Perfil) => {
    if (!p.activo) {
      // Cuenta inactiva: se cierra la sesión local (sin borrar la bandeja) y se explica en el login.
      await cerrarLocal(MSG_INACTIVA);
      setEstado('inactivo');
      return;
    }
    setPerfil(p);
    setEstado('dentro');
    setMensaje(null);
    await setPerfilLocal(p).catch(() => {});
  }, [cerrarLocal]);

  const refrescarPerfil = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return;
    const r = await bajarPerfil(uid);
    if (r.red || r.error) return;                       // sin red: se conserva la copia local
    if (!r.perfil) { await cerrarLocal(MSG_INACTIVA); setEstado('inactivo'); return; }
    await aplicarPerfil(r.perfil);
  }, [aplicarPerfil, cerrarLocal]);

  // Arranque
  useEffect(() => {
    let vivo = true;
    (async () => {
      const local = await getPerfilLocal().catch(() => undefined);
      if (!vivo) return;
      if (local?.activo) { userRef.current = local.id; setPerfil(local); setEstado('dentro'); }   // ya se puede trabajar sin red

      type Err = { name?: string; status?: number } | null;
      const sesion = await Promise.race<{ session: { user: { id: string } } | null; err: Err }>([
        supabase.auth.getSession().then((r) => ({ session: r.data.session, err: r.error as Err })).catch((x: unknown) => ({ session: null, err: { name: (x as Error)?.name ?? 'x' } as Err })),
        new Promise<{ session: null; err: Err }>((res) => setTimeout(() => res({ session: null, err: { name: 'timeout' } }), 5000)),
      ]);
      if (!vivo) return;
      const { session, err } = sesion;

      if (session) {
        userRef.current = session.user.id;
        if (local && local.id === session.user.id) { void refrescarPerfil(); return; }
        const r = await bajarPerfil(session.user.id);
        if (!vivo) return;
        if (r.perfil) await aplicarPerfil(r.perfil);
        else if (r.red || r.error) setEstado('sin_perfil_sin_red');
        else { await cerrarLocal(MSG_INACTIVA); setEstado('inactivo'); }
        return;
      }
      // Sin sesión utilizable. Un fallo de red al renovar NO es "sesión cerrada".
      const esRed = !!err && (err.name === 'AuthRetryableFetchError' || err.name === 'timeout' || !err.status);
      if (local?.activo && esRed) return;               // sesión vencida pero sin red: seguir con la copia local
      if (!local) { setEstado('fuera'); return; }
      await cerrarLocal(null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') {
        setTimeout(() => { if (userRef.current) void cerrarLocal(null); }, 0);
      }
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [aplicarPerfil, cerrarLocal, refrescarPerfil]);

  const entrar = useCallback(async (email: string, password: string): Promise<string | null> => {
    let r;
    try { r = await supabase.auth.signInWithPassword({ email: email.trim(), password }); }
    catch { return 'Sin conexión. Se necesita señal para iniciar sesión.'; }
    if (r.error || !r.data.user) {
      const e = r.error;
      if (!e) return 'No se pudo iniciar sesión.';
      if (e.name === 'AuthRetryableFetchError' || !('status' in e) || !e.status) return 'Sin conexión. Se necesita señal para iniciar sesión.';
      if (/invalid login|invalid_credentials/i.test(`${e.message} ${(e as { code?: string }).code}`)) return 'Correo o contraseña incorrectos.';
      if (/email not confirmed/i.test(e.message)) return 'Tu correo aún no está confirmado.';
      if (e.status === 429) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
      return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
    }
    userRef.current = r.data.user.id;
    const p = await bajarPerfil(r.data.user.id);
    if (p.red || p.error) { await cerrarLocal(null); return p.error ?? 'No se pudo cargar tu perfil.'; }
    if (!p.perfil || !p.perfil.activo) {
      await cerrarLocal(MSG_INACTIVA); setEstado('inactivo');
      return MSG_INACTIVA;
    }
    await aplicarPerfil(p.perfil);
    return null;
  }, [aplicarPerfil, cerrarLocal]);

  const salir = useCallback(async () => { await cerrarLocal(null); }, [cerrarLocal]);

  const usuarioActual = useCallback(() => userRef.current, []);

  const valor = useMemo<Ctx>(() => ({ estado, perfil, userId: perfil?.id ?? userRef.current, mensaje, entrar, salir, refrescarPerfil, usuarioActual }),
    [estado, perfil, mensaje, entrar, salir, refrescarPerfil, usuarioActual]);
  return <AuthCtx.Provider value={valor}>{children}</AuthCtx.Provider>;
}
