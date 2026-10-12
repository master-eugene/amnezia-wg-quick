const copy = {
  loading: {
    step: "Checking",
    title: "Checking this host",
  },
  setup: {
    step: "01  Account",
    title: "Create the admin account",
  },
  login: {
    step: "Sign in",
    title: "Authorize this browser",
  },
  session: {
    step: "Clients",
    title: "Clients",
  },
};

const els = {
  step: document.querySelector("#step-label"),
  loading: document.querySelector("#loading"),
  banner: document.querySelector("#banner"),
  setup: document.querySelector("#setup-form"),
  login: document.querySelector("#login-form"),
  session: document.querySelector("#session-view"),
  setupError: document.querySelector("#setup-error"),
  loginError: document.querySelector("#login-error"),
  clientError: document.querySelector("#client-error"),
  clientName: document.querySelector("#client-name"),
  clientList: document.querySelector("#client-list"),
  clientEmpty: document.querySelector("#client-empty"),
  clientConfigWrap: document.querySelector("#client-config-wrap"),
  clientConfigLabel: document.querySelector("#client-config-label"),
  clientConfig: document.querySelector("#client-config"),
  clientQr: document.querySelector("#client-qr"),
  clientCopy: document.querySelector("#client-copy"),
  shareLoading: document.querySelector("#client-share-loading"),
  shareLoadingText: document.querySelector("#client-share-loading-text"),
  statusList: document.querySelector("#status-list"),
  toolHint: document.querySelector("#tool-hint"),
};

document.querySelectorAll("[data-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.toggle);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(show));
  });
});

