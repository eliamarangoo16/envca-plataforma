import { useMemo, useState } from 'react';
import { supabase, SUPABASE_KEY, SUPABASE_URL } from '../lib/supabase';
import { q, traerTodo } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmtMXN, fmtNum3, parseNumero, redondear2 } from '../lib/money';
import { fechaLarga, fechaMX, sumarDias } from '../lib/time';
import { desdeExcepcion, mensajeError } from '../lib/errors';
import { fetchConTope } from '../lib/tiempo';
import { ROL_NOMBRE, type Perfil, type Rol, type Tarifa } from '../lib/types';
import { Aviso, Barras, Campo, Cargando, ErrorCaja, Modal, Pagina, Vacio } from '../components/ui';
import { Icon } from '../components/Icon';
import { TablaCierre, type FilaCierre } from './Caja';
import { useListasBase } from './Conteos';

// ------------------------------------------------------------ Tablero
interface FilaConteoV { fecha: string; tipo: string; ruta_id: string | null; localidad_id: string; total: number; registros: number }

export function Tablero() {
  const hoy = fechaMX();
  const [desde, setDesde] = useState(sumarDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const base = useListasBase();
  const conteos = useQuery<FilaConteoV[]>(() => traerTodo<FilaConteoV>((a, b) => supabase.from('v_conteos_diarios').select('fecha,tipo,ruta_id,localidad_id,total,registros').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('tipo').order('ruta_id').order('localidad_id').range(a, b)), [desde, hasta]);
  const cierre = useQuery<FilaCierre[]>(() => traerTodo<FilaCierre>((a, b) => supabase.from('v_cierre_diario').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('sucursal').order('metodo_pago').order('estado_pago').range(a, b)), [desde, hasta]);

  const rut = useMemo(() => new Map((base.data?.rutas ?? []).map((r) => [r.id, r.nombre])), [base.data]);
  const loc = useMemo(() => new Map((base.data?.localidades ?? []).map((l) => [l.id, l.nombre])), [base.data]);

  const resumen = useMemo(() => {
    const porRuta = new Map<string, number>(); const salLoc = new Map<string, number>();
    let rec = 0, sal = 0;
    for (const f of conteos.data ?? []) {
      const n = Number(f.total);
      if (f.tipo === 'recepcion') { rec += n; const k = f.ruta_id ? rut.get(f.ruta_id) ?? '(ruta)' : 'Sin ruta'; porRuta.set(k, (porRuta.get(k) ?? 0) + n); }
      else { sal += n; const k = loc.get(f.localidad_id) ?? '(localidad)'; salLoc.set(k, (salLoc.get(k) ?? 0) + n); }
    }
    const ord = (m: Map<string, number>) => [...m.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor })).sort((a, b) => b.valor - a.valor);
    return { rec, sal, porRuta: ord(porRuta), salLoc: ord(salLoc).slice(0, 15) };
  }, [conteos.data, rut, loc]);

  const fin = useMemo(() => {
    const met = new Map<string, number>(); const dia = new Map<string, number>();
    let total = 0, pagado = 0, kg = 0, guias = 0;
    for (const f of cierre.data ?? []) {
      const m = Number(f.monto); total += m; kg += Number(f.peso_kg); guias += Number(f.guias);
      if (f.estado_pago === 'Pagado') pagado += m;
      met.set(f.metodo_pago ?? 'Sin método', (met.get(f.metodo_pago ?? 'Sin método') ?? 0) + m);
      dia.set(f.fecha, (dia.get(f.fecha) ?? 0) + m);
    }
    const dias: { fecha: string; monto: number }[] = [];
    for (let d = desde, i = 0; d <= hasta && i < 400; d = sumarDias(d, 1), i++) dias.push({ fecha: d, monto: redondear2(dia.get(d) ?? 0) });
    return { total: redondear2(total), pagado: redondear2(pagado), kg, guias, met: [...met.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor: redondear2(valor) })).sort((a, b) => b.valor - a.valor), dias };
  }, [cierre.data, desde, hasta]);

  const maxDia = Math.max(1, ...fin.dias.map((d) => d.monto));
  const err = conteos.error ?? cierre.error ?? base.error;
  const cargando = conteos.cargando || cierre.cargando || base.cargando;

  return (
    <Pagina titulo="Tablero">
      <div className="tarjeta grid2">
        <Campo etiqueta="Desde"><input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} /></Campo>
      </div>
      <div className="fila">
        {[['Hoy', 0], ['7 días', 6], ['30 días', 29]].map(([t, n]) => <button key={t as string} className="btn chico" onClick={() => { setDesde(sumarDias(hoy, -(n as number))); setHasta(hoy); }}>{t}</button>)}
      </div>
      {err && <ErrorCaja error={err} onReintentar={() => { conteos.recargar(); cierre.recargar(); base.recargar(); }} />}
      {cargando ? <Cargando /> : !err && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v">{resumen.rec}</div><div className="l">Paquetes recibidos</div></div>
            <div className="kpi"><div className="v">{resumen.sal}</div><div className="l">Paquetes en salidas</div></div>
            <div className="kpi"><div className="v">{fin.guias}</div><div className="l">Guías · {fmtNum3(fin.kg)} kg</div></div>
            <div className="kpi"><div className="v">{fmtMXN(fin.total)}</div><div className="l">Ingresos totales</div></div>
          </div>
          <div className="aviso info">Pagado: <b>{fmtMXN(fin.pagado)}</b> · Por cobrar en destino: <b>{fmtMXN(fin.total - fin.pagado)}</b> · {fechaLarga(desde)} a {fechaLarga(hasta)}</div>
          <section><h2>Paquetes recibidos por ruta</h2><Barras filas={resumen.porRuta} /></section>
          <section><h2>Salidas por localidad</h2><Barras filas={resumen.salLoc} /></section>
          <section><h2>Ingresos por método de pago</h2><Barras filas={fin.met} formato={fmtMXN} /></section>
          <section>
            <h2>Ingreso por día</h2>
            {fin.dias.every((d) => d.monto === 0) ? <Vacio>Sin ingresos en el periodo.</Vacio> : (
              <>
                <div className="col-chart" role="img" aria-label="Ingreso por día">
                  {fin.dias.map((d) => <div key={d.fecha} style={{ height: `${Math.max(2, (d.monto / maxDia) * 100)}%` }} title={`${fechaLarga(d.fecha)}: ${fmtMXN(d.monto)}`} />)}
                </div>
                <div className="eje"><span>{fechaLarga(desde)}</span><span>máx. {fmtMXN(maxDia)}</span><span>{fechaLarga(hasta)}</span></div>
              </>
            )}
          </section>
        </>
      )}
    </Pagina>
  );
}

