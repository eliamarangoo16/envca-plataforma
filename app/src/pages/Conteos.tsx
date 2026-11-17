import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, traerTodo } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { aCSV, descargarCSV } from '../lib/csv';
import { fechaLarga, fechaMX, sumarDias } from '../lib/time';
import type { Conteo, Localidad, Ruta, TipoConteo } from '../lib/types';
import { Aviso, Campo, Cargando, Confirmar, ErrorCaja, Modal, Pagina, Stepper, Vacio } from '../components/ui';
import { Icon } from '../components/Icon';

export function useListasBase() {
  const { perfil } = useAuth();
  const admin = perfil?.rol === 'administrador';
  return useQuery<{ localidades: Localidad[]; rutas: Ruta[]; nombres: Record<string, string> }>(async () => {
    const [l, r, p] = await Promise.all([
      traerTodo<Localidad>((a, b) => supabase.from('localidades').select('id,nombre,municipio,referencia,tiene_punto_recepcion,activa').order('nombre').order('id').range(a, b)),
      q<Ruta[]>(supabase.from('rutas').select('id,nombre,activa').order('nombre').order('id')),
      // Nivel 1 ve todos los perfiles; nivel 2 solo puede leer los de rol 'rutero' (RLS): se pide solo eso.
      traerTodo<{ id: string; nombre: string | null }>((a, b) => {
        let qy = supabase.from('perfiles').select('id,nombre');
        if (!admin) qy = qy.eq('rol', 'rutero');
        return qy.order('nombre').order('id').range(a, b);
      }),
    ]);
    const e = l.error ?? r.error;
    if (e) return { data: null, error: e, clase: l.clase ?? r.clase };
    // Los nombres no se bloquean la pantalla: si `perfiles` falla, el rutero se muestra como «—».
    const nombres: Record<string, string> = {};
    for (const x of p.data ?? []) if (x.nombre) nombres[x.id] = x.nombre;
    return { data: { localidades: l.data!, rutas: r.data!, nombres }, error: null, clase: null };
  }, [admin]);
}

