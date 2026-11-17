# ENVCA Plataforma

Plataforma operativa de ENVCA (paquetería Oaxaca → EE. UU.): conteos de recepción por ruta, salidas por localidad, guías con cobro por peso, tarifas, cierre diario y tablero. Interfaz distinta por rol y captura sin señal para ruteros.

- `app/` — aplicación web instalable (Vite + React + TypeScript). Ver `app/README.md`.
- `supabase/migrations/` — SQL aplicado a la base de datos.
- `supabase/functions/admin-usuarios/` — función para que el administrador nivel 1 cree y edite cuentas.
- `supabase/tests/` — pruebas de permisos (se revierten solas).
- `docs/CONTRATO.md` — especificación técnica.

Cada cambio en `main` se publica solo en GitHub Pages (Settings → Pages → Source: **GitHub Actions**).
