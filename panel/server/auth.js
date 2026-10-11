import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = "awg_session";
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const adminFile = path.join(dataDir, "admin.json");

const sessions = new Map();
const failures = new Map();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

const dummyHash = hashPassword(crypto.randomBytes(32).toString("hex"));

export function initStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.chmodSync(dataDir, 0o700);
  return dataDir;
}

export function validateUsername(username) {
  if (typeof username !== "string") return "Enter a username.";
  const value = username.trim();
  if (!value) return "Enter a username.";
  if (value.length < 3 || value.length > 32) return "Use 3 to 32 characters for the username.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    return "Usernames can use letters, numbers, dots, dashes, and underscores.";
  }
  return null;
}

export function validatePassword(password, username) {
  if (typeof password !== "string" || password.length === 0) return "Enter a password.";
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Include a letter and a number.";
  if (typeof username === "string" && password.toLowerCase() === username.trim().toLowerCase()) {
    return "Use a password that is not the username.";
  }
  return null;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![n, r, p].every(Number.isInteger) || n < 2 || r < 1 || p < 1) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(String(password), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function readAdmin() {
  let raw;
  try {
    raw = fs.readFileSync(adminFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.username !== "string" || typeof parsed.passwordHash !== "string") {
    return null;
  }
  return parsed;
}

export function createAdmin(username, password) {
  const record = {
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(adminFile, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      const conflict = new Error("Admin already exists");
      conflict.code = "EEXIST";
      throw conflict;
    }
    throw error;
  }
  try {
    fs.writeFileSync(fd, payload);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(adminFile, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  try {
    fs.chmodSync(adminFile, 0o600);
  } catch {
    // The exclusive create already requested mode 0600.
  }
  return { username };
}

export function verifyLogin(username, password) {
  const admin = readAdmin();
  const name = typeof username === "string" ? username.trim() : "";
  const secret = typeof password === "string" ? password : "";
  if (!admin) {
    verifyPassword(secret || "x", dummyHash);
    return { ok: false, reason: "setup" };
  }
  const hash = admin.username === name ? admin.passwordHash : dummyHash;
  const passwordOk = verifyPassword(secret, hash);
  if (admin.username !== name || !passwordOk) return { ok: false, reason: "credentials" };
  return { ok: true, username: admin.username };
}

export function createSession(username) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_MS });
  return { token, maxAgeSec: Math.floor(SESSION_MS / 1000) };
}

export function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function deleteSession(token) {
  if (token) sessions.delete(token);
}

export function readCookie(header) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(token, req, maxAgeSec) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
  ];
  if (req.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(req) {
  const parts = [`${COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (req.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clientIp(req) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim() || "unknown";
    }
  }
  return req.socket.remoteAddress || "unknown";
}

export function retryAfter(ip) {
  const entry = failures.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.resetAt <= now) {
    failures.delete(ip);
    return 0;
  }
  if (entry.count < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

export function recordFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearFailures(ip) {
  failures.delete(ip);
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
