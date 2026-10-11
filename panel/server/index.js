import express from "express";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  clearCookie,
  clearFailures,
  clientIp,
  createAdmin,
  createSession,
  deleteSession,
  getSession,
  initStore,
  readAdmin,
  readCookie,
  recordFailure,
  retryAfter,
  sameOrigin,
  sessionCookie,
  validatePassword,
  validateUsername,
  verifyLogin,
} from "./auth.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const port = Number(process.env.PORT || 51821);
const host = process.env.HOST || "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer from 1 to 65535.");
  process.exit(1);
}

const dataDir = initStore();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  next();
});

app.use(express.json({ limit: "16kb" }));

function currentUser(req) {
  const session = getSession(readCookie(req.headers.cookie));
  return session ? { username: session.username } : null;
}

function publicState(req) {
  const user = currentUser(req);
  return {
    needsSetup: !readAdmin(),
    user,
    host: os.hostname(),
  };
}

function hostCommand(command, args) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 20000 });
}

function commandExists(bin) {
  const args = bin === "awg" ? ["show", "interfaces"] : [];
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 8000 });
  if (result.error) {
    console.error(`${bin} probe failed: ${result.error.message}`);
    return false;
  }
  if (bin === "awg") {
    if (result.status !== 0) console.error(stripAnsi(result.stderr) || `${bin} probe exited ${result.status}`);
    return result.status === 0;
  }
  const text = stripAnsi(`${result.stdout || ""}\n${result.stderr || ""}`);
  const ok = /usage/i.test(text);
  if (!ok) console.error(text || `${bin} probe exited ${result.status}`);
  return ok;
}

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
}

function awqJson(args) {
  const result = hostCommand("awq", args);
  if (result.error) {
    const error = new Error(
      result.error.code === "ENOENT" ? "awq is not available on this host." : "Could not run awq.",
    );
    error.status = 503;
    throw error;
  }
  const stderr = stripAnsi(result.stderr);
  const stdout = stripAnsi(result.stdout);
  let payload = {};
  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      const error = new Error(stderr || "awq returned an unexpected response.");
      error.status = 500;
      throw error;
    }
  }
  if (result.status !== 0) {
    const error = new Error(stderr || "Could not update clients.");
    error.status = result.status === 2 ? 400 : 500;
    console.error(error.message);
    throw error;
  }
  if (stderr) payload.warning = stderr;
  return payload;
}

function sendAwqError(res, error) {
  const status = error.status || 500;
  const lines = String(error.message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const picked = lines[0] && lines[0].startsWith("Traceback") ? lines[lines.length - 1] : lines[0];
  res.status(status).json({ error: (picked || "Could not update clients.").slice(0, 240) });
}

function clientId(raw) {
  return /^[0-9]+$/.test(raw) ? raw : "";
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return user;
}

function guardOrigin(req, res) {
  if (sameOrigin(req)) return true;
  res.status(403).json({ error: "Request origin was rejected." });
  return false;
}

function credentials(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body;
}

const api = express.Router();

api.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

api.get("/session", (req, res) => {
  res.json(publicState(req));
});

api.get("/clients", (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    res.json(awqJson(["client", "list"]));
  } catch (error) {
    sendAwqError(res, error);
  }
});

api.post("/clients", (req, res) => {
  if (!guardOrigin(req, res) || !requireUser(req, res)) return;
  const body = credentials(req.body);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  try {
    res.status(201).json(awqJson(["client", "add", "--name", name]));
  } catch (error) {
    sendAwqError(res, error);
  }
});

api.patch("/clients/:id", (req, res) => {
  if (!guardOrigin(req, res) || !requireUser(req, res)) return;
  const id = clientId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Enter a client id." });
    return;
  }
  const body = credentials(req.body);
  const hasName = typeof body.name === "string";
  const hasEnabled = typeof body.enabled === "boolean";
  if (!hasName && !hasEnabled) {
    res.status(400).json({ error: "Nothing to change." });
    return;
  }
  try {
    let payload = {};
    if (hasName) payload = awqJson(["client", "rename", "--id", id, "--name", body.name.trim()]);
    if (hasEnabled) payload = awqJson(["client", body.enabled ? "enable" : "disable", "--id", id]);
    res.json(payload);
  } catch (error) {
    sendAwqError(res, error);
  }
});