export function Conteos() {
  const { perfil } = useAuth();
  const admin = perfil?.rol === 'administrador';
  const base = useListasBase();
  const hoy = fechaMX();
  const [desde, setDesde] = useState(sumarDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const [rutaId, setRutaId] = useState('');
  const [locId, setLocId] = useState('');
  const [tipo, setTipo] = useState<'' | TipoConteo>('');
  const [limite, setLimite] = useState(100);
  const [editar, setEditar] = useState<Conteo | null>(null);
  const [borrar, setBorrar] = useState<Conteo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const datos = useQuery<Conteo[]>(() => traerTodo<Conteo>((a, b) => {
    let qy = supabase.from('conteos').select('id,tipo,fecha,ruta_id,localidad_id,cantidad,notas,usuario_id,capturado_en').gte('fecha', desde).lte('fecha', hasta);
    if (rutaId) qy = qy.eq('ruta_id', rutaId);
    if (locId) qy = qy.eq('localidad_id', locId);
    if (tipo) qy = qy.eq('tipo', tipo);
    return qy.order('fecha', { ascending: false }).order('capturado_en', { ascending: false }).order('id').range(a, b);
  }), [desde, hasta, rutaId, locId, tipo]);

  const loc = useMemo(() => new Map((base.data?.localidades ?? []).map((l) => [l.id, l.nombre])), [base.data]);
  const rut = useMemo(() => new Map((base.data?.rutas ?? []).map((r) => [r.id, r.nombre])), [base.data]);
  const filas = datos.data ?? [];
  const porRuta = useMemo(() => agrupar(filas.filter((f) => f.tipo === 'recepcion' && f.ruta_id), (f) => rut.get(f.ruta_id!) ?? '(ruta)'), [filas, rut]);
  const porLocRec = useMemo(() => agrupar(filas.filter((f) => f.tipo === 'recepcion'), (f) => loc.get(f.localidad_id) ?? '(localidad)'), [filas, loc]);
  const porLocSal = useMemo(() => agrupar(filas.filter((f) => f.tipo === 'salida'), (f) => loc.get(f.localidad_id) ?? '(localidad)'), [filas, loc]);
  const totRec = filas.filter((f) => f.tipo === 'recepcion').reduce((a, f) => a + f.cantidad, 0);
  const totSal = filas.filter((f) => f.tipo === 'salida').reduce((a, f) => a + f.cantidad, 0);
  const nombreUsuario = (id: string) => base.data?.nombres[id] ?? '—';

  function exportar() {
    const csv = aCSV(filas, [
      { titulo: 'Fecha', valor: (f) => f.fecha }, { titulo: 'Tipo', valor: (f) => (f.tipo === 'recepcion' ? 'Recepción' : 'Salida') },
      { titulo: 'Ruta', valor: (f) => (f.ruta_id ? rut.get(f.ruta_id) ?? '' : '') }, { titulo: 'Localidad', valor: (f) => loc.get(f.localidad_id) ?? '' },
      { titulo: 'Cantidad', valor: (f) => f.cantidad }, { titulo: 'Rutero', valor: (f) => nombreUsuario(f.usuario_id) },
      { titulo: 'Capturado (UTC)', valor: (f) => f.capturado_en }, { titulo: 'Notas', valor: (f) => f.notas },
    ]);
    descargarCSV(`conteos-envca-${desde}_a_${hasta}.csv`, csv);
  }

  async function hacerBorrar() {
    if (!borrar) return;
    const r = await q(supabase.from('conteos').delete().eq('id', borrar.id).select('id'));
    setBorrar(null);
    if (r.error) { setAviso(r.error); return; }
    if (!(r.data as unknown[] | null)?.length) { setAviso('No se borró nada: no tienes permiso o el registro ya no existe.'); return; }
    setAviso('Registro eliminado.'); datos.recargar();
  }

  return (
    <Pagina titulo="Conteos" acciones={<button className="btn chico" onClick={exportar} disabled={!filas.length}><Icon n="descarga" /> Exportar CSV</button>}>
      {base.error && <ErrorCaja error={base.error} onReintentar={base.recargar} />}
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
      <div className="tarjeta col">
        <div className="grid2">
          <Campo etiqueta="Desde"><input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} /></Campo>
          <Campo etiqueta="Hasta"><input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} /></Campo>
        </div>
        <div className="grid2">
          <Campo etiqueta="Ruta"><select value={rutaId} onChange={(e) => setRutaId(e.target.value)}><option value="">Todas</option>{(base.data?.rutas ?? []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as '' | TipoConteo)}><option value="">Recepción y salida</option><option value="recepcion">Recepción</option><option value="salida">Salida</option></select></Campo>
        </div>
        <Campo etiqueta="Localidad"><select value={locId} onChange={(e) => setLocId(e.target.value)}><option value="">Todas</option>{(base.data?.localidades ?? []).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></Campo>
      </div>

      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : filas.length === 0 ? (
        <Vacio>No hay conteos con estos filtros ({fechaLarga(desde)} a {fechaLarga(hasta)}).</Vacio>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v">{totRec}</div><div className="l">Paquetes recibidos</div></div>
            <div className="kpi"><div className="v">{totSal}</div><div className="l">Paquetes en salidas</div></div>
            <div className="kpi"><div className="v">{filas.length}</div><div className="l">Registros</div></div>
          </div>
          <Totales titulo="Recepción por ruta" filas={porRuta} />
          <Totales titulo="Recepción por localidad" filas={porLocRec} />
          <Totales titulo="Salidas por localidad" filas={porLocSal} />
          <h2>Registros</h2>
          <div className="tabla-w"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Ruta</th><th>Localidad</th><th className="num">Cant.</th><th>Rutero</th><th>Notas</th>{admin && <th />}</tr></thead>
            <tbody>
              {filas.slice(0, limite).map((f) => (
                <tr key={f.id}>
                  <td>{f.fecha}</td><td>{f.tipo === 'recepcion' ? 'Recepción' : 'Salida'}</td><td>{f.ruta_id ? rut.get(f.ruta_id) ?? '' : '—'}</td>
                  <td>{loc.get(f.localidad_id) ?? '(localidad)'}</td><td className="num">{f.cantidad}</td><td>{nombreUsuario(f.usuario_id)}</td><td>{f.notas}</td>
                  {admin && <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn chico" onClick={() => setEditar(f)} aria-label="Editar"><Icon n="editar" /></button>{' '}
                    <button className="btn chico danger" onClick={() => setBorrar(f)} aria-label="Borrar"><Icon n="cerrar" /></button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table></div>
          {filas.length > limite && <button className="btn bloque" onClick={() => setLimite((l) => l + 200)}>Mostrar más ({filas.length - limite} restantes)</button>}
        </>
      )}
      {editar && <EditarConteoAdmin c={editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); datos.recargar(); }} />}
      {borrar && <Confirmar titulo="Borrar registro" peligro textoOk="Borrar" texto={<p>Se eliminará el conteo de <b>{borrar.cantidad}</b> paquetes ({loc.get(borrar.localidad_id)}, {borrar.fecha}).</p>} onOk={() => void hacerBorrar()} onCancelar={() => setBorrar(null)} />}
    </Pagina>
  );
}

function agrupar(filas: Conteo[], clave: (c: Conteo) => string): { etiqueta: string; valor: number }[] {
  const m = new Map<string, number>();
  for (const f of filas) m.set(clave(f), (m.get(clave(f)) ?? 0) + f.cantidad);
  return [...m.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor })).sort((a, b) => b.valor - a.valor);
}

function Totales({ titulo, filas }: { titulo: string; filas: { etiqueta: string; valor: number }[] }) {
  const total = filas.reduce((a, f) => a + f.valor, 0);
  return (
    <section>
      <h2>{titulo}</h2>
      {filas.length === 0 ? <Vacio>Sin datos.</Vacio> : (
        <div className="tabla-w"><table>
          <thead><tr><th>{titulo.includes('ruta') ? 'Ruta' : 'Localidad'}</th><th className="num">Paquetes</th></tr></thead>
          <tbody>{filas.map((f) => <tr key={f.etiqueta}><td>{f.etiqueta}</td><td className="num">{f.valor}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{total}</td></tr></tfoot>
        </table></div>
      )}
    </section>
  );
}

function EditarConteoAdmin({ c, onCerrar, onListo }: { c: Conteo; onCerrar: () => void; onListo: () => void }) {
  const [cantidad, setCantidad] = useState(c.cantidad);
  const [notas, setNotas] = useState(c.notas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    setOcupado(true); setError(null);
    const r = await q(supabase.from('conteos').update({ cantidad, notas: notas.trim() || null }).eq('id', c.id).select('id'));
    setOcupado(false);
    if (r.error) return setError(r.error);
    if (!(r.data as unknown[] | null)?.length) return setError('No se actualizó nada: no tienes permiso o el registro ya no existe.');
    onListo();
  }
  return (
    <Modal titulo="Editar conteo" onCerrar={onCerrar}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        <Campo etiqueta="Cantidad"><Stepper valor={cantidad} onCambio={setCantidad} /></Campo>
        <Campo etiqueta="Notas"><textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
      </div>
      <div className="acciones"><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()} disabled={ocupado}>Guardar</button></div>
    </Modal>
  );
}
