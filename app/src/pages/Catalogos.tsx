import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { q, traerTodo } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { nuevoId } from '../lib/ids';
import { DIAS } from '../lib/time';
import type { ErrorRemoto } from '../lib/errors';
import type { Localidad, Ruta, RutaLocalidad } from '../lib/types';
import { Aviso, Campo, Cargando, Confirmar, ErrorCaja, Modal, Pagina, Vacio } from '../components/ui';
import { Icon } from '../components/Icon';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ------------------------------------------------------------ Localidades
export function Localidades() {
  const { perfil, userId } = useAuth();
  const admin = perfil?.rol === 'administrador';
  const datos = useQuery<Localidad[]>(() => traerTodo<Localidad>((a, b) => supabase.from('localidades').select('id,nombre,municipio,referencia,tiene_punto_recepcion,activa').order('nombre').order('id').range(a, b)), []);
  const [txt, setTxt] = useState('');
  const [soloPuntos, setSoloPuntos] = useState(false);
  const [edit, setEdit] = useState<Localidad | 'nueva' | null>(null);
  const [borrar, setBorrar] = useState<Localidad | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const filas = useMemo(() => (datos.data ?? []).filter((l) => (!soloPuntos || l.tiene_punto_recepcion) && (!txt || norm(`${l.nombre} ${l.municipio ?? ''}`).includes(norm(txt)))), [datos.data, txt, soloPuntos]);

  async function hacerBorrar() {
    if (!borrar) return;
    const r = await q(supabase.from('localidades').delete().eq('id', borrar.id).select('id'));
    setBorrar(null);
    if (r.error) { setAviso(r.raw?.code === '23503' ? 'No se puede borrar: la localidad tiene conteos o rutas asociados. Mejor márcala como inactiva.' : r.error); return; }
    if (!(r.data as unknown[] | null)?.length) { setAviso('No se borró nada: no tienes permiso o la localidad ya no existe.'); return; }
    setAviso('Localidad eliminada.'); datos.recargar();
  }

  return (
    <Pagina titulo="Localidades" acciones={admin ? <button className="btn chico accent" onClick={() => setEdit('nueva')}><Icon n="mas" /> Nueva</button> : undefined}>
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
      {!admin && <Aviso tipo="info">Vista de solo lectura.</Aviso>}
      <input type="search" placeholder="Buscar localidad o municipio…" value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Buscar" />
      <label className={'check' + (soloPuntos ? ' on' : '')}><input type="checkbox" checked={soloPuntos} onChange={(e) => setSoloPuntos(e.target.checked)} /> Solo con punto de recepción</label>
      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : filas.length === 0 ? <Vacio>No hay localidades{txt ? ' que coincidan' : ''}.</Vacio> : (
        <div className="lista">
          <p className="peq muted">{filas.length} localidades</p>
          {filas.map((l) => (
            <div className={'item' + (l.activa === false ? ' pend' : '')} key={l.id}>
              <div className="fila entre"><span className="t">{l.nombre}</span>
                <span>{l.tiene_punto_recepcion && <span className="pill ok">Punto de recepción</span>} {l.activa === false && <span className="pill gris">Inactiva</span>}</span></div>
              <div className="muted">{[l.municipio, l.referencia].filter(Boolean).join(' · ')}</div>
              {admin && <div className="fila" style={{ marginTop: 8 }}>
                <button className="btn chico" onClick={() => setEdit(l)}><Icon n="editar" /> Editar</button>
                <button className="btn chico danger" onClick={() => setBorrar(l)}>Borrar</button>
              </div>}
            </div>
          ))}
        </div>
      )}
      {edit && <FormLocalidad l={edit === 'nueva' ? null : edit} userId={userId} onCerrar={() => setEdit(null)} onListo={() => { setEdit(null); datos.recargar(); }} />}
      {borrar && <Confirmar titulo="Borrar localidad" peligro textoOk="Borrar" texto={<p>¿Borrar <b>{borrar.nombre}</b>? Si ya tiene conteos no se podrá borrar; en ese caso desactívala.</p>} onOk={() => void hacerBorrar()} onCancelar={() => setBorrar(null)} />}
    </Pagina>
  );
}