api.delete("/clients/:id", (req, res) => {
  if (!guardOrigin(req, res) || !requireUser(req, res)) return;
  const id = clientId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Enter a client id." });
    return;
  }
  try {
    res.json(awqJson(["client", "remove", "--id", id]));
  } catch (error) {
    sendAwqError(res, error);
  }
});

api.get("/clients/:id/config", (req, res) => {
  if (!requireUser(req, res)) return;
  const id = clientId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Enter a client id." });
    return;
  }
  try {
    res.json(awqJson(["client", "config", "--id", id]));
  } catch (error) {
    sendAwqError(res, error);
  }
});

api.get("/status", (req, res) => {
  if (!requireUser(req, res)) return;
  res.json({
    tools: [
      { id: "awg", label: "awg", installed: commandExists("awg") },
      { id: "awg-quick", label: "awg-quick", installed: commandExists("awg-quick") },
    ],
  });
});

api.post("/setup", (req, res) => {
  if (!guardOrigin(req, res)) return;
  if (readAdmin()) {
    res.status(409).json({ error: "An admin account already exists. Sign in instead." });
    return;
  }
  const body = credentials(req.body);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const usernameError = validateUsername(username);
  if (usernameError) {
    res.status(400).json({ error: usernameError });
    return;
  }
  const passwordError = validatePassword(body.password, username);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }
  try {
    createAdmin(username, body.password);
  } catch (error) {
    if (error.code === "EEXIST") {
      res.status(409).json({ error: "An admin account already exists. Sign in instead." });
      return;
    }
    throw error;
  }
  const session = createSession(username);
  res.setHeader("Set-Cookie", sessionCookie(session.token, req, session.maxAgeSec));
  res.status(201).json({ needsSetup: false, user: { username }, host: os.hostname() });
});

api.post("/login", (req, res) => {
  if (!guardOrigin(req, res)) return;
  const ip = clientIp(req);
  const wait = retryAfter(ip);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again." });
    return;
  }
  const body = credentials(req.body);
  const result = verifyLogin(body.username, body.password);
  if (!result.ok) {
    if (result.reason === "setup") {
      res.status(409).json({ error: "Create the admin account first." });
      return;
    }
    recordFailure(ip);
    res.status(401).json({ error: "Those credentials don't match." });
    return;
  }
  clearFailures(ip);
  const session = createSession(result.username);
  res.setHeader("Set-Cookie", sessionCookie(session.token, req, session.maxAgeSec));
  res.json({ needsSetup: false, user: { username: result.username }, host: os.hostname() });
});

api.post("/logout", (req, res) => {
  if (!guardOrigin(req, res)) return;
  deleteSession(readCookie(req.headers.cookie));
  res.setHeader("Set-Cookie", clearCookie(req));
  res.json({ needsSetup: !readAdmin(), user: null, host: os.hostname() });
});

app.use("/api", api);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

function mountFonts(urlPath, packageName) {
  const dir = path.join(path.dirname(require.resolve(`${packageName}/package.json`)), "files");
  app.use(urlPath, express.static(dir, { maxAge: "7d", immutable: true }));
}

mountFonts("/fonts/manrope", "@fontsource/manrope");
mountFonts("/fonts/syne", "@fontsource/syne");

app.use(
  express.static(publicDir, {
    index: "index.html",
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }),
);

app.use((err, _req, res, next) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Send a JSON body." });
    return;
  }
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "That request is too large." });
    return;
  }
  console.error(err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: "The panel hit an unexpected error." });
});

const server = app.listen(port, host, () => {
  const where = host === "0.0.0.0" || host === "::" ? `0.0.0.0:${port}` : `${host}:${port}`;
  console.log(`AmneziaWG Quick panel listening on http://${where}`);
  console.log(`Account data: ${dataDir}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${port} is already in use.`);
  else console.error(error);
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
