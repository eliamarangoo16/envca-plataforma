# ENVCA — aplicación web (PWA)

Paquetería Oaxaca → EE. UU. Vite + React + TypeScript, `@supabase/supabase-js`, `idb`, `vite-plugin-pwa`. Interfaz en español (México), móvil primero, sin librerías de UI.

## Correr
```bash
npm ci
npm run dev          # desarrollo
npm run build        # typecheck + dist/
npm run preview      # sirve dist/ en http://127.0.0.1:4173
npm test             # pruebas unitarias (bandeja de salida, dinero, fechas, CSV, errores)
npm run smoke        # prueba en Chrome headless contra `preview` (Supabase simulado; no toca la base real)
```
`npm run smoke` necesita Chrome en `/usr/bin/google-chrome` (o `CHROME_PATH=...`). `SHOTS=/ruta npm run smoke` guarda capturas.

## Configuración
`src/lib/supabase.ts` usa la URL del proyecto y la **clave publicable** (pública). También se pueden definir `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env`. Nunca poner la service key aquí.

## Desplegar
Copiar el contenido de `dist/` a cualquier hosting estático (raíz o subcarpeta: usa `base: './'` y rutas con `#`). Debe servirse por HTTPS para que se instale como app y funcione el service worker. Cada despliegue nuevo se actualiza solo en los teléfonos al abrir la app con señal.

## Notas de diseño
- **Sin señal (rutero):** perfil, rutas y localidades se guardan en IndexedDB; los conteos, localidades nuevas y vínculos ruta–localidad van a una bandeja de salida con IDs uuid del cliente. Se envían en orden (localidades → ruta_localidades → conteos) con `upsert(..., { ignoreDuplicates: true })`, solo salen de la bandeja con confirmación del servidor, los errores de red se reintentan y los errores de datos se marcan sin bloquear al resto. Se sincroniza al abrir, al evento `online`, al volver a primer plano, cada 30 s si hay algo pendiente y con el botón del encabezado. Código: `src/lib/outbox.ts`, `src/lib/sync.tsx`.
- **Roles:** `administrador`, `admin_n2`, `rutero`, `sucursal` (agente de caja). La tabla de rutas está en `src/App.tsx`; la seguridad real es RLS.
- **Iconos:** `npm run icons` regenera los PNG (requiere Python + Pillow).
