import { useCallback, useEffect, useRef, useState } from 'react';
import type { Resp } from './api';

/** Carga de datos con estados claros: cargando / error / datos. `recargar` vuelve a consultar. */
export function useQuery<T>(fn: () => Promise<Resp<T>>, deps: unknown[]): { data: T | null; error: string | null; cargando: boolean; recargar: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [n, setN] = useState(0);
  const idRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const id = ++idRef.current;
    setCargando(true);
    fnRef.current().then((r) => {
      if (id !== idRef.current) return;
      setData(r.error ? null : r.data);
      setError(r.error);
      setCargando(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const recargar = useCallback(() => setN((x) => x + 1), []);
  return { data, error, cargando, recargar };
}

export function useDebounced<T>(v: T, ms = 350): T {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return x;
}
