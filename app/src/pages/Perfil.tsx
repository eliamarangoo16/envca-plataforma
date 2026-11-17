import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useSync } from '../lib/sync';
import { ROL_NOMBRE } from '../lib/types';
import { textoRestantes, vaciarAntesDeSalir, type RestoBandeja } from '../lib/salida';
import { Confirmar, Pagina } from '../components/ui';
import { Icon } from '../components/Icon';

export function Perfil() {
  const { perfil, userId, salir } = useAuth();
  const { enLinea, sincronizar } = useSync();
  const [fase, setFase] = useState<'cerrada' | 'enviando' | 'confirmar'>('cerrada');
  const [resto, setResto] = useState<RestoBandeja>({ total: 0, pendientes: 0, errores: 0 });
  if (!perfil) return null;

  async function pedirSalida() {
    setFase('enviando');
    // Primero se intenta enviar todo lo pendiente (si hay red).
    const r = userId ? await vaciarAntesDeSalir(userId, sincronizar) : { total: 0, pendientes: 0, errores: 0 };
    setResto(r);
    setFase('confirmar');
  }

  return (
    <Pagina titulo="Perfil">
      <div className="tarjeta">
        <p><b>{perfil.nombre ?? 'Sin nombre'}</b></p>
        <p>{ROL_NOMBRE[perfil.rol]}</p>
        {perfil.sucursal && <p className="muted">Sucursal: {perfil.sucursal}</p>}
        <p className="muted peq">Conexión: {enLinea ? 'en línea' : 'sin señal'}</p>
      </div>
      <button className="btn danger bloque" onClick={() => void pedirSalida()} disabled={fase !== 'cerrada'}><Icon n="salir" /> Cerrar sesión</button>
      {fase === 'enviando' && (
        <Confirmar titulo="Cerrar sesión" ocupado textoOk="Enviando…" texto={<p>Enviando tus registros pendientes antes de cerrar sesión…</p>} onOk={() => {}} onCancelar={() => {}} />
      )}
      {fase === 'confirmar' && (
        <Confirmar
          titulo="Cerrar sesión" peligro textoOk={resto.total > 0 ? 'Cerrar sesión de todos modos' : 'Cerrar sesión'}
          texto={resto.total > 0 ? (
            <>
              <p className="aviso warn" role="alert">
                <b>Tienes {textoRestantes(resto)} sin enviar.</b> No se pudieron enviar ahora{enLinea ? '' : ' (no hay señal)'}.
              </p>
              <p>Si cierras sesión, <b>no se perderán</b>: quedan guardados en este teléfono, pero <b>solo se enviarán cuando esta misma cuenta ({perfil.nombre ?? 'tu cuenta'}) vuelva a iniciar sesión en este teléfono</b> y haya señal. Otra cuenta no puede enviarlos.</p>
              {resto.errores > 0 && <p className="peq muted">Los que tienen error tampoco se envían solos: tendrás que reintentarlos o descartarlos al volver a entrar.</p>}
              <p><b>¿Quieres cerrar sesión de todos modos?</b></p>
            </>
          ) : (
            <>
              <p>¿Seguro que quieres cerrar sesión?</p>
              <p className="peq muted">Todo lo que capturaste ya se envió. Para volver a entrar necesitarás señal.</p>
            </>
          )}
          onOk={() => void salir()} onCancelar={() => setFase('cerrada')}
        />
      )}
      <p className="peq muted">ENVCA · versión 1.0</p>
    </Pagina>
  );
}
