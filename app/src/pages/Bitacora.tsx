import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { fechaHoraMX, fechaMX, sumarDias } from '../lib/time';
import { fmtMXN } from '../lib/money';
import { Aviso, Campo, Cargando, ErrorCaja, Pagina, Vacio } from '../components/ui';
import { useListasBase } from './Conteos';

type Accion = 'creada' | 'modificada' | 'anulada' | 'borrada';

interface FilaBitacora {
  id: number;
  guia_id: string;
  folio: string;
  accion: Accion;
  usuario_id: string | null;
  rol: string | null;
  cambios: Record<string, { antes?: unknown; despues?: unknown }> | null;
  creada_en: string;
}

const ETIQUETAS: Record<Accion, string> = {
  creada: 'Creada',
  modificada: 'Modificada',
  anulada: 'Anulada',
  borrada: 'Borrada',
};

const CAMPOS: Record<string, string> = {
  sucursal: 'Sucursal',
  pago: 'Pago',
  peso_kg: 'Peso (kg)',
  metodo_pago: 'Método de pago',
  estado_pago: 'Estado de pago',
  tarifa_por_kg: 'Tarifa por kg',
  anulada: 'Anulada',
  notas: 'Notas',
  folio: 'Folio',
  bultos: 'Bultos',
  contenido: 'Contenido',
  remitente: 'Remitente',
  destinatario: 'Destinatario',
  direccion_eeuu: 'Dirección en EE. UU.',
  valor_declarado_mxn: 'Valor declarado',
  perecedero: 'Perecedero',
  tarifa_id: 'Tarifa',
  creada_por: 'Creada por',
  fecha_recepcion: 'Fecha de recepción',
  fecha_envio: 'Fecha de envío',
};

function valorLegible(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (campo === 'pago' || campo === 'valor_declarado_mxn') return fmtMXN(Number(v));
  return String(v);
}

function resumenCambios(f: FilaBitacora): { campo: string; texto: string }[] {
  const c = f.cambios ?? {};
  return Object.entries(c).map(([k, v]) => {
    const campo = CAMPOS[k] ?? k;
    if ('antes' in v && 'despues' in v) {
      return { campo, texto: `${valorLegible(k, v.antes)} → ${valorLegible(k, v.despues)}` };
    }
    return { campo, texto: valorLegible(k, v.despues ?? v.antes) };
  });
}

export function Bitacora() {
  const base = useListasBase();
  const hoy = fechaMX();
  const [desde, setDesde] = useState(sumarDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const [accion, setAccion] = useState<'' | Accion>('');
  const [usuario, setUsuario] = useState('');
  const [folio, setFolio] = useState('');
  const [limite, setLimite] = useState(200);

  const datos = useQuery<FilaBitacora[]>(() => {
    let qy = supabase
      .from('guias_bitacora')
      .select('id,guia_id,folio,accion,usuario_id,rol,cambios,creada_en')
      .gte('creada_en', `${desde}T00:00:00-06:00`)
      .lte('creada_en', `${hasta}T23:59:59-06:00`);
    if (accion) qy = qy.eq('accion', accion);
    if (usuario) qy = qy.eq('usuario_id', usuario);
    if (folio.trim()) qy = qy.ilike('folio', `%${folio.trim()}%`);
    return q<FilaBitacora[]>(qy.order('creada_en', { ascending: false }).order('id', { ascending: false }).limit(limite));
  }, [desde, hasta, accion, usuario, folio, limite]);

  const nombres = base.data?.nombres ?? {};
  const usuarios = useMemo(
    () => Object.entries(nombres).sort((a, b) => a[1].localeCompare(b[1], 'es')),
    [nombres],
  );
  const filas = datos.data ?? [];

  const nombreDe = (id: string | null) => (id ? nombres[id] ?? 'Usuario sin nombre' : 'Sistema');

  return (
    <Pagina titulo="Bitácora de guías">
      <Aviso tipo="info">
        Aquí queda quién creó, anuló, modificó o borró cada guía, con el valor antes y después. Solo lo ves tú como administrador nivel 1.
      </Aviso>

      <div className="grid-filtros">
        <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <Campo etiqueta="Acción">
          <select value={accion} onChange={(e) => setAccion(e.target.value as '' | Accion)}>
            <option value="">Todas</option>
            {(Object.keys(ETIQUETAS) as Accion[]).map((a) => <option key={a} value={a}>{ETIQUETAS[a]}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Quién">
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Folio">
          <input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Ej. SPH-3" />
        </Campo>
      </div>

      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : !filas.length ? (
        <Vacio>No hay movimientos con esos filtros.</Vacio>
      ) : (
        <>
          <div className="tabla-w">
            <table>
              <thead>
                <tr><th>Cuándo</th><th>Folio</th><th>Acción</th><th>Quién</th><th>Cambios</th></tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td>{fechaHoraMX(f.creada_en)}</td>
                    <td><b>{f.folio}</b></td>
                    <td><span className={`pill ${f.accion === "anulada" || f.accion === "borrada" ? "warn" : "ok"}`}>{ETIQUETAS[f.accion]}</span></td>
                    <td>{nombreDe(f.usuario_id)}{f.rol ? <small> · {f.rol}</small> : null}</td>
                    <td>
                      {resumenCambios(f).length
                        ? resumenCambios(f).map((c) => <div key={c.campo}><small>{c.campo}:</small> {c.texto}</div>)
                        : <small>Sin detalle</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length >= limite && (
            <button className="btn" onClick={() => setLimite(limite + 200)}>Ver más</button>
          )}
        </>
      )}
    </Pagina>
  );
}