function FormLocalidad({ l, userId, onCerrar, onListo }: { l: Localidad | null; userId: string | null; onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState(l?.nombre ?? '');
  const [municipio, setMunicipio] = useState(l?.municipio ?? '');
  const [referencia, setReferencia] = useState(l?.referencia ?? '');
  const [punto, setPunto] = useState(l?.tiene_punto_recepcion ?? false);
  const [activa, setActiva] = useState(l?.activa ?? true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    if (!nombre.trim()) return setError('El nombre es obligatorio.');
    setOcupado(true); setError(null);
    const campos = { nombre: nombre.trim(), municipio: municipio.trim() || null, referencia: referencia.trim() || null, tiene_punto_recepcion: punto, activa };
    const r = l
      ? await q(supabase.from('localidades').update(campos).eq('id', l.id).select('id'))
      : await q(supabase.from('localidades').insert({ id: nuevoId(), ...campos, creada_por: userId }).select('id'));
    setOcupado(false);
    if (r.error) return setError(r.error);
    if (!(r.data as unknown[] | null)?.length) return setError('No se guardó: no tienes permiso para esta acción.');
    onListo();
  }
  return (
    <Modal titulo={l ? 'Editar localidad' : 'Nueva localidad'} onCerrar={onCerrar}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        <Campo etiqueta="Nombre"><input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <Campo etiqueta="Municipio"><input type="text" value={municipio} onChange={(e) => setMunicipio(e.target.value)} /></Campo>
        <Campo etiqueta="Referencia"><input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Campo>
        <label className={'check' + (punto ? ' on' : '')}><input type="checkbox" checked={punto} onChange={(e) => setPunto(e.target.checked)} /> Tiene punto de recepción</label>
        <label className={'check' + (activa ? ' on' : '')}><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Activa</label>
      </div>
      <div className="acciones"><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()} disabled={ocupado}>Guardar</button></div>
    </Modal>
  );
}

// ------------------------------------------------------------ Rutas
export function Rutas() {
  const { perfil } = useAuth();
  const admin = perfil?.rol === 'administrador';
  const datos = useQuery<{ rutas: Ruta[]; conteo: Record<string, number> }>(async () => {
    const [r, rl] = await Promise.all([
      q<Ruta[]>(supabase.from('rutas').select('id,nombre,activa').order('nombre')),
      traerTodo<RutaLocalidad>((a, b) => supabase.from('ruta_localidades').select('ruta_id,localidad_id,dia_semana,orden').order('ruta_id').order('localidad_id').range(a, b)),
    ]);
    const e = r.error ?? rl.error;
    if (e) return { data: null, error: e, clase: r.clase ?? rl.clase };
    const conteo: Record<string, number> = {};
    for (const x of rl.data!) conteo[x.ruta_id] = (conteo[x.ruta_id] ?? 0) + 1;
    return { data: { rutas: r.data!, conteo }, error: null, clase: null };
  }, []);
  const [nueva, setNueva] = useState(false);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function crear() {
    if (!nombre.trim()) return setError('Escribe el nombre de la ruta.');
    const id = nuevoId();
    const r = await q(supabase.from('rutas').insert({ id, nombre: nombre.trim() }).select('id'));
    if (r.error) return setError(r.error);
    nav(`/rutas/${id}`);
  }

  return (
    <Pagina titulo="Rutas" acciones={admin ? <button className="btn chico accent" onClick={() => { setNueva(true); setError(null); setNombre(''); }}><Icon n="mas" /> Nueva</button> : undefined}>
      {!admin && <Aviso tipo="info">Vista de solo lectura.</Aviso>}
      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : !datos.data?.rutas.length ? <Vacio>No hay rutas registradas.</Vacio> : (
        <div className="lista">
          {datos.data.rutas.map((r) => (
            <Link key={r.id} to={`/rutas/${r.id}`} className="item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="fila entre"><span className="t">{r.nombre}</span>{r.activa === false && <span className="pill gris">Inactiva</span>}</div>
              <div className="muted peq">{datos.data!.conteo[r.id] ?? 0} localidades</div>
            </Link>
          ))}
        </div>
      )}
      {nueva && (
        <Modal titulo="Nueva ruta" onCerrar={() => setNueva(false)}>
          {error && <Aviso tipo="err">{error}</Aviso>}
          <Campo etiqueta="Nombre de la ruta"><input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></Campo>
          <div className="acciones"><button className="btn" onClick={() => setNueva(false)}>Cancelar</button><button className="btn primary" onClick={() => void crear()}>Crear</button></div>
        </Modal>
      )}
    </Pagina>
  );
}