function setAlert(node, message) {
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

function humanError(error) {
  if (error instanceof TypeError) return "The panel did not respond. Check that the service is running.";
  return error.message || "Something went wrong.";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function applyCopy(view) {
  const text = copy[view];
  els.step.textContent = text.step;
  document.title = `${text.title} · AmneziaWG Quick`;
}

function show(view) {
  applyCopy(view);
  els.loading.hidden = view !== "loading";
  els.setup.hidden = view !== "setup";
  els.login.hidden = view !== "login";
  els.session.hidden = view !== "session";
  if (view === "setup") document.querySelector("#setup-username").focus();
  if (view === "login") document.querySelector("#login-username").focus();
  if (view !== "session") hideConfig();
}

function clearSecrets() {
  for (const id of ["setup-password", "setup-confirm", "login-password"]) {
    document.getElementById(id).value = "";
  }
  updateRules();
}

function usernameError(value) {
  const username = value.trim();
  if (!username) return "Enter a username.";
  if (username.length < 3 || username.length > 32) return "Use 3 to 32 characters for the username.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(username)) {
    return "Usernames can use letters, numbers, dots, dashes, and underscores.";
  }
  return null;
}

function passwordError(password, username) {
  if (!password) return "Enter a password.";
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Include a letter and a number.";
  if (password.toLowerCase() === username.trim().toLowerCase()) return "Use a password that is not the username.";
  return null;
}

function updateRules() {
  const password = document.querySelector("#setup-password").value;
  const confirm = document.querySelector("#setup-confirm").value;
  const checks = {
    length: password.length >= 10,
    letter: /[A-Za-z]/.test(password),
    number: /[0-9]/.test(password),
    match: password.length > 0 && password === confirm,
  };
  document.querySelectorAll("#rules [data-rule]").forEach((item) => {
    item.classList.toggle("met", checks[item.dataset.rule]);
  });
}

document.querySelector("#setup-password").addEventListener("input", updateRules);
document.querySelector("#setup-confirm").addEventListener("input", updateRules);
els.setup.addEventListener("input", () => setAlert(els.setupError, ""));
els.login.addEventListener("input", () => setAlert(els.loginError, ""));

function hideConfig() {
  delete els.clientConfigWrap.dataset.clientId;
  delete els.clientConfigWrap.dataset.mode;
  els.clientConfigWrap.hidden = true;
  els.shareLoading.hidden = true;
  els.clientConfig.hidden = false;
  els.clientConfig.textContent = "";
  els.clientQr.hidden = true;
  els.clientQr.removeAttribute("src");
  els.clientCopy.hidden = false;
}

function shareTitle(mode) {
  if (mode === "link") return "link";
  if (mode === "qr") return "QR code";
  return "config";
}

function shareLoadingText(mode) {
  if (mode === "qr") return "Drawing the QR code…";
  if (mode === "link") return "Preparing the link…";
  return "Preparing the config…";
}

function showShareLoading(client, mode) {
  els.clientConfigWrap.dataset.clientId = String(client.id);
  els.clientConfigWrap.dataset.mode = mode;
  els.clientConfigLabel.textContent = `${client.name} ${shareTitle(mode)}`;
  els.shareLoadingText.textContent = shareLoadingText(mode);
  els.shareLoading.hidden = false;
  els.clientConfig.hidden = true;
  els.clientQr.hidden = true;
  els.clientQr.removeAttribute("src");
  els.clientCopy.hidden = true;
  els.clientConfigWrap.hidden = false;
}

function showShare(client, mode, text, svg) {
  els.clientConfigWrap.dataset.clientId = String(client.id);
  els.clientConfigWrap.dataset.mode = mode;
  els.clientConfigLabel.textContent = `${client.name} ${shareTitle(mode)}`;
  els.shareLoading.hidden = true;
  els.clientConfig.textContent = text;
  els.clientConfig.hidden = mode === "qr";
  if (mode === "qr" && svg) {
    els.clientQr.hidden = false;
    els.clientQr.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } else {
    els.clientQr.hidden = true;
    els.clientQr.removeAttribute("src");
  }
  els.clientCopy.hidden = mode === "qr";
  els.clientCopy.textContent = mode === "link" ? "Copy link" : "Copy config";
  els.clientConfigWrap.hidden = false;
}

function miniButton(label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className ? `mini ${className}` : "mini";
  button.textContent = label;
  return button;
}

function paintClients(clients) {
  els.clientList.replaceChildren();
  els.clientEmpty.hidden = clients.length > 0;
  for (const client of clients) {
    const item = document.createElement("li");
    item.className = "client";
    const top = document.createElement("div");
    top.className = "client-top";
    const name = document.createElement("p");
    name.className = "client-name";
    name.textContent = client.name;
    const state = document.createElement("span");
    state.dataset.state = client.enabled ? "ok" : "off";
    state.textContent = client.enabled ? "Enabled" : "Disabled";
    top.append(name, state);
    const meta = document.createElement("p");
    meta.className = "client-meta";
    meta.textContent = client.address;
    const actions = document.createElement("div");
    actions.className = "client-actions";
    const qr = miniButton("QR");
    const link = miniButton("Link");
    const config = miniButton("Config");
    const change = miniButton("Change");
    const access = miniButton(client.enabled ? "Disable" : "Enable");
    const remove = miniButton("Remove", "danger");
    qr.addEventListener("click", () => openShare(client, "qr"));
    link.addEventListener("click", () => openShare(client, "link"));
    config.addEventListener("click", () => openShare(client, "config"));
    change.addEventListener("click", () => startRename(item, client));
    access.addEventListener("click", () => setAccess(client, !client.enabled, access));
    remove.addEventListener("click", () => startRemove(actions, client));
    actions.append(qr, link, config, change, access, remove);
    item.append(top, meta, actions);
    els.clientList.append(item);
  }
}

function startRename(item, client) {
  const editor = document.createElement("form");
  editor.className = "client-edit";
  const input = document.createElement("input");
  input.value = client.name;
  input.maxLength = 32;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", `New name for ${client.name}`);
  const save = miniButton("Save");
  save.type = "submit";
  const cancel = miniButton("Cancel");
  editor.append(input, save, cancel);
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    setAlert(els.clientError, "");
    try {
      await api(`/api/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: input.value.trim() }),
      });
      await loadClients();
    } catch (error) {
      setAlert(els.clientError, humanError(error));
      save.disabled = false;
    }
  });
  cancel.addEventListener("click", () => loadClients());
  item.replaceChildren(editor);
  input.focus();
  input.select();
}

function startRemove(actions, client) {
  actions.replaceChildren();
  const prompt = document.createElement("span");
  prompt.className = "client-meta";
  prompt.textContent = `Remove ${client.name}?`;
  const confirm = miniButton("Remove", "danger");
  const cancel = miniButton("Cancel");
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    setAlert(els.clientError, "");
    try {
      await api(`/api/clients/${client.id}`, { method: "DELETE" });
      await loadClients();
    } catch (error) {
      setAlert(els.clientError, humanError(error));
      confirm.disabled = false;
    }
  });
  cancel.addEventListener("click", () => loadClients());
  actions.append(prompt, confirm, cancel);
}

function markUpdating(button) {
  const item = button.closest(".client");
  const badge = item.querySelector("[data-state]");
  const led = document.createElement("span");
  led.className = "led";
  led.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = "Updating…";
  badge.dataset.state = "wait";
  badge.replaceChildren(led, label);
  item.setAttribute("aria-busy", "true");
  for (const control of item.querySelectorAll("button")) control.disabled = true;
  button.textContent = "Updating…";
}

async function setAccess(client, enabled, button) {
  setAlert(els.clientError, "");
  markUpdating(button);
  try {
    await api(`/api/clients/${client.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    await loadClients();
  } catch (error) {
    setAlert(els.clientError, humanError(error));
    await loadClients();
  }
}

let shareToken = 0;

async function openShare(client, mode) {
  const token = ++shareToken;
  setAlert(els.clientError, "");
  showShareLoading(client, mode);
  try {
    const result = await api(`/api/clients/${client.id}/config`);
    if (token !== shareToken) return;
    const owner = result.client || client;
    if (mode === "qr" && !result.qr) {
      hideConfig();
      setAlert(els.clientError, "qrencode is not installed, so the QR code cannot be drawn.");
      return;
    }
    if (mode === "link") {
      showShare(owner, "link", result.link || "", "");
      return;
    }
    if (mode === "qr") {
      showShare(owner, "qr", result.config || "", result.qr);
      return;
    }
    showShare(owner, "config", result.config || "", "");
  } catch (error) {
    if (token !== shareToken) return;
    hideConfig();
    setAlert(els.clientError, humanError(error));
  }
}

function copyTextNow(text) {
  let ok = false;
  const onCopy = (event) => {
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    ok = true;
  };
  document.addEventListener("copy", onCopy);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.padding = "0";
  area.style.border = "none";
  area.style.outline = "none";
  area.style.boxShadow = "none";
  area.style.background = "transparent";
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  try {
    ok = document.execCommand("copy") || ok;
  } catch {
    ok = false;
  }
  document.removeEventListener("copy", onCopy);
  area.remove();
  return ok;
}

async function loadClients() {
  const result = await api("/api/clients");
  const clients = result.clients || [];
  paintClients(clients);
  const shown = els.clientConfigWrap.dataset.clientId;
  const current = clients.find((client) => String(client.id) === shown);
  if (shown && !current) hideConfig();
  else if (current) {
    els.clientConfigLabel.textContent = `${current.name} ${shareTitle(els.clientConfigWrap.dataset.mode)}`;
  }
  if (result.warning) setAlert(els.clientError, result.warning);
}

async function enterSession(state) {
  show("session");
  clearSecrets();
  setAlert(els.clientError, "");
  els.statusList.replaceChildren();
  els.toolHint.hidden = true;
  try {
    await loadClients();
  } catch (error) {
    els.clientList.replaceChildren();
    els.clientEmpty.hidden = true;
    setAlert(els.clientError, humanError(error));
  }
  try {
    const status = await api("/api/status");
    const missing = [];
    for (const tool of status.tools) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = tool.label;
      const value = document.createElement("span");
      value.textContent = tool.installed ? "Installed" : "Missing";
      value.dataset.state = tool.installed ? "ok" : "missing";
      item.append(name, value);
      els.statusList.append(item);
      if (!tool.installed) missing.push(tool.label);
    }
    if (missing.length) {
      const detail = status.tools.map((tool) => tool.detail).find(Boolean);
      els.toolHint.hidden = false;
      els.toolHint.textContent = detail || "AmneziaWG tools are not available in this environment.";
    }
  } catch (error) {
    const item = document.createElement("li");
    item.textContent = humanError(error);
    els.statusList.append(item);
  }
}

function render(state) {
  setAlert(els.banner, "");
  if (state.user) {
    enterSession(state);
    return;
  }
  show(state.needsSetup ? "setup" : "login");
}

els.setup.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#setup-username").value;
  const password = document.querySelector("#setup-password").value;
  const confirm = document.querySelector("#setup-confirm").value;
  const nameError = usernameError(username);
  const secretError = passwordError(password, username);
  if (nameError || secretError) {
    setAlert(els.setupError, nameError || secretError);
    return;
  }
  if (password !== confirm) {
    setAlert(els.setupError, "Passwords don't match.");
    return;
  }
  const button = document.querySelector("#setup-submit");
  button.disabled = true;
  button.textContent = "Creating account…";
  setAlert(els.setupError, "");
  try {
    const state = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({ username: username.trim(), password }),
    });
    await enterSession(state);
  } catch (error) {
    if (error.status === 409) {
      show("login");
      setAlert(els.loginError, humanError(error));
    } else {
      setAlert(els.setupError, humanError(error));
    }
  } finally {
    button.disabled = false;
    button.textContent = "Create account";
  }
});

