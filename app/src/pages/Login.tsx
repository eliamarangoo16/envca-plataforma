import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { Aviso, Campo } from '../components/ui';

export function Login() {
  const { entrar, mensaje } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('Escribe tu correo y tu contraseña.'); return; }
    setOcupado(true);
    const r = await entrar(email, password);
    setOcupado(false);
    if (r) setError(r);
  }

  return (
    <main className="login">
      <div className="logo"><b>ENVCA</b><span /><small>Paquetería Oaxaca a Estados Unidos</small></div>
      {(error || mensaje) && <Aviso tipo="err">{error ?? mensaje}</Aviso>}
      <form className="col" onSubmit={(e) => void enviar(e)} noValidate>
        <Campo etiqueta="Correo electrónico"><input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" /></Campo>
        <Campo etiqueta="Contraseña"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
        <button className="btn primary bloque" type="submit" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="peq muted" style={{ textAlign: 'center' }}>Las cuentas las crea un administrador. Necesitas señal para iniciar sesión; después puedes trabajar sin conexión.</p>
    </main>
  );
}
