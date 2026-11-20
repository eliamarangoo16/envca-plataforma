import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { fechaHoraMX, fechaMX, sumarDias } from '../lib/time';
import { fmtMXN } from '../lib/money';
import { Aviso, Campo, Cargando, ErrorCaja, Pagina, Vacio } from '../components/ui';
import { useListasBase } from './Conteos';

type Accion = 'creada' | 'modificada' | 'borrada';

interface Fila {
  id: number;
  tarifa_id: string | null;
  destino: string | null;
  accion: Accion;
  usuario_id: string | null;
  cambios: Record<string, { antes?: unknown; despues?: unknown }> | null;
  creada_en: string;
}

const ETIQUETAS: Record<Accion, string> = { creada: 'Creada', modificada: 'Modificada', borrada: 'Borrada' };
const CAMPOS: Record<string, string> = { destino: 'Destino', precio_por_kg: 'Precio por kg', moneda: 'Moneda', activa: 'Activa' };

function legible(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (campo === 'precio_por_kg') return fmtMXN(Number(v));
  return String(v);
}

/** Quién creó, cambió o borró tarifas. Solo administradores principales (la base también lo exige). */
export function BitacoraTarifas() {
  const base = useListasBase();
  const hoy = fechaMX();
  const [desde, setDesde] = useState(sumarDias(hoy, -29));
  const [hasta, setHasta] = useState(hoy);
  const [usuario, setUsuario] = useState('');
  const [limite, setLimite] = useState(200);

  const datos = useQuery<Fila[]>(() => {
    let qy = supabase
      .from('tarifas_bitacora')
      .select('id,tarifa_id,destino,accion,usuario_id,cambios,creada_en')
      .gte('creada_en', `${desde}T00:00:00-06:00`)
      .lte('creada_en', `${hasta}T23:59:59-06:00`);
    if (usuario) qy = qy.eq('usuario_id', usuario);
    return q<Fila[]>(qy.order('creada_en', { ascending: false }).order('id', { ascending: false }).limit(limite));
  }, [desde, hasta, usuario, limite]);

  const nombres = base.data?.nombres ?? {};
  const usuarios = useMemo(() => Object.entries(nombres).sort((a, b) => a[1].localeCompare(b[1], 'es')), [nombres]);
  const filas = datos.data ?? [];
  const nombreDe = (id: string | null) => (id ? nombres[id] ?? 'Usuario sin nombre' : 'Sistema');

  return (
    <Pagina titulo="Bitácora de tarifas">
      <Aviso tipo="info">Aquí queda quién creó, cambió o borró una tarifa, con el valor antes y después. Solo lo ven los administradores principales.</Aviso>
      <div className="grid-filtros">
        <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <Campo etiqueta="Quién">
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </Campo>
      </div>
      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : !filas.length ? (
        <Vacio>No hay movimientos de tarifas en ese periodo.</Vacio>
      ) : (
        <>
          <div className="tabla-w">
            <table>
              <thead><tr><th>Cuándo</th><th>Destino</th><th>Acción</th><th>Quién</th><th>Cambios</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td>{fechaHoraMX(f.creada_en)}</td>
                    <td><b>{f.destino ?? '—'}</b></td>
                    <td><span className={`pill ${f.accion === 'borrada' ? 'warn' : 'ok'}`}>{ETIQUETAS[f.accion]}</span></td>
                    <td>{nombreDe(f.usuario_id)}</td>
                    <td>
                      {Object.entries(f.cambios ?? {}).map(([k, v]) => (
                        <div key={k}><small>{CAMPOS[k] ?? k}:</small> {'antes' in v && 'despues' in v ? `${legible(k, v.antes)} → ${legible(k, v.despues)}` : legible(k, v.despues ?? v.antes)}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length >= limite && <button className="btn" onClick={() => setLimite(limite + 200)}>Ver más</button>}
        </>
      )}
    </Pagina>
  );
}
