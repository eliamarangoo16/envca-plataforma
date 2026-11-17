import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import type { Rol } from './lib/types';
import { Layout } from './components/Layout';
import { Cargando } from './components/ui';
import { Login } from './pages/Login';
import { Perfil } from './pages/Perfil';
import { RuteroCaptura, RuteroInicio, RuteroRegistros } from './pages/Rutero';
import { CierreTurno, GuiaDetalle, GuiaImprimir, ListaGuias, NuevaGuia } from './pages/Caja';
import { Conteos } from './pages/Conteos';
import { Localidades, RutaDetalle, Rutas } from './pages/Catalogos';
import { CierreDiario, Tablero, Tarifas, Usuarios } from './pages/Admin';
import { Bitacora } from './pages/Bitacora';

interface Def { path: string; roles: Rol[]; el: ReactElement }

const N1: Rol[] = ['administrador'];
const N1N2: Rol[] = ['administrador', 'admin_n2'];

/** Tabla única de rutas: la pantalla solo se muestra a los roles listados (la seguridad real es RLS). */
const RUTAS: Def[] = [
  { path: 'inicio', roles: ['rutero'], el: <RuteroInicio /> },
  { path: 'captura', roles: ['rutero'], el: <RuteroCaptura /> },
  { path: 'registros', roles: ['rutero'], el: <RuteroRegistros /> },
  { path: 'guia/nueva', roles: ['sucursal'], el: <NuevaGuia /> },
  { path: 'mis-guias', roles: ['sucursal'], el: <ListaGuias admin={false} /> },
  { path: 'cierre', roles: ['sucursal'], el: <CierreTurno /> },
  { path: 'guia/:id', roles: ['sucursal', 'administrador'], el: <GuiaDetalle /> },
  { path: 'guia/:id/imprimir', roles: ['sucursal', 'administrador'], el: <GuiaImprimir /> },
  { path: 'tablero', roles: N1, el: <Tablero /> },
  { path: 'guias', roles: N1, el: <ListaGuias admin /> },
  { path: 'cierre-diario', roles: N1, el: <CierreDiario /> },
  { path: 'tarifas', roles: N1, el: <Tarifas /> },
  { path: 'usuarios', roles: N1, el: <Usuarios /> },
  { path: 'bitacora', roles: N1, el: <Bitacora /> },
  { path: 'conteos', roles: N1N2, el: <Conteos /> },
  { path: 'localidades', roles: N1N2, el: <Localidades /> },
  { path: 'rutas', roles: N1N2, el: <Rutas /> },
  { path: 'rutas/:id', roles: N1N2, el: <RutaDetalle /> },
  { path: 'perfil', roles: ['administrador', 'admin_n2', 'rutero', 'sucursal'], el: <Perfil /> },
];

export const INICIO: Record<Rol, string> = { rutero: '/inicio', sucursal: '/guia/nueva', admin_n2: '/conteos', administrador: '/tablero' };

function Splash() {
  return <main className="login"><div className="logo"><b>ENVCA</b><span /></div><Cargando /></main>;
}

export default function App() {
  const { estado, perfil } = useAuth();
  if (estado === 'cargando') return <Splash />;
  if (estado === 'sin_perfil_sin_red') {
    return (
      <main className="login">
        <div className="logo"><b>ENVCA</b><span /></div>
        <div className="aviso warn">Sin conexión. La primera vez que entras en este teléfono se necesita señal para cargar tu perfil.</div>
        <button className="btn primary" onClick={() => window.location.reload()}>Reintentar</button>
      </main>
    );
  }
  if (estado !== 'dentro' || !perfil) return <Login />;
  const rol = perfil.rol;
  const mias = RUTAS.filter((r) => r.roles.includes(rol));
  return (
    <Routes>
      <Route element={<Layout rol={rol} />}>
        {mias.map((r) => <Route key={r.path} path={r.path} element={r.el} />)}
        <Route path="*" element={<Navigate to={INICIO[rol]} replace />} />
      </Route>
    </Routes>
  );
}
