import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useSync } from '../lib/sync';
import { useCatalogosLocal, useMisRegistros, type RegistroVista } from '../lib/local';
import { descartar, editarEnBandeja, encolar, reintentarErrores } from '../lib/outbox';
import { nuevoId } from '../lib/ids';
import { DIAS, fechaLarga, fechaMX, diaSemana, fechaHoraMX, sumarDias } from '../lib/time';
import { kvGet, kvSet, guardarMisConteos } from '../lib/db';
import { supabase } from '../lib/supabase';
import { q } from '../lib/api';
import { MSG_VENTANA_EDICION } from '../lib/errors';
import type { Localidad, TipoConteo } from '../lib/types';
import { Aviso, Campo, Cargando, Modal, Segmentos, Stepper, Vacio, Pagina } from '../components/ui';
import { BuscadorLocalidad } from '../components/BuscadorLocalidad';
import { Icon } from '../components/Icon';

function useRutasDelRutero(userId: string | null) {
  const cat = useCatalogosLocal(userId);
  const asignadas = useMemo(() => new Set(cat.ruta_ruteros.filter((r) => r.usuario_id === userId).map((r) => r.ruta_id)), [cat.ruta_ruteros, userId]);
  const activas = cat.rutas.filter((r) => r.activa !== false);
  const mias = activas.filter((r) => asignadas.has(r.id));
  return { cat, mias, activas, sinAsignar: cat.cargado && mias.length === 0 };
}

export function BotonEnviar() {
  const { pendientes, conError, sincronizando, sincronizar, enLinea } = useSync();
  return (
    <button className="btn primary bloque" onClick={() => void sincronizar()} disabled={sincronizando}>
      <Icon n="sync" />{sincronizando ? 'Enviando…' : pendientes + conError > 0 ? `Enviar pendientes (${pendientes + conError})` : enLinea ? 'Sincronizar ahora' : 'Reintentar conexión'}
    </button>
  );
}

// ------------------------------------------------------------------ Inicio
export function RuteroInicio() {
  const { perfil, userId } = useAuth();
  const { pendientes, conError, enLinea } = useSync();
  const { cat, mias, sinAsignar } = useRutasDelRutero(userId);
  const { registros } = useMisRegistros(userId);
  const hoy = fechaMX();
  const dw = diaSemana(hoy);
  const deHoy = registros.filter((r) => r.conteo.fecha === hoy);
  const rec = deHoy.filter((r) => r.conteo.tipo === 'recepcion').reduce((a, r) => a + r.conteo.cantidad, 0);
  const sal = deHoy.filter((r) => r.conteo.tipo === 'salida').reduce((a, r) => a + r.conteo.cantidad, 0);
  const nombreLoc = (id: string) => cat.localidades.find((l) => l.id === id)?.nombre ?? '—';

  return (
    <Pagina titulo={`Hola${perfil?.nombre ? ', ' + perfil.nombre.split(' ')[0] : ''}`}>
      <div className="tarjeta panel"><b>{DIAS[dw]}</b> · {fechaLarga(hoy)}</div>
      {!enLinea && <Aviso tipo="warn">Sin señal. Puedes capturar: todo se guarda en tu teléfono y se envía solo cuando haya conexión.</Aviso>}
      {!cat.cargado ? <Cargando /> : cat.actualizado === null && (
        <Aviso tipo="err">Aún no hay catálogos guardados en este teléfono. Conéctate a internet una vez para descargar tus rutas y localidades.</Aviso>
      )}
      <div className="kpis">
        <div className="kpi"><div className="v">{rec}</div><div className="l">Recibidos hoy</div></div>
        <div className="kpi"><div className="v">{sal}</div><div className="l">Salidas hoy</div></div>
        <div className="kpi"><div className="v">{pendientes}</div><div className="l">Por enviar</div></div>
        <div className="kpi"><div className="v">{conError}</div><div className="l">Con error</div></div>
      </div>
      <Link className="btn accent bloque" to="/captura"><Icon n="mas" /> Capturar conteo</Link>
      <BotonEnviar />

      <h2>Mis rutas</h2>
      {cat.cargado && sinAsignar && <Aviso tipo="warn">No tienes una ruta asignada. Pide a un administrador que te asigne una; mientras tanto puedes elegir cualquier ruta al capturar.</Aviso>}
      <div className="lista">
        {mias.map((r) => {
          const loc = cat.ruta_localidades.filter((x) => x.ruta_id === r.id);
          const hoyLoc = loc.filter((x) => x.dia_semana === dw).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
          return (
            <div className="item" key={r.id}>
              <div className="t">{r.nombre}</div>
              <div className="muted peq">{loc.length} localidades en la ruta</div>
              {hoyLoc.length > 0
                ? <p className="peq"><b>Hoy ({DIAS[dw].toLowerCase()}):</b> {hoyLoc.map((x) => nombreLoc(x.localidad_id)).join(', ')}</p>
                : <p className="peq muted">Sin localidades programadas para hoy.</p>}
            </div>
          );
        })}
      </div>
      {cat.actualizado && <p className="peq muted">Catálogos actualizados: {fechaHoraMX(cat.actualizado)}</p>}
    </Pagina>
  );
}