// ------------------------------------------------------------ Cierre diario
export function CierreDiario() {
  const [fecha, setFecha] = useState(fechaMX());
  const [suc, setSuc] = useState('');
  const sucs = useQuery<{ codigo: string; nombre: string | null }[]>(() => q(supabase.from('sucursales').select('codigo,nombre').order('codigo')), []);
  const r = useQuery<FilaCierre[]>(() => { let qy = supabase.from('v_cierre_diario').select('*').eq('fecha', fecha); if (suc) qy = qy.eq('sucursal', suc); return q(qy.order('metodo_pago') as never); }, [fecha, suc]);
  return (
    <Pagina titulo="Cierre diario">
      <div className="tarjeta grid2">
        <Campo etiqueta="Fecha"><input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Campo>
        <Campo etiqueta="Sucursal"><select value={suc} onChange={(e) => setSuc(e.target.value)}><option value="">Todas</option>{(sucs.data ?? []).map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.nombre}</option>)}</select></Campo>
      </div>
      {r.cargando ? <Cargando /> : r.error ? <ErrorCaja error={r.error} onReintentar={r.recargar} /> : <TablaCierre filas={r.data ?? []} />}
    </Pagina>
  );
}

// ------------------------------------------------------------ Tarifas
export function Tarifas() {
  const datos = useQuery<Tarifa[]>(() => q(supabase.from('tarifas').select('id,destino,precio_por_kg,moneda,activa,actualizada_en').order('destino')), []);
  const [edit, setEdit] = useState<Tarifa | 'nueva' | null>(null);
  return (
    <Pagina titulo="Tarifas" acciones={<button className="btn chico accent" onClick={() => setEdit('nueva')}><Icon n="mas" /> Nuevo destino</button>}>
      <Aviso tipo="info">El precio es por kilogramo en MXN. Cambiar una tarifa no modifica las guías ya emitidas.</Aviso>
      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : !datos.data?.length ? <Vacio>No hay tarifas.</Vacio> : (
        <div className="lista">
          {datos.data.map((t) => (
            <div key={t.id} className={'item' + (t.activa === false ? ' pend' : '')}>
              <div className="fila entre"><span className="t">{t.destino}</span>{t.activa === false && <span className="pill gris">Inactiva</span>}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{t.precio_por_kg === null ? <span className="pill warn">Por definir</span> : `${fmtMXN(t.precio_por_kg)} por kg`}</div>
              <button className="btn chico" style={{ marginTop: 8 }} onClick={() => setEdit(t)}><Icon n="editar" /> Editar</button>
            </div>
          ))}
        </div>
      )}
      {edit && <FormTarifa t={edit === 'nueva' ? null : edit} onCerrar={() => setEdit(null)} onListo={() => { setEdit(null); datos.recargar(); }} />}
    </Pagina>
  );
}

