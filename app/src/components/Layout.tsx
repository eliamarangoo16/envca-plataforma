import { useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useSync } from '../lib/sync';
import type { Rol } from '../lib/types';
import { Icon } from './Icon';
import { Aviso } from './ui';

export interface NavItem { a: string; t: string; i: string }

export const NAV: Record<Rol, NavItem[]> = {
  rutero: [
    { a: '/inicio', t: 'Inicio', i: 'inicio' },
    { a: '/captura', t: 'Captura', i: 'mas' },
    { a: '/registros', t: 'Mis registros', i: 'lista' },
    { a: '/perfil', t: 'Perfil', i: 'usuario' },
  ],
  sucursal: [
    { a: '/guia/nueva', t: 'Nueva guía', i: 'mas' },
    { a: '/mis-guias', t: 'Mis guías', i: 'guia' },
    { a: '/cierre', t: 'Mi cierre', i: 'dinero' },
    { a: '/perfil', t: 'Perfil', i: 'usuario' },
  ],
  admin_n2: [
    { a: '/conteos', t: 'Conteos', i: 'caja' },
    { a: '/localidades', t: 'Localidades', i: 'mapa' },
    { a: '/rutas', t: 'Rutas', i: 'ruta' },
    { a: '/perfil', t: 'Perfil', i: 'usuario' },
  ],
  administrador: [
    { a: '/tablero', t: 'Tablero', i: 'grafica' },
    { a: '/conteos', t: 'Conteos', i: 'caja' },
    { a: '/guias', t: 'Guías', i: 'guia' },
    { a: '/cierre-diario', t: 'Cierre diario', i: 'dinero' },
    { a: '/tarifas', t: 'Tarifas', i: 'etiqueta' },
    { a: '/localidades', t: 'Localidades', i: 'mapa' },
    { a: '/rutas', t: 'Rutas', i: 'ruta' },
    { a: '/usuarios', t: 'Usuarios', i: 'usuarios' },
    { a: '/bitacora', t: 'Bitácora', i: 'lista' },
    { a: '/perfil', t: 'Perfil', i: 'usuario' },
  ],
};

export function EstadoChip() {
  const { enLinea, pendientes, conError, sincronizando, sincronizar } = useSync();
  const { perfil } = useAuth();
  const total = pendientes + conError;
  const clases = ['estado-chip', enLinea ? '' : 'off', conError ? 'err' : '', sincronizando ? 'girando' : ''].join(' ');
  return (
    <button className={clases} onClick={() => void sincronizar()} aria-label={enLinea ? 'En línea. Toca para sincronizar' : 'Sin señal. Toca para reintentar'} data-testid="estado-conexion">
      <span className="punto" />
      <span>{sincronizando ? 'Enviando…' : enLinea ? 'En línea' : 'Sin señal'}</span>
      {perfil?.rol === 'rutero' && <span className="cuenta" data-testid="pendientes">{total} {total === 1 ? 'pendiente' : 'pendientes'}</span>}
    </button>
  );
}

export function Layout({ rol }: { rol: Rol }) {
  const { perfil } = useAuth();
  const { enLinea, conError } = useSync();
  const items = NAV[rol];
  const [mas, setMas] = useState(false);
  const loc = useLocation();
  const principales = items.length > 5 ? items.slice(0, 4) : items;
  const extras = items.length > 5 ? items.slice(4) : [];
  const ancho = rol === 'administrador' || rol === 'admin_n2';
  const enExtras = extras.some((e) => loc.pathname.startsWith(e.a));

  return (
    <div className="shell">
      <nav className="nav no-print" aria-label="Navegación principal">
        <div className="marca-lateral">ENVCA</div>
        {items.map((n, idx) => (
          <NavLink key={n.a} to={n.a} className={({ isActive }) => (isActive ? 'activo' : '') + (idx >= principales.length ? ' solo-lateral' : '')} onClick={() => setMas(false)}>
            <Icon n={n.i} /><span>{n.t}</span>
          </NavLink>
        ))}
        {extras.length > 0 && (
          <button className={'nav-i mas' + (enExtras ? ' activo' : '')} onClick={() => setMas((m) => !m)} aria-expanded={mas}>
            <Icon n="lista" /><span>Más</span>
          </button>
        )}
      </nav>
      {mas && (
        <div className="sheet-mas no-print">
          {extras.map((n) => (
            <NavLink key={n.a} to={n.a} className={({ isActive }) => (isActive ? 'activo' : '')} onClick={() => setMas(false)}><Icon n={n.i} />{n.t}</NavLink>
          ))}
        </div>
      )}
      <div className="cuerpo">
        <header className="header no-print">
          <div className="marca"><i /><div>ENVCA<small>{perfil?.nombre ?? ''}</small></div></div>
          <EstadoChip />
        </header>
        <main className={'contenido' + (ancho ? ' ancho' : '')}>
          <div className="col">
            {rol === 'rutero' && conError > 0 && (
              <Link to="/registros" style={{ textDecoration: 'none' }}>
                <Aviso tipo="err">{conError} registro{conError === 1 ? '' : 's'} no se pudo enviar. Toca para revisarlos.</Aviso>
              </Link>
            )}
            {rol !== 'rutero' && !enLinea && <Aviso tipo="warn">Sin conexión. Esta sección necesita internet; no se guardará nada hasta que vuelva la señal.</Aviso>}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
