"use strict";

const CONFIG = Object.freeze({
  apiBase: "https://inai-col3.fishrungames.com/api",
  websocketUrl: "wss://inai-col3.fishrungames.com/chat/",
});

const STORAGE_TOKEN = "room.access";
const STORAGE_USERNAME = "room.username";

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  chatScreen: document.querySelector("#chat-screen"),
  authForm: document.querySelector("#auth-form"),
  authTitle: document.querySelector("#auth-title"),
  authSubtitle: document.querySelector("#auth-subtitle"),
  formKicker: document.querySelector("#form-kicker"),
  loginTab: document.querySelector("#login-tab"),
  registerTab: document.querySelector("#register-tab"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  passwordHint: document.querySelector("#password-hint"),
  passwordToggle: document.querySelector(".password-toggle"),
  submitButton: document.querySelector("#submit-auth"),
  submitLabel: document.querySelector("#submit-label"),
  formError: document.querySelector("#form-error"),
  profileName: document.querySelector("#profile-name"),
  profileAvatar: document.querySelector("#profile-avatar"),
  logoutButton: document.querySelector("#logout-button"),
  roomStatusLight: document.querySelector("#room-status-light"),
  roomStatusText: document.querySelector("#room-status-text"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  messages: document.querySelector("#messages"),
  emptyState: document.querySelector("#empty-state"),
  messageForm: document.querySelector("#message-form"),
  messageInput: document.querySelector("#message-input"),
  sendButton: document.querySelector("#send-button"),
  composerHint: document.querySelector("#composer-hint"),
  toast: document.querySelector("#toast"),
};

let authMode = "login";
let accessToken = sessionStorage.getItem(STORAGE_TOKEN) || "";
let username = sessionStorage.getItem(STORAGE_USERNAME) || "";
let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let refreshInProgress = null;
let intentionalClose = false;
let authTimeout = null;
let toastTimeout = null;
let refreshBeforeNextConnect = false;

function decodeJwtPayload(token) {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function tokenNeedsRefresh(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp * 1000 < Date.now() + 60_000;
}

function usernameFromToken(token, fallback = "") {
  const payload = decodeJwtPayload(token);
  return String(payload?.username || payload?.user_name || fallback || "участник");
}

function setFormError(message = "") {
  elements.formError.textContent = message;
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  elements.loginTab.classList.toggle("is-active", isLogin);
  elements.registerTab.classList.toggle("is-active", !isLogin);
  elements.loginTab.setAttribute("aria-selected", String(isLogin));
  elements.registerTab.setAttribute("aria-selected", String(!isLogin));
  elements.formKicker.textContent = isLogin ? "С ВОЗВРАЩЕНИЕМ" : "ХОРОШО, ЧТО ВЫ С НАМИ";
  elements.authTitle.textContent = isLogin ? "Войти в комнату" : "Создать аккаунт";
  elements.authSubtitle.textContent = isLogin ? "Рады снова вас видеть." : "Пара полей — и вы внутри.";
  elements.submitLabel.textContent = isLogin ? "Войти" : "Зарегистрироваться";
  elements.passwordHint.textContent = isLogin ? "ваш пароль" : "минимум 6 символов";
  elements.password.autocomplete = isLogin ? "current-password" : "new-password";
  setFormError();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function setConnection(state, label) {
  const isOnline = state === "online";
  const isWaiting = state === "waiting";
  elements.roomStatusLight.classList.toggle("is-online", isOnline);
  elements.roomStatusLight.classList.toggle("is-waiting", isWaiting);
  const pillLight = elements.connectionPill.querySelector(".status-light");
  pillLight.classList.toggle("is-online", isOnline);
  pillLight.classList.toggle("is-waiting", isWaiting);
  elements.roomStatusText.textContent = label;
  elements.connectionLabel.textContent = label;
  elements.messageInput.disabled = !isOnline;
  elements.sendButton.disabled = !isOnline || !elements.messageInput.value.trim();
  elements.composerHint.textContent = isOnline
    ? "Сообщение увидят все участники"
    : isWaiting ? "Восстанавливаем соединение…" : "Подключитесь, чтобы написать";
}

function setMessageEnabled(enabled) {
  elements.messageInput.disabled = !enabled;
  elements.sendButton.disabled = !enabled || !elements.messageInput.value.trim();
  elements.composerHint.textContent = enabled
    ? "Сообщение увидят все участники"
    : "Подключитесь, чтобы написать";
}

function showChat(name) {
  username = name || username || usernameFromToken(accessToken);
  elements.profileName.textContent = username;
  elements.profileAvatar.textContent = username.trim().charAt(0) || "?";
  elements.authScreen.classList.add("is-hidden");
  elements.chatScreen.classList.remove("is-hidden");
  connectSocket();
}

function showAuth() {
  elements.chatScreen.classList.add("is-hidden");
  elements.authScreen.classList.remove("is-hidden");
  setConnection("offline", "Не подключено");
}

async function apiRequest(path, options = {}) {
  const { token, ...fetchOptions } = options;
  const response = await fetch(`${CONFIG.apiBase}${path}`, {
    ...fetchOptions,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  let data = null;
  const responseText = await response.text();
  if (responseText) {
    try { data = JSON.parse(responseText); } catch { data = { detail: responseText }; }
  }
  if (!response.ok) {
    const message = data?.detail || data?.message || (typeof data === "string" ? data : "");
    const fieldError = Object.values(data || {}).find((value) => Array.isArray(value) && value.length)?.[0];
    throw new Error(message || fieldError || `Ошибка запроса (${response.status})`);
  }
  return data || {};
}

function getHumanError(error, fallback) {
  if (!error?.message) return fallback;
  const message = String(error.message);
  if (message === "Failed to fetch" || message.includes("NetworkError")) {
    return "Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.";
  }
  return message;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setFormError();
  const submittedUsername = elements.username.value.trim();
  const password = elements.password.value;
  if (!submittedUsername || !password) {
    setFormError("Введите имя пользователя и пароль.");
    return;
  }
  if (authMode === "register" && password.length < 6) {
    setFormError("Пароль должен содержать не меньше 6 символов.");
    return;
  }

  elements.submitButton.disabled = true;
  elements.submitLabel.textContent = authMode === "login" ? "Входим…" : "Создаём аккаунт…";
  try {
    const path = authMode === "login" ? "/login/" : "/register/";
    const data = await apiRequest(path, {
      method: "POST",
      body: JSON.stringify({ username: submittedUsername, password }),
    });
    if (!data.access) throw new Error("Сервер не вернул access-токен.");
    accessToken = data.access;
    username = data.user?.username || usernameFromToken(accessToken, submittedUsername);
    sessionStorage.setItem(STORAGE_TOKEN, accessToken);
    sessionStorage.setItem(STORAGE_USERNAME, username);
    elements.password.value = "";
    reconnectAttempt = 0;
    intentionalClose = false;
    showChat(username);
  } catch (error) {
    setFormError(getHumanError(error, "Не получилось выполнить запрос. Попробуйте ещё раз."));
  } finally {
    elements.submitButton.disabled = false;
    elements.submitLabel.textContent = authMode === "login" ? "Войти" : "Зарегистрироваться";
  }
}

async function refreshAccessToken() {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = apiRequest("/token/refresh/", { method: "POST" })
    .then((data) => {
      if (!data.access) throw new Error("Сессия истекла. Войдите снова.");
      accessToken = data.access;
      username = usernameFromToken(accessToken, username);
      sessionStorage.setItem(STORAGE_TOKEN, accessToken);
      sessionStorage.setItem(STORAGE_USERNAME, username);
      return accessToken;
    })
    .catch(() => {
      throw new Error("Сессия истекла. Войдите снова.");
    })
    .finally(() => { refreshInProgress = null; });
  return refreshInProgress;
}

async function ensureFreshToken() {
  if (refreshBeforeNextConnect || tokenNeedsRefresh(accessToken)) {
    refreshBeforeNextConnect = false;
    return refreshAccessToken();
  }
  return accessToken;
}

function connectSocket() {
  if (!accessToken || intentionalClose || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  clearTimeout(reconnectTimer);
  setConnection("waiting", reconnectAttempt ? "Переподключаемся…" : "Подключаемся…");
  const attempt = ++reconnectAttempt;

  ensureFreshToken().then((token) => {
    if (intentionalClose || !token) return;
    const currentSocket = new WebSocket(CONFIG.websocketUrl);
    socket = currentSocket;

    currentSocket.addEventListener("open", () => {
      if (socket !== currentSocket) return;
      currentSocket.send(JSON.stringify({ type: "AUTH", payload: { token } }));
      clearTimeout(authTimeout);
      authTimeout = setTimeout(() => {
        if (socket === currentSocket && currentSocket.readyState === WebSocket.OPEN) {
          currentSocket.close(4001, "AUTH response timeout");
        }
      }, 8000);
    });

    currentSocket.addEventListener("message", (event) => {
      if (socket !== currentSocket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === "AUTH_SUCCESS") {
        clearTimeout(authTimeout);
        if (message.payload?.username) {
          username = String(message.payload.username);
          elements.profileName.textContent = username;
          elements.profileAvatar.textContent = username.trim().charAt(0) || "?";
          sessionStorage.setItem(STORAGE_USERNAME, username);
        }
        reconnectAttempt = 0;
        setConnection("online", "В сети");
        return;
      }
      if (message?.type === "NEW_MESSAGE") {
        appendMessage(message.payload || {});
      }
    });

    currentSocket.addEventListener("error", () => {
      if (socket === currentSocket) setConnection("waiting", "Связь прервана");
    });

    currentSocket.addEventListener("close", () => {
      clearTimeout(authTimeout);
      if (socket === currentSocket) socket = null;
      if (intentionalClose || !accessToken) return;
      const authenticated = elements.roomStatusText.textContent === "В сети";
      if (!authenticated && attempt === 1 && !refreshBeforeNextConnect) refreshBeforeNextConnect = true;
      scheduleReconnect();
    });
  }).catch((error) => {
    if (intentionalClose) return;
    if (error.message.includes("Сессия истекла") || error.message.includes("401")) {
      clearSession();
      showAuth();
      setFormError("Сессия истекла. Войдите снова.");
      showToast("Сессия завершена — войдите снова.");
      return;
    }
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (intentionalClose || !accessToken || reconnectTimer) return;
  setConnection("waiting", "Переподключаемся…");
  const delay = Math.min(1000 * (2 ** Math.min(reconnectAttempt, 4)), 16_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, delay);
}

function formatTime(value) {
  const timestamp = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function appendMessage(payload) {
  const sender = String(payload.sender || "участник");
  const text = String(payload.text || "");
  if (!text) return;
  elements.emptyState?.remove();
  elements.emptyState = null;

  const row = document.createElement("article");
  row.className = `message-row${sender === username ? " is-own" : ""}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = sender.trim().charAt(0) || "?";
  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const senderLabel = document.createElement("span");
  senderLabel.className = "message-sender";
  senderLabel.textContent = sender;
  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatTime(payload.timestamp);
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;
  meta.append(senderLabel, time);
  content.append(meta, bubble);
  row.append(avatar, content);
  elements.messages.append(row);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function clearSession() {
  accessToken = "";
  username = "";
  sessionStorage.removeItem(STORAGE_TOKEN);
  sessionStorage.removeItem(STORAGE_USERNAME);
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

async function logout() {
  const tokenForLogout = accessToken;
  intentionalClose = true;
  clearSession();
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Logout");
  socket = null;
  setMessageEnabled(false);
  try {
    await apiRequest("/logout/", { method: "POST", token: tokenForLogout });
  } catch {
    // The local session is cleared even if the API is unreachable.
  }
  showAuth();
  elements.username.value = "";
  elements.password.value = "";
  setAuthMode("login");
  showToast("Вы вышли из комнаты.");
}

elements.loginTab.addEventListener("click", () => setAuthMode("login"));
elements.registerTab.addEventListener("click", () => setAuthMode("register"));
elements.authForm.addEventListener("submit", handleAuthSubmit);
elements.passwordToggle.addEventListener("click", () => {
  const show = elements.password.type === "password";
  elements.password.type = show ? "text" : "password";
  elements.passwordToggle.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
  elements.passwordToggle.title = show ? "Скрыть пароль" : "Показать пароль";
});
elements.logoutButton.addEventListener("click", logout);
elements.messageInput.addEventListener("input", () => {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 110)}px`;
  elements.sendButton.disabled = elements.messageInput.disabled || !elements.messageInput.value.trim();
});
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.messageForm.requestSubmit();
  }
});
elements.messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN || elements.messageInput.disabled) return;
  socket.send(JSON.stringify({ type: "CHAT_MESSAGE", payload: { text } }));
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  elements.sendButton.disabled = true;
});

window.addEventListener("online", () => {
  if (accessToken && !intentionalClose) connectSocket();
});
window.addEventListener("offline", () => {
  if (accessToken) setConnection("waiting", "Нет интернета");
});
window.addEventListener("pagehide", () => {
  clearTimeout(reconnectTimer);
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Page closed");
});

setConnection("offline", "Не подключено");
if (accessToken) {
  if (!username) username = usernameFromToken(accessToken);
  showChat(username);
} else {
  showAuth();
}