function FormTarifa({ t, onCerrar, onListo }: { t: Tarifa | null; onCerrar: () => void; onListo: () => void }) {
  const [destino, setDestino] = useState(t?.destino ?? '');
  const [precio, setPrecio] = useState(t?.precio_por_kg != null ? String(t.precio_por_kg) : '');
  const [activa, setActiva] = useState(t?.activa ?? true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    if (!destino.trim()) return setError('Escribe el destino.');
    let p: number | null = null;
    if (precio.trim() !== '') { const n = parseNumero(precio); if (n === null || n <= 0) return setError('El precio debe ser mayor a 0 (o déjalo vacío para «por definir»).'); p = redondear2(n); }
    setOcupado(true); setError(null);
    const nuevos = { destino: destino.trim(), precio_por_kg: p, activa };
    // Al editar se mandan solo los campos que cambiaron (así la bitácora atribuye a cada persona lo suyo) y solo si nadie más la cambió antes.
    const cambios: Partial<typeof nuevos> = {};
    if (t) {
      if (nuevos.destino !== t.destino) cambios.destino = nuevos.destino;
      if (nuevos.precio_por_kg !== (t.precio_por_kg ?? null)) cambios.precio_por_kg = nuevos.precio_por_kg;
      if (nuevos.activa !== t.activa) cambios.activa = nuevos.activa;
      if (Object.keys(cambios).length === 0) { setOcupado(false); return onListo(); }
    }
    let qy = t ? supabase.from('tarifas').update(cambios).eq('id', t.id) : null;
    if (qy && t?.actualizada_en) qy = qy.eq('actualizada_en', t.actualizada_en);
    const r = qy ? await q(qy.select('id')) : await q(supabase.from('tarifas').insert({ ...nuevos, moneda: 'MXN' }).select('id'));
    setOcupado(false);
    if (r.error) return setError(r.raw?.code === '23505' ? 'Ya existe una tarifa con ese destino.' : r.error);
    if (!(r.data as unknown[] | null)?.length) return setError(t ? 'No se guardó: otra persona cambió esta tarifa mientras la editabas, o no tienes permiso. Cierra, revisa y vuelve a intentar.' : 'No se guardó: no tienes permiso para esta acción.');
    onListo();
  }
  return (
    <Modal titulo={t ? `Editar tarifa · ${t.destino}` : 'Nuevo destino'} onCerrar={onCerrar}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        <Campo etiqueta="Destino"><input type="text" value={destino} onChange={(e) => setDestino(e.target.value)} /></Campo>
        <Campo etiqueta="Precio por kg (MXN)" ayuda="Déjalo vacío para marcar la tarifa como «por definir»."><input type="text" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Por definir" /></Campo>
        <label className={'check' + (activa ? ' on' : '')}><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Activa (disponible en caja)</label>
      </div>
      <div className="acciones"><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()} disabled={ocupado}>Guardar</button></div>
    </Modal>
  );
}

