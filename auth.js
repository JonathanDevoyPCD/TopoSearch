const WORKER_URL = "https://toposearch-ngi-proxy.jonathan-f66.workers.dev";
const IS_PAGES = location.hostname.endsWith(".github.io");
const API_BASE = IS_PAGES ? WORKER_URL : new URLSearchParams(location.search).get("api");
const STORAGE_KEY = "toposearch.session";

export const authEnabled = Boolean(API_BASE);

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authMessage = document.querySelector("#auth-message");
const panels = document.querySelectorAll("[data-panel]");
const menuButton = document.querySelector("#user-menu-button");
const menu = document.querySelector("#user-menu");
const menuNote = document.querySelector("#menu-note");

let token = null;
let user = null;
let quota = null;
const quotaListeners = [];

function readStoredToken() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(value) {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in private browsing; the session then lasts for this page only.
  }
}

async function api(path, { method = "GET", body, auth } = {}) {
  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (auth) {
    headers.Authorization = `Bearer ${auth}`;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Could not reach the TopoSearch server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function showMessage(text, kind = "error") {
  authMessage.textContent = text || "";
  authMessage.dataset.kind = kind;
  authMessage.hidden = !text;
}

function showPanel(name) {
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  });
  showMessage("");
  const first = document.querySelector(`[data-panel="${name}"] input`);
  first?.focus();
}

function initials(name) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}

function renderQuota() {
  if (!quota) {
    return;
  }
  const pillText = document.querySelector("#quota-pill-text");
  pillText.textContent = `${quota.remaining} of ${quota.limit} left`;
  document.querySelector("#quota-pill").dataset.level =
    quota.remaining === 0 ? "empty" : quota.remaining <= 1 ? "low" : "ok";
  document.querySelector("#quota-detail").textContent =
    `${quota.remaining} of ${quota.limit} map generations available`;
  document.querySelector("#quota-bar").style.width = `${quota.limit ? (quota.remaining / quota.limit) * 100 : 0}%`;
  const reset = new Date(quota.resetsAt);
  document.querySelector("#quota-reset").textContent =
    `Resets ${reset.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
  quotaListeners.forEach((listener) => listener(quota));
}

function enterApp(result) {
  token = result.token || token;
  user = result.user;
  quota = result.quota;
  if (result.token) {
    storeToken(result.token);
  }
  document.querySelector("#user-initials").textContent = initials(user.name);
  document.querySelector("#user-name").textContent = user.name;
  document.querySelector("#user-email").textContent = user.email;
  renderQuota();
  authView.hidden = true;
  appView.hidden = false;
  document.dispatchEvent(new CustomEvent("toposearch:signed-in"));
}

function signOut(message) {
  token = null;
  user = null;
  quota = null;
  storeToken(null);
  document.querySelectorAll("#auth-view form").forEach((form) => form.reset());
  closeMenu();
  appView.hidden = true;
  authView.hidden = false;
  showPanel("login");
  if (message) {
    showMessage(message, "info");
  }
}

function closeMenu() {
  menu.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
}

function setBusy(form, busy) {
  form.querySelectorAll("button[type=submit]").forEach((button) => {
    button.disabled = busy;
    button.dataset.busy = String(busy);
  });
}

function bindForm(selector, handler) {
  const form = document.querySelector(selector);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage("");
    setBusy(form, true);
    try {
      await handler(Object.fromEntries(new FormData(form)), form);
    } catch (error) {
      showMessage(error.message);
    } finally {
      setBusy(form, false);
    }
  });
}

export function onQuotaChange(listener) {
  quotaListeners.push(listener);
}

export function quotaRemaining() {
  return authEnabled && quota ? quota.remaining : null;
}

export async function startGeneration() {
  if (!authEnabled) {
    return null;
  }
  try {
    const result = await api("/pdf/start", { method: "POST", auth: token });
    quota = result.quota;
    renderQuota();
    return result.printToken;
  } catch (error) {
    if (error.status === 401) {
      signOut("Your session expired. Please sign in again.");
    } else if (error.data?.quota) {
      quota = error.data.quota;
      renderQuota();
    }
    throw error;
  }
}

async function boot() {
  if (!authEnabled) {
    document.querySelectorAll("[data-auth-only]").forEach((element) => {
      element.hidden = true;
    });
    authView.hidden = true;
    appView.hidden = false;
    return;
  }

  bindForm("#login-form", async (values) => {
    enterApp(await api("/auth/login", { method: "POST", body: values }));
  });
  bindForm("#signup-form", async (values) => {
    enterApp(await api("/auth/signup", { method: "POST", body: values }));
  });
  bindForm("#forgot-form", async (values, form) => {
    await api("/auth/forgot", { method: "POST", body: values });
    form.reset();
    showMessage("If that email has an account, a reset link is on its way. It is valid for one hour.", "success");
  });
  bindForm("#reset-form", async (values, form) => {
    const resetToken = new URLSearchParams(location.hash.slice(1)).get("reset");
    await api("/auth/reset", { method: "POST", body: { token: resetToken, password: values.password } });
    form.reset();
    history.replaceState(null, "", location.pathname + location.search);
    showPanel("login");
    showMessage("Password updated. Sign in with your new password.", "success");
  });

  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => showPanel(tab.dataset.tab));
  });
  document.querySelectorAll("[data-goto]").forEach((link) => {
    link.addEventListener("click", () => showPanel(link.dataset.goto));
  });

  menuButton.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    menuNote.hidden = true;
  });
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !menuButton.contains(event.target)) {
      closeMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
  document.querySelector("#menu-logout").addEventListener("click", () => signOut());
  document.querySelector("#menu-reset").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/auth/forgot", { method: "POST", body: { email: user.email } });
      menuNote.textContent = `Reset link sent to ${user.email}.`;
    } catch (error) {
      menuNote.textContent = error.message;
    } finally {
      menuNote.hidden = false;
      button.disabled = false;
    }
  });

  authView.hidden = false;
  const resetToken = new URLSearchParams(location.hash.slice(1)).get("reset");
  if (resetToken) {
    showPanel("reset");
    return;
  }
  showPanel("login");

  const stored = readStoredToken();
  if (!stored) {
    return;
  }
  authView.dataset.loading = "true";
  try {
    const result = await api("/auth/me", { auth: stored });
    enterApp({ ...result, token: stored });
  } catch (error) {
    if (error.status === 401) {
      storeToken(null);
    } else {
      showMessage(error.message);
    }
  } finally {
    delete authView.dataset.loading;
  }
}

boot();