els.login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#login-username").value;
  const password = document.querySelector("#login-password").value;
  if (!username.trim() || !password) {
    setAlert(els.loginError, "Enter your username and password.");
    return;
  }
  const button = document.querySelector("#login-submit");
  button.disabled = true;
  button.textContent = "Signing in…";
  setAlert(els.loginError, "");
  try {
    const state = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim(), password }),
    });
    await enterSession(state);
  } catch (error) {
    if (error.status === 409) {
      show("setup");
      setAlert(els.setupError, humanError(error));
    } else {
      setAlert(els.loginError, humanError(error));
    }
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

document.querySelector("#client-add").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.clientName.value.trim();
  const button = document.querySelector("#client-add-submit");
  button.disabled = true;
  setAlert(els.clientError, "");
  try {
    const result = await api("/api/clients", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    els.clientName.value = "";
    if (result.client && result.config) showShare(result.client, "config", result.config, "");
    if (result.warning) setAlert(els.clientError, result.warning);
    await loadClients();
  } catch (error) {
    setAlert(els.clientError, humanError(error));
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#client-copy").addEventListener("click", async () => {
  const button = document.querySelector("#client-copy");
  const text = els.clientConfig.textContent;
  const copied = copyTextNow(text);
  if (!copied && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
  } else {
    button.textContent = copied ? "Copied" : "Copy failed";
  }
  setTimeout(() => {
    button.textContent = els.clientConfigWrap.dataset.mode === "link" ? "Copy link" : "Copy config";
  }, 1600);
});

document.querySelector("#logout").addEventListener("click", async () => {
  const button = document.querySelector("#logout");
  button.disabled = true;
  try {
    const state = await api("/api/logout", { method: "POST" });
    clearSecrets();
    render(state);
  } catch (error) {
    setAlert(els.banner, humanError(error));
  } finally {
    button.disabled = false;
  }
});

try {
  render(await api("/api/session"));
} catch (error) {
  els.loading.hidden = true;
  setAlert(els.banner, humanError(error));
}