// ------------------------------------------------------------ Usuarios (función edge admin-usuarios)
async function llamarAdminUsuarios(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: 'Tu sesión venció. Vuelve a iniciar sesión.' };
    const res = await fetchConTope()(`${SUPABASE_URL}/functions/v1/admin-usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
    });
    let j: { ok?: boolean; error?: string; id?: string } = {};
    try { j = await res.json(); } catch { /* respuesta sin JSON */ }
    if (res.ok && j.ok) return { ok: true, id: j.id };
    if (res.status === 403) return { ok: false, error: j.error ?? 'No tienes permiso para administrar usuarios.' };
    return { ok: false, error: j.error ?? (res.status >= 500 ? 'El servidor no pudo procesar la solicitud. Inténtalo más tarde.' : `No se pudo completar (código ${res.status}).`) };
  } catch (x) {
    return { ok: false, error: mensajeError(desdeExcepcion(x), 0) };
  }
}

type PerfilFila = Pick<Perfil, 'id' | 'nombre' | 'rol' | 'sucursal'> & { activo: boolean | null; super_admin?: boolean | null };

export function Usuarios() {
  const { userId } = useAuth();
  const datos = useQuery<PerfilFila[]>(() => q(supabase.from('perfiles').select('id,nombre,rol,sucursal,activo,super_admin').order('nombre')), []);
  const sucs = useQuery<{ codigo: string; nombre: string | null }[]>(() => q(supabase.from('sucursales').select('codigo,nombre').order('codigo')), []);
  const [edit, setEdit] = useState<PerfilFila | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <Pagina titulo="Usuarios" acciones={<button className="btn chico accent" onClick={() => setEdit('nuevo')}><Icon n="mas" /> Nuevo usuario</button>}>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {datos.cargando ? <Cargando /> : datos.error ? <ErrorCaja error={datos.error} onReintentar={datos.recargar} /> : !datos.data?.length ? <Vacio>No hay usuarios.</Vacio> : (
        <div className="lista">
          {datos.data.map((p) => (
            <div className={'item' + (p.activo === false ? ' pend' : '')} key={p.id}>
              <div className="fila entre"><span className="t">{p.nombre ?? 'Sin nombre'}{p.id === userId ? ' (tú)' : ''}</span>
                <span className={'pill ' + (p.activo === false ? 'gris' : 'ok')}>{p.activo === false ? 'Inactivo' : 'Activo'}</span></div>
              <div>{ROL_NOMBRE[p.rol as Rol] ?? p.rol}{p.sucursal ? ` · ${p.sucursal}` : ''}</div>
              <button className="btn chico" style={{ marginTop: 8 }} onClick={() => setEdit(p)}><Icon n="editar" /> Editar</button>
            </div>
          ))}
        </div>
      )}
      {edit && <FormUsuario p={edit === 'nuevo' ? null : edit} esYo={edit !== 'nuevo' && edit.id === userId} sucursales={sucs.data ?? []} onCerrar={() => setEdit(null)} onListo={(m) => { setEdit(null); setAviso(m); datos.recargar(); }} />}
    </Pagina>
  );
}

function FormUsuario({ p, esYo, sucursales, onCerrar, onListo }: { p: PerfilFila | null; esYo: boolean; sucursales: { codigo: string; nombre: string | null }[]; onCerrar: () => void; onListo: (m: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState(p?.nombre ?? '');
  const [rol, setRol] = useState<Rol>((p?.rol as Rol) ?? 'rutero');
  const [sucursal, setSucursal] = useState(p?.sucursal ?? '');
  const [activo, setActivo] = useState(p?.activo !== false);
  const { perfil: yoPerfil } = useAuth();
  const sinPermisoBaja = yoPerfil?.super_admin !== true && p?.activo !== false;
  const bloqueado = !!p?.super_admin && !esYo && yoPerfil?.super_admin !== true;   // principal: solo otro principal lo modifica
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setError(null);
    if (!nombre.trim()) return setError('Escribe el nombre.');
    if (rol === 'sucursal' && !sucursal) return setError('El agente de caja necesita una sucursal.');
    if (!p) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Escribe un correo válido.');
      if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    } else if (password && password.length < 8) return setError('La contraseña nueva debe tener al menos 8 caracteres.');
    setOcupado(true);
    const r = p
      ? await llamarAdminUsuarios({ accion: 'actualizar', id: p.id, nombre: nombre.trim(), ...(esYo ? {} : { rol, activo }), sucursal: sucursal || null, ...(password ? { password } : {}) })
      : await llamarAdminUsuarios({ accion: 'crear', email: email.trim(), password, nombre: nombre.trim(), rol, ...(sucursal ? { sucursal } : {}) });
    setOcupado(false);
    if (!r.ok) return setError(r.error ?? 'No se pudo completar.');
    onListo(p ? 'Usuario actualizado.' : 'Usuario creado. Entrégale su correo y contraseña de forma segura.');
  }
  return (
    <Modal titulo={p ? 'Editar usuario' : 'Nuevo usuario'} onCerrar={onCerrar}>
      <div className="col">
        {error && <Aviso tipo="err">{error}</Aviso>}
        {!p && <Campo etiqueta="Correo electrónico"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" /></Campo>}
        <Campo etiqueta="Nombre"><input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <Campo etiqueta="Rol" ayuda={esYo ? 'No puedes cambiar tu propio rol.' : undefined}>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} disabled={esYo}>
            {(Object.keys(ROL_NOMBRE) as Rol[]).map((r) => <option key={r} value={r}>{ROL_NOMBRE[r]}</option>)}
          </select>
        </Campo>
        <Campo etiqueta={rol === 'sucursal' ? 'Sucursal (obligatoria)' : 'Sucursal (opcional)'}>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}><option value="">—</option>{sucursales.map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} · {s.nombre}</option>)}</select>
        </Campo>
        {bloqueado && <Aviso tipo="warn">Esta cuenta es de un administrador principal: solo otro principal puede modificarla.</Aviso>}
        <Campo etiqueta={p ? 'Contraseña nueva (opcional)' : 'Contraseña (mínimo 8 caracteres)'}><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
        {p && <label className={'check' + (activo ? ' on' : '')}><input type="checkbox" checked={activo} disabled={esYo || sinPermisoBaja} onChange={(e) => setActivo(e.target.checked)} /> Usuario activo{esYo ? ' (no puedes desactivarte)' : sinPermisoBaja ? ' (solo un administrador principal puede dar de baja)' : ''}</label>}
      </div>
      <div className="acciones"><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primary" onClick={() => void guardar()} disabled={ocupado || bloqueado}>{ocupado ? 'Guardando…' : 'Guardar'}</button></div>
    </Modal>
  );
}