interface PerfilLite { id: string; nombre: string | null; rol: string; activo?: boolean | null }

export function RutaDetalle() {
  const { id } = useParams();
  const { perfil } = useAuth();
  const admin = perfil?.rol === 'administrador';
  const nav = useNavigate();
  const datos = useQuery<{ ruta: Ruta; links: RutaLocalidad[]; locs: Localidad[]; asignados: string[]; ruteros: PerfilLite[] }>(async () => {
    const [r, l, locs, rr, pf] = await Promise.all([
      q<Ruta>(supabase.from('rutas').select('id,nombre,activa').eq('id', id!).single()),
      q<RutaLocalidad[]>(supabase.from('ruta_localidades').select('ruta_id,localidad_id,dia_semana,orden').eq('ruta_id', id!).order('orden')),
      traerTodo<Localidad>((a, b) => supabase.from('localidades').select('id,nombre,municipio,referencia,tiene_punto_recepcion,activa').order('nombre').order('id').range(a, b)),
      q<{ usuario_id: string }[]>(supabase.from('ruta_ruteros').select('usuario_id').eq('ruta_id', id!)),
      admin ? q<PerfilLite[]>(supabase.from('perfiles').select('id,nombre,rol,activo').eq('rol', 'rutero').order('nombre')) : Promise.resolve({ data: [] as PerfilLite[], error: null, clase: null }),
    ]);
    const e = r.error ?? l.error ?? locs.error ?? rr.error ?? pf.error;
    if (e) return { data: null, error: e, clase: r.clase ?? l.clase };
    return { data: { ruta: r.data!, links: l.data!, locs: locs.data!, asignados: rr.data!.map((x) => x.usuario_id), ruteros: pf.data ?? [] }, error: null, clase: null };
  }, [id, admin]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [agregar, setAgregar] = useState('');
  const [txt, setTxt] = useState('');
  const [borrar, setBorrar] = useState(false);
  const [nombre, setNombre] = useState<string | null>(null);

  const nomLoc = useMemo(() => new Map((datos.data?.locs ?? []).map((l) => [l.id, l])), [datos.data]);
  if (datos.cargando) return <Cargando />;
  if (datos.error) return <ErrorCaja error={datos.error} onReintentar={datos.recargar} />;
  const d = datos.data!;

  async function accion(p: PromiseLike<{ data: unknown; error: ErrorRemoto | null; status: number }>, ok?: string) {
    const r = await q(p);
    if (r.error) { setAviso(r.error); return false; }
    if (ok) setAviso(ok);
    datos.recargar();
    return true;
  }
  const candidatas = d.locs.filter((l) => l.activa !== false && !d.links.some((x) => x.localidad_id === l.id) && (!txt || norm(`${l.nombre} ${l.municipio ?? ''}`).includes(norm(txt)))).slice(0, 50);
  const ordenados = [...d.links].sort((a, b) => (a.dia_semana ?? 9) - (b.dia_semana ?? 9) || (a.orden ?? 0) - (b.orden ?? 0));

  return (
    <Pagina titulo={d.ruta.nombre} acciones={<button className="btn chico" onClick={() => nav('/rutas')}>Volver</button>}>
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
      {!admin && <Aviso tipo="info">Vista de solo lectura.</Aviso>}
      {admin && (
        <div className="tarjeta col">
          <h2>Datos de la ruta</h2>
          <Campo etiqueta="Nombre"><input type="text" value={nombre ?? d.ruta.nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
          <label className={'check' + (d.ruta.activa !== false ? ' on' : '')}>
            <input type="checkbox" checked={d.ruta.activa !== false} onChange={(e) => void accion(supabase.from('rutas').update({ activa: e.target.checked }).eq('id', d.ruta.id).select('id'))} /> Ruta activa
          </label>
          <div className="acciones">
            <button className="btn primary" disabled={nombre === null || !nombre.trim() || nombre === d.ruta.nombre} onClick={() => void accion(supabase.from('rutas').update({ nombre: nombre!.trim() }).eq('id', d.ruta.id).select('id'), 'Nombre actualizado.').then(() => setNombre(null))}>Guardar nombre</button>
            <button className="btn danger" onClick={() => setBorrar(true)}>Borrar ruta</button>
          </div>
        </div>
      )}

      <h2>Localidades de la ruta ({d.links.length})</h2>
      {ordenados.length === 0 ? <Vacio>La ruta aún no tiene localidades.</Vacio> : (
        <div className="lista">
          {ordenados.map((x) => (
            <div className="item" key={x.localidad_id}>
              <div className="t">{nomLoc.get(x.localidad_id)?.nombre ?? '(localidad)'}</div>
              <div className="muted peq">{nomLoc.get(x.localidad_id)?.municipio}</div>
              {admin ? (
                <div className="fila" style={{ marginTop: 8 }}>
                  <select aria-label="Día de la semana" style={{ width: 'auto', flex: '1 1 150px' }} value={x.dia_semana ?? ''}
                    onChange={(e) => void accion(supabase.from('ruta_localidades').update({ dia_semana: e.target.value === '' ? null : Number(e.target.value) }).eq('ruta_id', x.ruta_id).eq('localidad_id', x.localidad_id).select('ruta_id'))}>
                    <option value="">Sin día fijo</option>
                    {DIAS.map((n, i) => <option key={i} value={i}>{n}</option>)}
                  </select>
                  <button className="btn chico danger" onClick={() => void accion(supabase.from('ruta_localidades').delete().eq('ruta_id', x.ruta_id).eq('localidad_id', x.localidad_id).select('ruta_id'), 'Localidad quitada de la ruta.')}>Quitar</button>
                </div>
              ) : <div className="peq">{x.dia_semana !== null && x.dia_semana !== undefined ? DIAS[x.dia_semana] : 'Sin día fijo'}</div>}
            </div>
          ))}
        </div>
      )}
      {admin && (
        <div className="tarjeta col">
          <h3>Agregar localidad</h3>
          <input type="search" placeholder="Buscar localidad…" value={txt} onChange={(e) => setTxt(e.target.value)} />
          <select value={agregar} onChange={(e) => setAgregar(e.target.value)} size={Math.min(6, Math.max(2, candidatas.length))} aria-label="Localidades disponibles" style={{ minHeight: 120 }}>
            {candidatas.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.municipio ? ` (${l.municipio})` : ''}</option>)}
          </select>
          <button className="btn primary" disabled={!agregar} onClick={() => void accion(supabase.from('ruta_localidades').insert({ ruta_id: d.ruta.id, localidad_id: agregar, dia_semana: null, orden: d.links.length }).select('ruta_id'), 'Localidad agregada.').then(() => setAgregar(''))}>Agregar a la ruta</button>
        </div>
      )}

      <h2>Ruteros asignados</h2>
      {admin ? (
        d.ruteros.length === 0 ? <Vacio>No hay usuarios con rol Rutero.</Vacio> : (
          <div className="lista">
            {d.ruteros.map((p) => {
              const on = d.asignados.includes(p.id);
              return (
                <label key={p.id} className={'check' + (on ? ' on' : '')}>
                  <input type="checkbox" checked={on} onChange={(e) => void accion(e.target.checked
                    ? supabase.from('ruta_ruteros').insert({ ruta_id: d.ruta.id, usuario_id: p.id }).select('ruta_id') as never
                    : supabase.from('ruta_ruteros').delete().eq('ruta_id', d.ruta.id).eq('usuario_id', p.id).select('ruta_id'))} />
                  {p.nombre ?? 'Sin nombre'}{p.activo === false ? ' (inactivo)' : ''}
                </label>
              );
            })}
          </div>
        )
      ) : <p className="muted">{d.asignados.length} rutero(s) asignado(s).</p>}
      {borrar && <Confirmar titulo="Borrar ruta" peligro textoOk="Borrar" texto={<p>¿Borrar la ruta <b>{d.ruta.nombre}</b>? Se quitan sus localidades y asignaciones. Si tiene conteos registrados no se podrá borrar; en ese caso desactívala.</p>}
        onOk={() => void (async () => { const r = await q(supabase.from('rutas').delete().eq('id', d.ruta.id).select('id')); setBorrar(false); if (r.error) { setAviso(r.raw?.code === '23503' ? 'No se puede borrar: la ruta tiene conteos registrados. Mejor desactívala.' : r.error); return; } if (!(r.data as unknown[] | null)?.length) { setAviso('No se borró nada: sin permiso.'); return; } nav('/rutas'); })()} onCancelar={() => setBorrar(false)} />}
    </Pagina>
  );
}
