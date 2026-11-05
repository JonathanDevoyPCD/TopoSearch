const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100000;
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PRINT_SECONDS = 60 * 60;
const RESET_SECONDS = 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function toBase64Url(bytes) {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

async function hmacKey(secret) {
  if (!secret) {
    throw new HttpError(500, "Server is not configured for sign-in.");
  }
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ]);
}

export async function signToken(payload, secret, lifetimeSeconds) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(body)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(token, secret, type) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) {
    return null;
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(encoded)
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    return null;
  }
  if (!valid) {
    return null;
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (payload.t !== type || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${toBase64Url(salt)}$${toBase64Url(await derive(password, salt))}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split("$");
  if (!salt || !hash) {
    return false;
  }
  return safeEqual(await derive(password, fromBase64Url(salt)), fromBase64Url(hash));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function nextMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function quotaLimit(env) {
  const limit = Number(env.MONTHLY_QUOTA);
  return Number.isFinite(limit) && limit >= 0 ? limit : 5;
}

async function quotaFor(env, userId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS used FROM generations WHERE user_id = ?1 AND created_at >= ?2")
    .bind(userId, monthStart())
    .first();
  const limit = quotaLimit(env);
  const used = row?.used || 0;
  return { used, limit, remaining: Math.max(0, limit - used), resetsAt: nextMonthStart() };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}

function cleanPassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, "Password must be 8 to 128 characters.");
  }
  return password;
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 80) {
    throw new HttpError(400, "Enter your name (up to 80 characters).");
  }
  return name;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

async function sessionFor(request, env) {
  const header = request.headers.get("Authorization") || "";
  const payload = await verifyToken(header.replace(/^Bearer\s+/i, ""), env.SESSION_SECRET, "s");
  if (!payload) {
    throw new HttpError(401, "Please sign in again.");
  }
  const user = await env.DB.prepare("SELECT id, name, email, pw_version FROM users WHERE id = ?1")
    .bind(payload.uid)
    .first();
  if (!user || user.pw_version !== payload.v) {
    throw new HttpError(401, "Please sign in again.");
  }
  return user;
}

function sessionToken(user, env) {
  return signToken({ t: "s", uid: user.id, v: user.pw_version }, env.SESSION_SECRET, SESSION_SECONDS);
}

async function authResponse(user, env) {
  return {
    token: await sessionToken(user, env),
    user: publicUser(user),
    quota: await quotaFor(env, user.id)
  };
}

async function sendResetEmail(env, user, token) {
  const link = `${env.SITE_URL}/#reset=${token}`;
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set; password reset email was not sent.");
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [user.email],
      subject: "Reset your TopoSearch password",
      text: `Hi ${user.name},\n\nUse this link within one hour to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.`
    })
  });
  if (!response.ok) {
    console.error(`Resend failed (${response.status}): ${await response.text()}`);
  }
}

const routes = {
  async "POST /auth/signup"(request, env) {
    const body = await readJson(request);
    const name = cleanName(body.name);
    const email = cleanEmail(body.email);
    const hash = await hashPassword(cleanPassword(body.password));
    try {
      const result = await env.DB.prepare(
        "INSERT INTO users (email, name, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)"
      )
        .bind(email, name, hash, new Date().toISOString())
        .run();
      const user = { id: result.meta.last_row_id, name, email, pw_version: 1 };
      return authResponse(user, env);
    } catch (error) {
      if (/UNIQUE/i.test(String(error?.message))) {
        throw new HttpError(409, "An account with that email already exists. Try signing in.");
      }
      throw error;
    }
  },

  async "POST /auth/login"(request, env) {
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const user = await env.DB.prepare(
      "SELECT id, name, email, password_hash, pw_version FROM users WHERE email = ?1"
    )
      .bind(email)
      .first();
    const valid = user
      ? await verifyPassword(String(body.password || ""), user.password_hash)
      : (await derive("x", new Uint8Array(16)), false);
    if (!valid) {
      throw new HttpError(401, "Incorrect email or password.");
    }
    return authResponse(user, env);
  },

  async "GET /auth/me"(request, env) {
    const user = await sessionFor(request, env);
    return { user: publicUser(user), quota: await quotaFor(env, user.id) };
  },

  async "POST /auth/forgot"(request, env, ctx) {
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const user = await env.DB.prepare("SELECT id, name, email FROM users WHERE email = ?1").bind(email).first();
    if (user) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const token = toBase64Url(raw);
      await env.DB.prepare("DELETE FROM reset_tokens WHERE user_id = ?1 OR expires_at < ?2")
        .bind(user.id, new Date().toISOString())
        .run();
      await env.DB.prepare("INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
        .bind(await sha256Hex(token), user.id, new Date(Date.now() + RESET_SECONDS * 1000).toISOString())
        .run();
      ctx.waitUntil(sendResetEmail(env, user, token));
    }
    return { ok: true };
  },

  async "POST /auth/reset"(request, env) {
    const body = await readJson(request);
    const password = cleanPassword(body.password);
    const row = await env.DB.prepare("SELECT user_id, expires_at FROM reset_tokens WHERE token_hash = ?1")
      .bind(await sha256Hex(String(body.token || "")))
      .first();
    if (!row || row.expires_at < new Date().toISOString()) {
      throw new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
    }
    const hash = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?1, pw_version = pw_version + 1 WHERE id = ?2").bind(
        hash,
        row.user_id
      ),
      env.DB.prepare("DELETE FROM reset_tokens WHERE user_id = ?1").bind(row.user_id)
    ]);
    return { ok: true };
  },

  async "POST /pdf/start"(request, env) {
    const user = await sessionFor(request, env);
    const result = await env.DB.prepare(
      `INSERT INTO generations (user_id, created_at)
       SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM generations WHERE user_id = ?1 AND created_at >= ?3) < ?4`
    )
      .bind(user.id, new Date().toISOString(), monthStart(), quotaLimit(env))
      .run();
    const quota = await quotaFor(env, user.id);
    if (!result.meta.changes) {
      throw new HttpError(403, "You have used all of your map generations for this month.", { quota });
    }
    return {
      printToken: await signToken({ t: "p", uid: user.id }, env.SESSION_SECRET, PRINT_SECONDS),
      quota
    };
  }
};

export function isAuthRoute(request, pathname) {
  return `${request.method} ${pathname}` in routes;
}

export async function handleAuth(request, pathname, env, ctx) {
  const handler = routes[`${request.method} ${pathname}`];
  if (!env.DB) {
    throw new HttpError(500, "Server database is not configured.");
  }
  return handler(request, env, ctx);
}

export async function requirePrintToken(request, env) {
  const header = request.headers.get("Authorization") || "";
  const payload = await verifyToken(header.replace(/^Bearer\s+/i, ""), env.SESSION_SECRET, "p");
  if (!payload) {
    throw new HttpError(401, "Sign in and start a map generation to download tiles.");
  }
  return payload;
}
