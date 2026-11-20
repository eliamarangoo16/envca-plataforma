// ENVCA - función edge `admin-usuarios`
// Los administradores nivel 1 crean y actualizan cuentas. Valida al llamador por su cuenta:
// token -> usuario (auth.getUser) -> perfil `administrador` activo. Si no, 401/403.
// La clave de servicio solo se lee de variables de entorno de la función y nunca se devuelve ni se registra.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const ROLES = ["administrador", "admin_n2", "rutero", "sucursal"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}
const fail = (mensaje: string, status = 400) => json({ error: mensaje }, status);

function secretKey(): string | undefined {
  // Claves nuevas (JSON con nombre) primero; respaldo a la variable heredada.
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys?.default) return keys.default as string;
  } catch (_) { /* ignorar */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined;
}

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Método no permitido.", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = secretKey();
  if (!url || !key) {
    console.error("admin-usuarios: falta configuración de entorno");
    return fail("Error de configuración del servidor.", 500);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- Validar al llamador ---
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return fail("Sesión no válida. Inicia sesión de nuevo.", 401);

  const { data: u, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !u?.user) return fail("Sesión no válida o vencida. Inicia sesión de nuevo.", 401);
  const caller = u.user;

  const { data: perfil, error: perr } = await admin
    .from("perfiles").select("rol, activo, super_admin").eq("id", caller.id).maybeSingle();
  if (perr) {
    console.error("admin-usuarios: error leyendo perfil del llamador:", perr.message);
    return fail("No se pudo verificar tu permiso. Intenta de nuevo.", 500);
  }
  if (!perfil || perfil.rol !== "administrador" || perfil.activo !== true) {
    return fail("No tienes permiso para administrar usuarios.", 403);
  }

  // --- Cuerpo ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("cuerpo");
  } catch (_) {
    return fail("El cuerpo de la solicitud debe ser JSON válido.");
  }

  async function sucursalExiste(codigo: string): Promise<boolean | null> {
    const { data, error } = await admin.from("sucursales").select("codigo").eq("codigo", codigo).maybeSingle();
    if (error) return null;
    return !!data;
  }

  // ================= CREAR =================
  if (body.accion === "crear") {
    const email = txt(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const nombre = txt(body.nombre);
    const rol = txt(body.rol);
    const sucursal = txt(body.sucursal) || null;

    if (!EMAIL_RE.test(email)) return fail("Escribe un correo electrónico válido.");
    if (password.length < 8) return fail("La contraseña debe tener al menos 8 caracteres.");
    if (!nombre) return fail("Escribe el nombre de la persona.");
    if (!ROLES.includes(rol)) return fail("Rol no válido.");
    if (rol === "sucursal" && !sucursal) return fail("El agente de caja necesita una sucursal.");
    if (sucursal) {
      const existe = await sucursalExiste(sucursal);
      if (existe === null) return fail("No se pudo verificar la sucursal. Intenta de nuevo.", 500);
      if (!existe) return fail("La sucursal indicada no existe.");
    }

    const { data: creado, error: cerr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { nombre },
    });
    if (cerr || !creado?.user) {
      const m = (cerr?.message ?? "").toLowerCase();
      if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
        return fail("Ya existe un usuario con ese correo.", 409);
      }
      if (m.includes("password")) return fail("La contraseña no es válida o es demasiado débil.");
      console.error("admin-usuarios: createUser falló:", cerr?.message);
      return fail("No se pudo crear la cuenta.", 500);
    }

    const id = creado.user.id;
    const { error: ierr } = await admin.from("perfiles").insert({ id, nombre, rol, sucursal, activo: true });
    if (ierr) {
      console.error("admin-usuarios: insert perfil falló:", ierr.message);
      // Deshacer la cuenta para no dejar un usuario sin perfil.
      const { error: derr } = await admin.auth.admin.deleteUser(id);
      if (derr) console.error("admin-usuarios: no se pudo deshacer la cuenta:", derr.message);
      return fail("No se pudo guardar el perfil. No se creó la cuenta.", 500);
    }
    return json({ ok: true, id });
  }

  // ================= ACTUALIZAR =================
  if (body.accion === "actualizar") {
    const id = txt(body.id);
    if (!UUID_RE.test(id)) return fail("Identificador de usuario no válido.");

    const { data: actual, error: gerr } = await admin
      .from("perfiles").select("id, rol, sucursal, activo, super_admin").eq("id", id).maybeSingle();
    if (gerr) {
      console.error("admin-usuarios: leer perfil falló:", gerr.message);
      return fail("No se pudo leer el usuario.", 500);
    }
    if (!actual) return fail("El usuario no existe.", 404);

    const cambios: Record<string, unknown> = {};
    if (body.nombre !== undefined) {
      const nombre = txt(body.nombre);
      if (!nombre) return fail("El nombre no puede estar vacío.");
      cambios.nombre = nombre;
    }
    if (body.rol !== undefined) {
      const rol = txt(body.rol);
      if (!ROLES.includes(rol)) return fail("Rol no válido.");
      cambios.rol = rol;
    }
    if (body.sucursal !== undefined) {
      cambios.sucursal = body.sucursal === null ? null : (txt(body.sucursal) || null);
    }
    if (body.activo !== undefined) {
      if (typeof body.activo !== "boolean") return fail("El valor de 'activo' no es válido.");
      cambios.activo = body.activo;
    }
    let password: string | undefined;
    if (body.password !== undefined) {
      if (typeof body.password !== "string" || body.password.length < 8) {
        return fail("La contraseña debe tener al menos 8 caracteres.");
      }
      password = body.password;
    }
    if (Object.keys(cambios).length === 0 && password === undefined) {
      return fail("No hay nada que actualizar.");
    }

    // Las cuentas de administradores principales (cambio de rol, baja o contraseña) solo las maneja otro principal.
    if (actual.super_admin === true && id !== caller.id && perfil.super_admin !== true) {
      return fail("Solo un administrador principal puede modificar a otro administrador principal.", 403);
    }

    // Solo un administrador principal da de baja usuarios (la base también lo exige).
    if (cambios.activo === false && actual.activo !== false && perfil.super_admin !== true) {
      return fail("Solo un administrador principal puede dar de baja usuarios.", 403);
    }

    // Un administrador no puede desactivarse ni quitarse el rol a sí mismo.
    if (id === caller.id) {
      if (cambios.activo === false) return fail("No puedes desactivar tu propia cuenta.", 403);
      if (cambios.rol !== undefined && cambios.rol !== "administrador") {
        return fail("No puedes quitarte el rol de administrador.", 403);
      }
    }

    const rolFinal = (cambios.rol ?? actual.rol) as string;
    const sucFinal = (cambios.sucursal !== undefined ? cambios.sucursal : actual.sucursal) as string | null;
    if (rolFinal === "sucursal" && !sucFinal) return fail("El agente de caja necesita una sucursal.");
    if (typeof cambios.sucursal === "string") {
      const existe = await sucursalExiste(cambios.sucursal);
      if (existe === null) return fail("No se pudo verificar la sucursal. Intenta de nuevo.", 500);
      if (!existe) return fail("La sucursal indicada no existe.");
    }

    if (Object.keys(cambios).length > 0) {
      const { error: uperr } = await admin.from("perfiles").update(cambios).eq("id", id);
      if (uperr) {
        console.error("admin-usuarios: update perfil falló:", uperr.message);
        // Reglas de la base (p. ej. "Debe quedar al menos un administrador nivel 1 activo").
        if (uperr.code === "42501") return fail(uperr.message, 403);
        return fail("No se pudo actualizar el perfil.", 500);
      }
    }
    if (password !== undefined) {
      const { error: pwerr } = await admin.auth.admin.updateUserById(id, { password });
      if (pwerr) {
        console.error("admin-usuarios: cambio de contraseña falló:", pwerr.message);
        const m = pwerr.message.toLowerCase();
        if (m.includes("password")) return fail("La contraseña no es válida o es demasiado débil.");
        return fail("No se pudo cambiar la contraseña.", 500);
      }
    }
    return json({ ok: true });
  }

  return fail("Acción no válida. Usa 'crear' o 'actualizar'.");
});