// ------------------------------------------------------------------ Captura
export function RuteroCaptura() {
  const { userId } = useAuth();
  const { sincronizar } = useSync();
  const { cat, mias, activas, sinAsignar } = useRutasDelRutero(userId);
  const [tipo, setTipo] = useState<TipoConteo>('recepcion');
  const [rutaId, setRutaId] = useState<string>('');
  const [locId, setLocId] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [cantidad, setCantidad] = useState(0);
  const [notas, setNotas] = useState('');
  const [agregarARuta, setAgregarARuta] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const opcionesRuta = mias.length ? mias : activas;

  useEffect(() => { void kvGet<string>('ultima_ruta').then((r) => { if (r) setRutaId((x) => x || r); }); }, []);
  useEffect(() => {
    if (!cat.cargado) return;
    if (!rutaId || !opcionesRuta.some((r) => r.id === rutaId)) setRutaId(opcionesRuta[0]?.id ?? '');
  }, [cat.cargado, opcionesRuta, rutaId]);

  const enRuta = useMemo(() => new Set(cat.ruta_localidades.filter((x) => x.ruta_id === rutaId).map((x) => x.localidad_id)), [cat.ruta_localidades, rutaId]);
  const diaPorLoc = useMemo(() => new Map(cat.ruta_localidades.filter((x) => x.ruta_id === rutaId).map((x) => [x.localidad_id, x.dia_semana])), [cat.ruta_localidades, rutaId]);
  const usaRuta = tipo === 'recepcion';
  const soloRuta = usaRuta && enRuta.size > 0 && !verTodas;
  const lista = soloRuta ? cat.localidades.filter((l) => enRuta.has(l.id)) : cat.localidades;
  const elegida = cat.localidades.find((l) => l.id === locId) ?? null;
  const fueraDeRuta = usaRuta && !!elegida && !!rutaId && !enRuta.has(elegida.id);

  async function guardar() {
    setError(null); setOk(null);
    if (!userId) return;
    if (usaRuta && !rutaId) { setError('Elige la ruta.'); return; }
    if (!locId) { setError('Elige la localidad.'); return; }
    setGuardando(true);
    try {
      const id = nuevoId();
      if (usaRuta && fueraDeRuta && agregarARuta) {
        await encolar({ tipo: 'ruta_localidad', rid: `${rutaId}|${locId}`, usuario_id: userId, payload: { ruta_id: rutaId, localidad_id: locId, dia_semana: null, orden: 0 } });
      }
      await encolar({
        tipo: 'conteo', rid: id, usuario_id: userId,
        payload: {
          id, tipo, fecha: fechaMX(), ruta_id: usaRuta ? rutaId : null, localidad_id: locId, cantidad,
          notas: notas.trim() || null, usuario_id: userId, capturado_en: new Date().toISOString(),
        },
      });
      if (rutaId) await kvSet('ultima_ruta', rutaId);
      setOk(`Guardado en este teléfono: ${tipo === 'recepcion' ? 'recepción' : 'salida'} de ${cantidad} en ${elegida?.nombre ?? 'localidad'}. Se enviará en cuanto haya señal.`);
      setCantidad(0); setNotas(''); setLocId(null); setAgregarARuta(false);
      void sincronizar();
    } catch {
      setError('No se pudo guardar en el teléfono. Revisa el espacio de almacenamiento e inténtalo de nuevo.');
    } finally { setGuardando(false); }
  }

  if (!cat.cargado) return <Cargando />;
  return (
    <Pagina titulo="Captura">
      {cat.actualizado === null && <Aviso tipo="err">No hay catálogos guardados. Conéctate una vez a internet para descargar rutas y localidades (también puedes crear una localidad nueva).</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {error && <Aviso tipo="err">{error}</Aviso>}
      <Segmentos<TipoConteo> valor={tipo} onCambio={(t) => { setTipo(t); setLocId(null); }} opciones={[{ v: 'recepcion', t: 'Recepción' }, { v: 'salida', t: 'Salida' }]} />

      {usaRuta && (
        <Campo etiqueta="Ruta" ayuda={sinAsignar ? 'No tienes ruta asignada; se muestran todas las rutas activas.' : undefined}>
          <select value={rutaId} onChange={(e) => { setRutaId(e.target.value); setLocId(null); }}>
            {opcionesRuta.length === 0 && <option value="">Sin rutas disponibles</option>}
            {opcionesRuta.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </Campo>
      )}

      <div>
        <div className="fila entre"><b>Localidad</b>
          <button className="btn chico" type="button" onClick={() => setNueva(true)}><Icon n="mas" /> Nueva localidad</button>
        </div>
        {usaRuta && enRuta.size > 0 && (
          <label className={'check' + (verTodas ? ' on' : '')} style={{ margin: '8px 0' }}>
            <input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} /> Ver todas las localidades (no solo las de la ruta)
          </label>
        )}
        <BuscadorLocalidad
          localidades={lista} valor={locId} onElegir={(l) => setLocId(l.id)}
          destacadas={usaRuta ? enRuta : undefined}
          etiquetaExtra={(l) => { const d = diaPorLoc.get(l.id); return [enRuta.has(l.id) && usaRuta ? (d != null ? `Ruta · ${DIAS[d]}` : 'Ruta') : '', l.tiene_punto_recepcion ? 'Punto de recepción' : ''].filter(Boolean).join(' · '); }}
        />
        {fueraDeRuta && (
          <label className={'check' + (agregarARuta ? ' on' : '')} style={{ marginTop: 8 }}>
            <input type="checkbox" checked={agregarARuta} onChange={(e) => setAgregarARuta(e.target.checked)} /> Agregar esta localidad a la ruta
          </label>
        )}
      </div>

      <Campo etiqueta="Cantidad de paquetes"><Stepper valor={cantidad} onCambio={setCantidad} /></Campo>
      <Campo etiqueta="Notas (opcional)"><textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
      <button className="btn primary bloque" onClick={() => void guardar()} disabled={guardando} style={{ minHeight: 64 }}>{guardando ? 'Guardando…' : 'Guardar conteo'}</button>
      <p className="peq muted">Fecha del conteo: {fechaLarga(fechaMX())} (hora de México).</p>

      {nueva && (
        <NuevaLocalidad
          rutaId={usaRuta ? rutaId : ''} rutaNombre={cat.rutas.find((r) => r.id === rutaId)?.nombre ?? ''}
          onCerrar={() => setNueva(false)}
          onCreada={(l) => { setNueva(false); setLocId(l.id); setVerTodas(true); }}
        />
      )}
    </Pagina>
  );
}

function NuevaLocalidad({ rutaId, rutaNombre, onCerrar, onCreada }: { rutaId: string; rutaNombre: string; onCerrar: () => void; onCreada: (l: Localidad) => void }) {
  const { userId } = useAuth();
  const [nombre, setNombre] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [referencia, setReferencia] = useState('');
  const [punto, setPunto] = useState(false);
  const [enRuta, setEnRuta] = useState(!!rutaId);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    if (!userId) return;
    if (!nombre.trim()) { setError('Escribe el nombre de la localidad.'); return; }
    const id = nuevoId();
    const loc: Localidad = {
      id, nombre: nombre.trim(), municipio: municipio.trim() || null, referencia: referencia.trim() || null,
      tiene_punto_recepcion: punto, activa: true, creada_por: userId, creada_en: new Date().toISOString(),
    };
    await encolar({ tipo: 'localidad', rid: id, usuario_id: userId, payload: { ...loc } });
    if (rutaId && enRuta) await encolar({ tipo: 'ruta_localidad', rid: `${rutaId}|${id}`, usuario_id: userId, payload: { ruta_id: rutaId, localidad_id: id, dia_semana: null, orden: 0 } });
    onCreada({ ...loc, pendiente: true });
  }

  return (
    <Modal titulo="Nueva localidad" onCerrar={onCerrar}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        <Campo etiqueta="Nombre de la localidad"><input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></Campo>
        <Campo etiqueta="Municipio"><input type="text" value={municipio} onChange={(e) => setMunicipio(e.target.value)} /></Campo>
        <Campo etiqueta="Referencia (cómo llegar)"><input type="text" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Campo>
        <label className={'check' + (punto ? ' on' : '')}><input type="checkbox" checked={punto} onChange={(e) => setPunto(e.target.checked)} /> Tiene punto de recepción</label>
        {rutaId && <label className={'check' + (enRuta ? ' on' : '')}><input type="checkbox" checked={enRuta} onChange={(e) => setEnRuta(e.target.checked)} /> Agregar a la ruta {rutaNombre}</label>}
        <p className="peq muted">Se guarda en tu teléfono y se enviará cuando haya señal.</p>
      </div>
      <div className="acciones">
        <button className="btn" onClick={onCerrar}>Cancelar</button>
        <button className="btn primary" onClick={() => void crear()}>Crear localidad</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Mis registros
export function RuteroRegistros() {
  const { userId } = useAuth();
  const { sincronizar, enLinea, conError } = useSync();
  const { cat } = useRutasDelRutero(userId);
  const { registros, otros, cargado } = useMisRegistros(userId);
  const [editando, setEditando] = useState<RegistroVista | null>(null);
  const hoy = fechaMX();
  const ayer = sumarDias(hoy, -1);
  const nom = (id: string) => cat.localidades.find((l) => l.id === id)?.nombre ?? '(localidad)';
  const rnom = (id: string | null) => (id ? cat.rutas.find((r) => r.id === id)?.nombre ?? '' : '');

  if (!cargado) return <Cargando />;
  const grupos = [{ f: hoy, t: 'Hoy' }, { f: ayer, t: 'Ayer' }];
  const viejos = registros.filter((r) => r.conteo.fecha !== hoy && r.conteo.fecha !== ayer);

  const fila = (r: RegistroVista) => (
    <div key={r.conteo.id} className={'item ' + (r.estado === 'error' ? 'err' : r.estado === 'pendiente' ? 'pend' : '')}>
      <div className="fila entre">
        <span className="t">{r.conteo.cantidad} · {r.conteo.tipo === 'recepcion' ? 'Recepción' : 'Salida'}</span>
        <span className={'pill ' + (r.estado === 'enviado' ? 'ok' : r.estado === 'pendiente' ? 'warn' : 'err')}>
          {r.estado === 'enviado' ? 'Enviado' : r.estado === 'pendiente' ? 'Pendiente' : 'Con error'}
        </span>
      </div>
      <div>{nom(r.conteo.localidad_id)}{rnom(r.conteo.ruta_id) ? ` · ${rnom(r.conteo.ruta_id)}` : ''}</div>
      {r.conteo.notas && <div className="peq muted">{r.conteo.notas}</div>}
      <div className="peq muted">{r.conteo.capturado_en ? fechaHoraMX(r.conteo.capturado_en) : fechaLarga(r.conteo.fecha)}</div>
      {r.estado === 'error' && <p className="peq" style={{ color: 'var(--err)', fontWeight: 700 }}>{r.error}</p>}
      <div className="fila" style={{ marginTop: 8 }}>
        {(r.conteo.fecha === hoy || r.conteo.fecha === ayer) && <button className="btn chico" onClick={() => setEditando(r)}><Icon n="editar" /> Editar</button>}
        {r.estado === 'error' && r.seq !== undefined && <button className="btn chico danger" onClick={() => void descartar(r.seq!)}>Descartar</button>}
      </div>
    </div>
  );

  return (
    <Pagina titulo="Mis registros">
      <BotonEnviar />
      {conError > 0 && userId && <button className="btn bloque" onClick={() => void reintentarErrores(userId).then(() => sincronizar())}>Reintentar los que tuvieron error</button>}
      {!enLinea && <Aviso tipo="warn">Sin señal: los registros en «Pendiente» están guardados en tu teléfono y se enviarán solos.</Aviso>}
      {grupos.map((g) => {
        const l = registros.filter((r) => r.conteo.fecha === g.f);
        return (
          <section key={g.f}>
            <h2>{g.t} · {fechaLarga(g.f)}</h2>
            {l.length === 0 ? <Vacio>Sin registros.</Vacio> : <div className="lista">{l.map(fila)}</div>}
          </section>
        );
      })}
      {viejos.length > 0 && <section><h2>Otros días (pendientes)</h2><div className="lista">{viejos.map(fila)}</div></section>}
      {otros.length > 0 && (
        <section>
          <h2>Localidades y vínculos por enviar</h2>
          <div className="lista">
            {otros.map((o) => (
              <div key={o.clave} className={'item ' + (o.estado === 'error' ? 'err' : 'pend')}>
                <div className="t">{o.tipo === 'localidad' ? `Localidad nueva: ${String(o.payload.nombre ?? '')}` : 'Localidad agregada a una ruta'}</div>
                <div className="peq">{o.estado === 'error' ? o.error : 'Pendiente de envío'}</div>
                {o.estado === 'error' && <button className="btn chico danger" style={{ marginTop: 8 }} onClick={() => void descartar(o.seq!)}>Descartar</button>}
              </div>
            ))}
          </div>
        </section>
      )}
      {editando && <EditarConteo r={editando} nombre={nom(editando.conteo.localidad_id)} onCerrar={() => setEditando(null)} />}
    </Pagina>
  );
}

function EditarConteo({ r, nombre, onCerrar }: { r: RegistroVista; nombre: string; onCerrar: () => void }) {
  const { userId } = useAuth();
  const { sincronizar } = useSync();
  const [cantidad, setCantidad] = useState(r.conteo.cantidad);
  const [notas, setNotas] = useState(r.conteo.notas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    if (!userId) return;
    setOcupado(true); setError(null);
    const cambios = { cantidad, notas: notas.trim() || null };
    // 1) Si aún está en la bandeja, se edita ahí (sin red).
    if (await editarEnBandeja('conteo', r.conteo.id, cambios)) { onCerrar(); void sincronizar(); return; }
    // 2) Si ya se envió, se actualiza en el servidor (necesita señal).
    const res = await q(supabase.from('conteos').update(cambios).eq('id', r.conteo.id).select('id,tipo,fecha,ruta_id,localidad_id,cantidad,notas,usuario_id,capturado_en,creado_en'));
    setOcupado(false);
    if (res.error) {
      setError(res.clase === 'network' ? 'Este registro ya se envió; para editarlo se necesita señal. Inténtalo cuando tengas conexión.'
        : res.raw?.code === '42501' ? MSG_VENTANA_EDICION : res.error);
      return;
    }
    const filas = res.data as unknown as typeof r.conteo[] | null;
    if (!filas || filas.length === 0) { setError(MSG_VENTANA_EDICION); return; }
    await guardarMisConteos(filas);
    onCerrar(); void sincronizar();
  }

  return (
    <Modal titulo={`Editar · ${nombre}`} onCerrar={onCerrar}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        <Campo etiqueta="Cantidad de paquetes"><Stepper valor={cantidad} onCambio={setCantidad} /></Campo>
        <Campo etiqueta="Notas"><textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
      </div>
      <div className="acciones">
        <button className="btn" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
        <button className="btn primary" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </Modal>
  );
}

