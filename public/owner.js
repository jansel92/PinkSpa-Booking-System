async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

let editingServiceId = null;
let allClients = [];
let allAppointments = [];
let allNotifications = [];
let notificationUnreadCount = 0;
let notificationRefreshTimer = null;
let notificationPanelCloseTimer = null;
let dashboardBusinessName = "PinkSpa";
const reduceOwnerMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const animatedCounterValues = new WeakMap();

function prefersReducedOwnerMotion() {
  return reduceOwnerMotion.matches;
}

function initializeDashboardEntrance() {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard || dashboard.dataset.entranceReady) return;

  dashboard.dataset.entranceReady = "true";

  document.querySelectorAll(".stats > div").forEach((card, index) => {
    card.style.setProperty("--entrance-delay", `${90 + index * 45}ms`);
  });

  window.requestAnimationFrame(() => dashboard.classList.add("dashboard-entrance-ready"));
}

function animateCounter(element, finalValue, duration = 850) {
  if (!element) return;

  const numericValue = Number(finalValue) || 0;
  if (prefersReducedOwnerMotion()) {
    element.textContent = String(numericValue);
    animatedCounterValues.set(element, numericValue);
    return;
  }

  const startValue = animatedCounterValues.has(element)
    ? Number(animatedCounterValues.get(element)) || 0
    : 0;

  if (startValue === numericValue) {
    element.textContent = String(numericValue);
    return;
  }

  const startedAt = performance.now();
  const easeOut = progress => 1 - Math.pow(1 - progress, 3);

  function frame(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    const current = Math.round(startValue + (numericValue - startValue) * easeOut(progress));
    element.textContent = String(current);

    if (progress < 1) {
      window.requestAnimationFrame(frame);
      return;
    }

    animatedCounterValues.set(element, numericValue);
  }

  window.requestAnimationFrame(frame);
}

function setCounterValue(id, value) {
  animateCounter(document.getElementById(id), value);
}

function createEmptyState(title, detail = "") {
  const empty = document.createElement("div");
  empty.className = "owner-empty-state";
  const heading = document.createElement("strong");
  heading.textContent = title;
  empty.appendChild(heading);

  if (detail) {
    const text = document.createElement("span");
    text.textContent = detail;
    empty.appendChild(text);
  }

  return empty;
}

function dashboardGreetingPeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function ownerDisplayName() {
  const cleanName = String(dashboardBusinessName || "").trim();
  return cleanName || "PinkSpa";
}

function updateDashboardGreeting() {
  const greeting = document.getElementById("dashboardGreeting");
  const dateText = document.getElementById("dashboardDate");
  const summary = document.getElementById("dashboardSummary");
  if (!greeting || !dateText || !summary) return;

  const now = new Date();
  const todayKey = localDateKey(now);
  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  });
  const todaysAppointments = allAppointments.filter(appointment => {
    return appointment.appointment_date === todayKey &&
      !["cancelled", "no-show"].includes(appointment.status);
  });
  const expectedRevenue = todaysAppointments.reduce((total, appointment) => {
    return total + parseServicePrice(appointment.service_price);
  }, 0);

  greeting.textContent = `${dashboardGreetingPeriod(now)}, ${ownerDisplayName()} 👋`;
  dateText.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(now);
  summary.textContent = `${todaysAppointments.length} appointment${todaysAppointments.length === 1 ? "" : "s"} today • ${currency.format(expectedRevenue)} expected revenue • ${notificationUnreadCount} unread notification${notificationUnreadCount === 1 ? "" : "s"}`;
}

function setLoadingState(container, message = "Loading...") {
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  const loading = document.createElement("div");
  loading.className = "owner-loading";
  const spinner = document.createElement("span");
  spinner.className = "owner-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = message;
  loading.append(spinner, text);
  container.replaceChildren(loading);
}

function finishLoading(container) {
  if (container) container.removeAttribute("aria-busy");
}

function setLoadError(container, message) {
  if (!container) return;
  finishLoading(container);
  container.replaceChildren(createEmptyState("Unable to load", message));
}

function setFormLoading(form, loading) {
  if (!form) return;
  form.toggleAttribute("aria-busy", loading);
  form.querySelectorAll("input, select, textarea, button").forEach(control => {
    control.disabled = loading;
  });
}

function setButtonBusy(button, busy, busyText = "Working...") {
  if (!(button instanceof HTMLButtonElement)) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }

  button.textContent = button.dataset.originalText || button.textContent;
  delete button.dataset.originalText;
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

function showToast(message, type = "success") {
  const region = document.getElementById("ownerToastRegion");
  if (!region) return;

  while (region.children.length >= 4) {
    region.firstElementChild.remove();
  }

  const toast = document.createElement("div");
  toast.className = `owner-toast owner-toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  const duration = type === "error" ? 6500 : 4200;
  toast.style.setProperty("--toast-duration", `${duration}ms`);

  const icon = document.createElement("span");
  icon.className = "owner-toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = type === "error" ? "!" : "OK";

  const content = document.createElement("div");
  content.className = "owner-toast-content";
  const title = document.createElement("strong");
  title.textContent = type === "error" ? "Action unsuccessful" : "Success";
  const text = document.createElement("span");
  text.textContent = message;
  content.append(title, text);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "owner-toast-close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";

  const progress = document.createElement("span");
  progress.className = "owner-toast-progress";
  progress.setAttribute("aria-hidden", "true");
  toast.append(icon, content, close, progress);
  region.appendChild(toast);

  let remaining = duration;
  let startedAt = Date.now();
  let dismissTimer;

  const dismiss = () => {
    if (!toast.isConnected || toast.classList.contains("owner-toast-leaving")) return;
    window.clearTimeout(dismissTimer);
    toast.classList.add("owner-toast-leaving");
    window.setTimeout(() => toast.remove(), 220);
  };
  const scheduleDismissal = () => {
    startedAt = Date.now();
    dismissTimer = window.setTimeout(dismiss, remaining);
  };

  close.addEventListener("click", dismiss);
  toast.addEventListener("mouseenter", () => {
    window.clearTimeout(dismissTimer);
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    toast.classList.add("owner-toast-paused");
  });
  toast.addEventListener("mouseleave", () => {
    toast.classList.remove("owner-toast-paused");
    scheduleDismissal();
  });
  scheduleDismissal();
}

async function performAction({ button, busyText, successMessage, action }) {
  setButtonBusy(button, true, busyText);
  try {
    await action();
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    console.error(error);
    showToast(error.message || "Something went wrong. Please try again.", "error");
    return false;
  } finally {
    setButtonBusy(button, false);
  }
}

function parseNotificationDate(value) {
  const clean = String(value || "").trim();
  if (!clean) return null;

  const normalized = clean.includes("T") ? clean : clean.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(value) {
  const date = parseNotificationDate(value);
  if (!date) return "";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const absSeconds = Math.abs(seconds);
  if (absSeconds < 45) return "Just now";

  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const [unit, unitSeconds] = units.find(([, amount]) => absSeconds >= amount) || ["minute", 60];

  return formatter.format(Math.round(-seconds / unitSeconds), unit);
}

function renderNotifications(notifications = allNotifications) {
  const list = document.getElementById("notificationsList");
  const unreadBadge = document.getElementById("notificationUnreadCount");
  const markAllButton = document.getElementById("markAllNotificationsRead");
  if (!list || !unreadBadge || !markAllButton) return;

  const unreadCount = notificationUnreadCount;
  unreadBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  unreadBadge.classList.toggle("hidden", unreadCount === 0);
  markAllButton.disabled = unreadCount === 0;
  list.replaceChildren();

  if (!notifications.length) {
    list.appendChild(createEmptyState("You're all caught up."));
    return;
  }

  notifications.forEach(notification => {
    const item = document.createElement("article");
    item.className = `notification-item notification-${notification.priority || "info"}`;
    item.classList.toggle("notification-unread", !notification.is_read);

    const icon = document.createElement("span");
    icon.className = "notification-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = notification.icon || "i";

    const content = document.createElement("div");
    content.className = "notification-content";

    const titleRow = document.createElement("div");
    titleRow.className = "notification-title-row";
    const title = document.createElement("strong");
    title.textContent = notification.title;
    const time = document.createElement("time");
    time.dateTime = notification.created_at || "";
    time.textContent = relativeTime(notification.created_at);
    titleRow.append(title, time);

    const description = document.createElement("p");
    description.textContent = notification.description;

    content.append(titleRow, description);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "notification-read-button";
    action.textContent = notification.is_read ? "Read" : "Mark as Read";
    action.disabled = Boolean(notification.is_read);
    action.addEventListener("click", () => markNotificationRead(notification.id, action));

    item.append(icon, content, action);
    list.appendChild(item);
  });
}

function setNotificationPanelOpen(open) {
  const panel = document.getElementById("notificationPanel");
  const bell = document.getElementById("notificationBell");
  if (!panel || !bell) return;

  window.clearTimeout(notificationPanelCloseTimer);
  bell.setAttribute("aria-expanded", String(open));

  if (open) {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-open"));
    return;
  }

  panel.classList.remove("is-open");
  notificationPanelCloseTimer = window.setTimeout(() => {
    if (!panel.classList.contains("is-open")) panel.hidden = true;
  }, 180);
}

function isNotificationPanelOpen() {
  return document.getElementById("notificationPanel")?.classList.contains("is-open") || false;
}

async function loadNotifications() {
  const list = document.getElementById("notificationsList");
  if (!list) return;

  setLoadingState(list, "Loading notifications...");
  try {
    const data = await api("/api/notifications");
    allNotifications = Array.isArray(data.notifications) ? data.notifications : [];
    notificationUnreadCount = Number(data.unread_count || 0);
    renderNotifications();
    updateDashboardGreeting();
    finishLoading(list);
  } catch (error) {
    console.error("Unable to load notifications:", error);
    setLoadError(list, "Notifications could not be loaded. Please try again.");
  }
}

async function markNotificationRead(id, button) {
  await performAction({
    button,
    busyText: "Saving...",
    action: async () => {
      await api(`/api/notifications/${id}/read`, { method: "PUT" });
      allNotifications = allNotifications.map(notification => {
        return notification.id === id ? { ...notification, is_read: 1 } : notification;
      });
      notificationUnreadCount = Math.max(0, notificationUnreadCount - 1);
      renderNotifications();
      updateDashboardGreeting();
    }
  });
}

const markAllNotificationsReadButton = document.getElementById("markAllNotificationsRead");
if (markAllNotificationsReadButton) {
  markAllNotificationsReadButton.addEventListener("click", async event => {
    await performAction({
      button: event.currentTarget,
      busyText: "Saving...",
      successMessage: "All notifications marked as read.",
      action: async () => {
        await api("/api/notifications/read-all", { method: "PUT" });
        allNotifications = allNotifications.map(notification => ({ ...notification, is_read: 1 }));
        notificationUnreadCount = 0;
        renderNotifications();
        updateDashboardGreeting();
      }
    });
  });
}

const notificationBell = document.getElementById("notificationBell");
if (notificationBell) {
  notificationBell.addEventListener("click", event => {
    event.stopPropagation();
    setNotificationPanelOpen(!isNotificationPanelOpen());
  });
}

const notificationPanel = document.getElementById("notificationPanel");
if (notificationPanel) {
  notificationPanel.addEventListener("click", event => event.stopPropagation());
}

document.addEventListener("click", () => {
  if (isNotificationPanelOpen()) setNotificationPanelOpen(false);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && isNotificationPanelOpen()) {
    setNotificationPanelOpen(false);
    notificationBell?.focus();
  }
});

function serviceImage(service) {
  if (service.image) return service.image;

  const category = (service.category || "").toLowerCase();
  const name = (service.name || "").toLowerCase();
  const text = category + " " + name;

  if (text.includes("pedi") || text.includes("toe") || text.includes("foot")) {
    return "/images/pedicure/pedi1.png";
  }

  if (text.includes("lash") || text.includes("eyelash")) {
    return "/images/lashes/lashes1.jpeg";
  }

  if (
    text.includes("brow") ||
    text.includes("eyebrow") ||
    text.includes("wax") ||
    text.includes("henna") ||
    text.includes("lamination")
  ) {
    return "/images/brows/brows1.jpeg";
  }

  return "/images/nails/nails1.jpeg";
}

function ensureImagePreviewBox() {
  const form = document.getElementById("serviceForm");
  let previewBox = document.getElementById("serviceImagePreviewBox");

  if (!previewBox) {
    previewBox = document.createElement("div");
    previewBox.id = "serviceImagePreviewBox";
    previewBox.style.margin = "12px 0 16px";
    previewBox.style.display = "none";

    previewBox.innerHTML = `
      <strong style="display:block;margin-bottom:8px;">Current Image Preview</strong>
      <img
        id="serviceImagePreview"
        src=""
        alt="Service Image Preview"
        style="width:120px;height:120px;object-fit:cover;border-radius:18px;border:1px solid #ffd3e4;box-shadow:0 12px 30px rgba(199,23,99,.14);"
      />
    `;

    const imageFileLabel = form.elements.image_file?.closest("label");
    if (imageFileLabel) {
      imageFileLabel.insertAdjacentElement("afterend", previewBox);
    } else {
      form.appendChild(previewBox);
    }
  }

  return previewBox;
}

function showImagePreview(src) {
  const previewBox = ensureImagePreviewBox();
  const previewImg = document.getElementById("serviceImagePreview");

  if (!src) {
    previewBox.style.display = "none";
    previewImg.src = "";
    return;
  }

  previewImg.src = src;
  previewBox.style.display = "block";
}

function setupImageFilePreview() {
  const form = document.getElementById("serviceForm");
  const imageInput = form.elements.image_file;

  if (!imageInput) return;

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];

    if (!file) {
      const currentUrl = form.elements.image.value || "";
      showImagePreview(currentUrl);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    showImagePreview(previewUrl);
  });
}

async function checkLogin() {
  try {
    const data = await api("/api/me");
    if (data.owner) showDashboard();
  } catch (error) {
    console.error(error);
    showToast("The owner session could not be checked. Please sign in again.", "error");
  }
}

function showDashboard() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  setupImageFilePreview();
  updateDashboardGreeting();
  initializeDashboardEntrance();
  loadAll();

  if (!notificationRefreshTimer) {
    notificationRefreshTimer = window.setInterval(loadNotifications, 5 * 60 * 1000);
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const msg = document.getElementById("loginMessage");
  const button = e.submitter;

  setButtonBusy(button, true, "Signing in...");
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showDashboard();
    showToast("Welcome back. Your dashboard is loading.");
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    setButtonBusy(button, false);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async (event) => {
  const success = await performAction({
    button: event.currentTarget,
    busyText: "Logging out...",
    action: () => api("/api/logout", { method: "POST" })
  });
  if (success) location.reload();
});

const dashboardTabs = Array.from(document.querySelectorAll(".tab"));

function activateDashboardTab(button, moveFocus = false) {
  dashboardTabs.forEach(tab => {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll(".tab-content").forEach(section => {
    section.classList.add("hidden");
  });

  const panel = document.getElementById(button.dataset.tab + "Tab");
  if (panel) panel.classList.remove("hidden");
  if (moveFocus) button.focus();
}

dashboardTabs.forEach((btn, index) => {
  btn.id = `${btn.dataset.tab}TabButton`;
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-controls", btn.dataset.tab + "Tab");
  btn.setAttribute("aria-selected", String(btn.classList.contains("active")));
  btn.tabIndex = btn.classList.contains("active") ? 0 : -1;
  btn.addEventListener("click", () => activateDashboardTab(btn));
  btn.addEventListener("keydown", event => {
    let nextIndex = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % dashboardTabs.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + dashboardTabs.length) % dashboardTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = dashboardTabs.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      activateDashboardTab(dashboardTabs[nextIndex], true);
    }
  });
});

document.querySelectorAll(".tab-content").forEach(panel => {
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `${panel.id.replace(/Tab$/, "")}TabButton`);
});

async function loadAll() {
  loadNotifications();

  const results = await Promise.allSettled([
    loadAppointments(),
    loadServices(),
    loadClients(),
    loadSettings(),
    loadBlockedDays(),
    loadReviews()
  ]);

  if (results.some(result => result.status === "rejected")) {
    showToast("Some dashboard information could not be loaded. Please refresh and try again.", "error");
  }
}

function statusLabel(status) {
  const labels = {
    pending: "🟡 Pending Review",
    confirmed: "🟢 Confirmed",
    cancelled: "🔴 Cancelled",
    completed: "🔵 Completed",
    "no-show": "⚫ No-show"
  };

  return labels[status] || status;
}

function parseServicePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : 0;
}

function whatsappPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return digits;
}

function appointmentMessageDetails(appointment) {
  return {
    clientName: appointment.client_name || "there",
    service: appointment.service_name || "your service",
    date: appointment.appointment_date || "your appointment date",
    time: appointment.appointment_time || "your appointment time",
    businessName: "PinkSpa"
  };
}

function whatsappTemplateMessage(type, appointment) {
  const { clientName, service, date, time, businessName } = appointmentMessageDetails(appointment);
  const templates = {
    received: `Hi ${clientName}! This is ${businessName}. We received your booking request for ${service} on ${date} at ${time}. We will confirm your appointment shortly. Thank you!`,
    confirmed: `Hi ${clientName}! This is ${businessName}. Your ${service} appointment is confirmed for ${date} at ${time}. We look forward to seeing you!`,
    reminder: `Hi ${clientName}! This is a friendly reminder from ${businessName} for your ${service} appointment on ${date} at ${time}. Please reply if you have any questions.`,
    thankYou: `Hi ${clientName}! Thank you for visiting ${businessName} for your ${service} appointment on ${date}. We loved having you and hope to see you again soon!`,
    review: `Hi ${clientName}! Thank you for choosing ${businessName} for ${service}. We would love your feedback when you have a moment: https://rachelpinkspa.com/review`,
    cancellation: `Hi ${clientName}. This is ${businessName}. Your ${service} appointment on ${date} at ${time} has been cancelled. Please contact us if you would like to reschedule.`
  };

  return templates[type] || templates.received;
}

function whatsappUrl(type, appointment) {
  const phone = whatsappPhoneNumber(appointment.client_phone);
  if (!phone) return "";

  return `https://wa.me/${phone}?text=${encodeURIComponent(whatsappTemplateMessage(type, appointment))}`;
}

function createWhatsAppButton(label, type, appointment) {
  const phone = whatsappPhoneNumber(appointment.client_phone);
  const link = document.createElement("a");
  link.className = "whatsapp-action";
  link.textContent = label;

  if (!phone) {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
    link.addEventListener("click", event => {
      event.preventDefault();
      showToast("This appointment does not have a valid phone number for WhatsApp.", "error");
    });
    return link;
  }

  link.href = whatsappUrl(type, appointment);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Send WhatsApp ${label} message to ${appointment.client_name || "client"}`);
  return link;
}

async function copyAppointmentPhone(phone, button) {
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone) {
    showToast("This appointment does not have a phone number to copy.", "error");
    return;
  }

  await performAction({
    button,
    busyText: "Copying...",
    successMessage: "Client phone number copied.",
    action: () => navigator.clipboard.writeText(cleanPhone)
  });
}

function createAppointmentQuickActions(appointment) {
  const wrap = document.createElement("div");
  wrap.className = "appointment-quick-actions";

  const title = document.createElement("div");
  title.className = "appointment-quick-actions-title";
  title.textContent = "Client Quick Actions";

  const whatsappActions = document.createElement("div");
  whatsappActions.className = "whatsapp-actions";
  [
    ["Booking received", "received"],
    ["Confirmed", "confirmed"],
    ["Reminder", "reminder"],
    ["Thank you", "thankYou"],
    ["Review request", "review"],
    ["Cancellation", "cancellation"]
  ].forEach(([label, type]) => {
    whatsappActions.appendChild(createWhatsAppButton(label, type, appointment));
  });

  const directActions = document.createElement("div");
  directActions.className = "client-direct-actions";

  const callLink = document.createElement("a");
  callLink.className = "client-direct-action";
  callLink.textContent = "Call Client";
  const callablePhone = String(appointment.client_phone || "").replace(/[^\d+]/g, "");
  if (callablePhone) {
    callLink.href = `tel:${callablePhone}`;
  } else {
    callLink.href = "#";
    callLink.setAttribute("aria-disabled", "true");
    callLink.addEventListener("click", event => {
      event.preventDefault();
      showToast("This appointment does not have a valid phone number to call.", "error");
    });
  }

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "client-direct-action";
  copyButton.textContent = "Copy Phone";
  copyButton.addEventListener("click", () => copyAppointmentPhone(appointment.client_phone, copyButton));

  directActions.append(callLink, copyButton);
  wrap.append(title, whatsappActions, directActions);

  return wrap;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createFinancialEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "financial-empty";
  empty.textContent = message;
  return empty;
}

function renderRevenueDashboard(appointments, clients = allClients) {
  const completedAppointments = appointments.filter(appt => appt.status === "completed");
  const pendingAppointments = appointments.filter(appt => {
    return appt.status === "pending" || appt.status === "confirmed";
  });
  const today = new Date();
  const todayKey = localDateKey(today);
  const monthKey = todayKey.slice(0, 7);
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  const weekStartKey = localDateKey(weekStart);

  const appointmentValue = appt => parseServicePrice(appt.service_price);
  const revenueTotal = completedAppointments.reduce((sum, appt) => {
    return sum + appointmentValue(appt);
  }, 0);
  const revenueToday = completedAppointments
    .filter(appt => appt.appointment_date === todayKey)
    .reduce((sum, appt) => sum + appointmentValue(appt), 0);
  const revenueWeek = completedAppointments
    .filter(appt => appt.appointment_date >= weekStartKey && appt.appointment_date <= todayKey)
    .reduce((sum, appt) => sum + appointmentValue(appt), 0);
  const revenueMonth = completedAppointments
    .filter(appt => appt.appointment_date.startsWith(monthKey) && appt.appointment_date <= todayKey)
    .reduce((sum, appt) => sum + appointmentValue(appt), 0);
  const revenueAverage = completedAppointments.length
    ? revenueTotal / completedAppointments.length
    : 0;
  const pendingRevenue = pendingAppointments.reduce((sum, appt) => {
    return sum + appointmentValue(appt);
  }, 0);

  const serviceMetrics = completedAppointments.reduce((metrics, appt) => {
    const serviceName = appt.service_name || "Unknown Service";
    const current = metrics.get(serviceName) || { count: 0, revenue: 0 };
    current.count += 1;
    current.revenue += appointmentValue(appt);
    metrics.set(serviceName, current);
    return metrics;
  }, new Map());
  const rankedServices = Array.from(serviceMetrics.entries())
    .sort((left, right) => right[1].count - left[1].count || right[1].revenue - left[1].revenue || left[0].localeCompare(right[0]));
  const mostPopularService = rankedServices[0]?.[0] || "-";

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  });
  const values = {
    revenueToday: currency.format(revenueToday),
    revenueWeek: currency.format(revenueWeek),
    revenueMonth: currency.format(revenueMonth),
    revenueTotal: currency.format(revenueTotal),
    revenueCompleted: String(completedAppointments.length),
    revenueAverage: currency.format(revenueAverage),
    revenuePending: currency.format(pendingRevenue),
    revenuePopular: mostPopularService
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const topClientsList = document.getElementById("topClientsList");
  if (topClientsList) {
    topClientsList.replaceChildren();
    const topClients = clients
      .filter(client => Number(client.total_spent) > 0)
      .slice()
      .sort((left, right) => Number(right.total_spent) - Number(left.total_spent) || String(left.name || "").localeCompare(String(right.name || "")))
      .slice(0, 5);

    if (!topClients.length) {
      topClientsList.appendChild(createFinancialEmpty("No completed client spending yet."));
    } else {
      topClients.forEach((client, index) => {
        const item = document.createElement("div");
        item.className = "financial-ranked-item";
        const rank = document.createElement("span");
        rank.className = "financial-rank";
        rank.textContent = String(index + 1);
        const identity = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = client.name || "PinkSpa Client";
        const detail = document.createElement("span");
        detail.textContent = `${client.total_appointments || 0} total appointment${client.total_appointments === 1 ? "" : "s"}`;
        identity.append(name, detail);
        const amount = document.createElement("b");
        amount.textContent = currency.format(Number(client.total_spent) || 0);
        item.append(rank, identity, amount);
        topClientsList.appendChild(item);
      });
    }
  }

  const topServicesList = document.getElementById("topServicesList");
  if (topServicesList) {
    topServicesList.replaceChildren();
    const topServices = rankedServices.slice(0, 5);

    if (!topServices.length) {
      topServicesList.appendChild(createFinancialEmpty("No completed service data yet."));
    } else {
      topServices.forEach(([serviceName, metrics], index) => {
        const item = document.createElement("div");
        item.className = "financial-ranked-item";
        const rank = document.createElement("span");
        rank.className = "financial-rank";
        rank.textContent = String(index + 1);
        const service = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = serviceName;
        const detail = document.createElement("span");
        detail.textContent = `${metrics.count} completed appointment${metrics.count === 1 ? "" : "s"}`;
        service.append(name, detail);
        const amount = document.createElement("b");
        amount.textContent = currency.format(metrics.revenue);
        item.append(rank, service, amount);
        topServicesList.appendChild(item);
      });
    }
  }

  const revenueTrend = document.getElementById("revenueTrend");
  if (revenueTrend) {
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      const dateKey = localDateKey(date);
      const revenue = completedAppointments
        .filter(appt => appt.appointment_date === dateKey)
        .reduce((sum, appt) => sum + appointmentValue(appt), 0);
      return { date, dateKey, revenue };
    });
    const maximumRevenue = Math.max(...weekDays.map(day => day.revenue), 0);
    revenueTrend.replaceChildren();

    weekDays.forEach(day => {
      const column = document.createElement("div");
      column.className = "trend-day";
      if (day.dateKey === todayKey) column.classList.add("trend-day-today");
      const amount = document.createElement("span");
      amount.className = "trend-amount";
      amount.textContent = currency.format(day.revenue);
      const track = document.createElement("div");
      track.className = "trend-track";
      const bar = document.createElement("div");
      bar.className = "trend-bar";
      bar.style.height = maximumRevenue ? `${(day.revenue / maximumRevenue) * 100}%` : "0";
      track.appendChild(bar);
      const label = document.createElement("strong");
      label.textContent = day.date.toLocaleDateString("en-US", { weekday: "short" });
      const dateLabel = document.createElement("small");
      dateLabel.textContent = day.date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
      column.append(amount, track, label, dateLabel);
      revenueTrend.appendChild(column);
    });
  }

  const statusBreakdown = document.getElementById("statusBreakdown");
  if (statusBreakdown) {
    const statuses = ["pending", "confirmed", "completed", "cancelled", "no-show"];
    statusBreakdown.replaceChildren();

    statuses.forEach(status => {
      const count = appointments.filter(appt => appt.status === status).length;
      const percentage = appointments.length ? (count / appointments.length) * 100 : 0;
      const row = document.createElement("div");
      row.className = "status-breakdown-row";
      const heading = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = calendarStatusName(status);
      const value = document.createElement("strong");
      value.textContent = `${count} (${Math.round(percentage)}%)`;
      heading.append(label, value);
      const track = document.createElement("div");
      track.className = "financial-status-track";
      const bar = document.createElement("div");
      bar.className = `financial-status-bar calendar-status-${status}`;
      bar.style.width = `${percentage}%`;
      track.appendChild(bar);
      row.append(heading, track);
      statusBreakdown.appendChild(row);
    });
  }

  const recentCompletedList = document.getElementById("recentCompletedList");
  if (recentCompletedList) {
    recentCompletedList.replaceChildren();
    const recentCompleted = completedAppointments
      .slice()
      .sort((left, right) => {
        return String(right.appointment_date || "").localeCompare(String(left.appointment_date || "")) ||
          appointmentTimeMinutes(right.appointment_time) - appointmentTimeMinutes(left.appointment_time) ||
          Number(right.id || 0) - Number(left.id || 0);
      })
      .slice(0, 5);

    if (!recentCompleted.length) {
      recentCompletedList.appendChild(createFinancialEmpty("No completed appointments yet."));
    } else {
      recentCompleted.forEach(appt => {
        const item = document.createElement("div");
        item.className = "recent-completed-item";
        const date = document.createElement("div");
        date.className = "recent-completed-date";
        const dateText = document.createElement("strong");
        dateText.textContent = formatClientDate(appt.appointment_date);
        const time = document.createElement("span");
        time.textContent = appt.appointment_time || "Time unavailable";
        date.append(dateText, time);
        const details = document.createElement("div");
        const client = document.createElement("strong");
        client.textContent = appt.client_name || "PinkSpa Client";
        const service = document.createElement("span");
        service.textContent = appt.service_name || "Unknown Service";
        details.append(client, service);
        const amount = document.createElement("b");
        amount.textContent = currency.format(appointmentValue(appt));
        item.append(date, details, amount);
        recentCompletedList.appendChild(item);
      });
    }
  }
}

function formatClientDate(dateValue) {
  if (!dateValue) return "No completed visits";

  const date = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateValue
    : date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
}

function createClientMetric(label, value) {
  const metric = document.createElement("div");
  metric.className = "client-metric";

  const metricLabel = document.createElement("span");
  metricLabel.textContent = label;

  const metricValue = document.createElement("strong");
  metricValue.textContent = value;

  metric.append(metricLabel, metricValue);
  return metric;
}

function clientAppointmentDateTime(appointment) {
  const date = new Date(`${appointment.appointment_date}T00:00:00`);
  const timeMatch = String(appointment.appointment_time || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (Number.isNaN(date.getTime()) || !timeMatch) return null;

  let hours = Number(timeMatch[1]) % 12;
  if (timeMatch[3].toUpperCase() === "PM") hours += 12;
  date.setHours(hours, Number(timeMatch[2]), 0, 0);
  return date;
}

function nextClientAppointment(appointments) {
  const now = new Date();
  return (appointments || [])
    .filter(appointment => appointment.status === "pending" || appointment.status === "confirmed")
    .map(appointment => ({ appointment, dateTime: clientAppointmentDateTime(appointment) }))
    .filter(item => item.dateTime && item.dateTime >= now)
    .sort((left, right) => left.dateTime - right.dateTime)[0]?.appointment || null;
}

function renderClientTimeline(container, client, currency) {
  const appointments = Array.isArray(client.appointments) ? client.appointments : [];
  const upcoming = nextClientAppointment(appointments);
  const summary = document.createElement("div");
  summary.className = "client-loyalty-summary";
  const nextAppointmentText = upcoming
    ? `${formatClientDate(upcoming.appointment_date)} at ${upcoming.appointment_time} - ${upcoming.service_name}`
    : "No upcoming appointment";
  const loyaltyMetrics = [
    ["First Visit", formatClientDate(client.first_visit_date)],
    ["Last Visit", formatClientDate(client.last_visit_date)],
    ["Next Appointment", nextAppointmentText, "wide"],
    ["Total Appointments", String(client.total_appointments || 0)],
    ["Completed Visits", String(client.completed_visits || 0)],
    ["Cancelled", String(client.cancelled_appointments || 0)],
    ["No-shows", String(client.no_shows || 0)],
    ["Total Money Spent", currency.format(Number(client.total_spent) || 0)],
    ["Average Value", currency.format(Number(client.average_appointment_value) || 0)],
    ["Favorite Service", client.favorite_service || "-"],
    ["Reviews Submitted", String(client.reviews?.length || 0)],
    ["Inspiration Photos", String(client.inspiration_photos?.length || 0)]
  ];

  loyaltyMetrics.forEach(([label, value, width]) => {
    const metric = createClientMetric(label, value);
    if (width === "wide") metric.classList.add("client-metric-wide");
    summary.appendChild(metric);
  });

  const timelineSection = document.createElement("section");
  timelineSection.className = "client-timeline-section";
  const heading = document.createElement("h4");
  heading.textContent = `Appointment Timeline (${appointments.length})`;
  const note = document.createElement("p");
  note.textContent = "Estimated prices use each primary service's current listed price.";
  timelineSection.append(heading, note);

  if (!appointments.length) {
    timelineSection.appendChild(createEmptyState("No appointment history", "Appointments will appear here after booking."));
  } else {
    const list = document.createElement("div");
    list.className = "client-timeline-list";
    appointments.forEach(appointment => {
      const item = document.createElement("article");
      const supportedStatuses = ["pending", "confirmed", "completed", "cancelled", "no-show"];
      const status = supportedStatuses.includes(appointment.status) ? appointment.status : "pending";
      item.className = `client-timeline-item calendar-status-${status}`;

      const date = document.createElement("div");
      date.className = "client-timeline-date";
      const dateValue = document.createElement("strong");
      dateValue.textContent = formatClientDate(appointment.appointment_date);
      const time = document.createElement("span");
      time.textContent = appointment.appointment_time || "Time unavailable";
      date.append(dateValue, time);

      const service = document.createElement("div");
      service.className = "client-timeline-service";
      const serviceName = document.createElement("strong");
      serviceName.textContent = appointment.service_name || "Unknown Service";
      const duration = document.createElement("span");
      duration.textContent = `${Number(appointment.duration_minutes) || 60} minutes`;
      service.append(serviceName, duration);

      const price = document.createElement("strong");
      price.className = "client-timeline-price";
      price.textContent = `Est. ${currency.format(Number(appointment.estimated_price) || 0)}`;

      const statusBadge = document.createElement("span");
      statusBadge.className = "client-timeline-status";
      statusBadge.textContent = calendarStatusName(appointment.status);
      item.append(date, service, price, statusBadge);
      list.appendChild(item);
    });
    timelineSection.appendChild(list);
  }

  container.append(summary, timelineSection);
}

function renderClientCard(client) {
  const card = document.createElement("article");
  card.className = "client-card";

  const header = document.createElement("div");
  header.className = "client-card-header";

  const identity = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = client.name || "PinkSpa Client";
  const contact = document.createElement("div");
  contact.className = "client-contact";

  if (client.phone) {
    const phone = document.createElement("a");
    phone.href = `tel:${String(client.phone).replace(/\D/g, "")}`;
    phone.textContent = client.phone;
    contact.appendChild(phone);
  }

  if (client.email) {
    const email = document.createElement("a");
    email.href = `mailto:${client.email}`;
    email.textContent = client.email;
    contact.appendChild(email);
  } else {
    const noEmail = document.createElement("span");
    noEmail.textContent = "No email provided";
    contact.appendChild(noEmail);
  }

  identity.append(name, contact);

  const badges = document.createElement("div");
  badges.className = "client-badges";
  const vipBadge = document.createElement("span");
  const vipLevel = client.vip_level || "New Client";
  const vipClass = vipLevel.toLowerCase().replace(/\s+/g, "-");
  vipBadge.className = `client-vip-badge client-vip-${vipClass}`;
  vipBadge.textContent = vipLevel;
  vipBadge.setAttribute("aria-label", `Loyalty level: ${vipLevel}`);
  const appointmentBadge = document.createElement("span");
  appointmentBadge.className = "client-appointment-badge";
  appointmentBadge.textContent = `${client.total_appointments} appointment${client.total_appointments === 1 ? "" : "s"}`;
  badges.append(vipBadge, appointmentBadge);
  header.append(identity, badges);

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  });
  const metrics = document.createElement("div");
  metrics.className = "client-metrics";
  metrics.append(
    createClientMetric("Total Appointments", String(client.total_appointments)),
    createClientMetric("Total Money Spent", currency.format(Number(client.total_spent || 0))),
    createClientMetric("Favorite Service", client.favorite_service || "-"),
    createClientMetric("Last Visit", formatClientDate(client.last_visit_date)),
    createClientMetric("Reviews Submitted", String(client.reviews?.length || 0))
  );

  card.append(header, metrics);

  const timelineDetails = document.createElement("details");
  timelineDetails.className = "client-timeline-details";
  const timelineSummary = document.createElement("summary");
  const timelineLabel = document.createElement("span");
  timelineLabel.textContent = "View Timeline";
  const timelineCount = document.createElement("small");
  timelineCount.textContent = `${client.total_appointments || 0} appointment${client.total_appointments === 1 ? "" : "s"}`;
  timelineSummary.append(timelineLabel, timelineCount);
  const timelineContent = document.createElement("div");
  timelineContent.className = "client-timeline-content";
  timelineDetails.append(timelineSummary, timelineContent);
  timelineDetails.addEventListener("toggle", () => {
    if (!timelineDetails.open || timelineContent.dataset.loaded) return;
    timelineContent.dataset.loaded = "true";
    renderClientTimeline(timelineContent, client, currency);
  });
  card.appendChild(timelineDetails);

  if (client.reviews?.length) {
    const reviewDetails = document.createElement("details");
    reviewDetails.className = "client-details";
    const reviewSummary = document.createElement("summary");
    reviewSummary.textContent = `Reviews submitted (${client.reviews.length})`;
    reviewDetails.appendChild(reviewSummary);

    client.reviews.forEach(review => {
      const reviewItem = document.createElement("div");
      reviewItem.className = "client-review";
      const rating = document.createElement("strong");
      const safeRating = Math.max(0, Math.min(5, Math.round(Number(review.rating) || 0)));
      rating.textContent = `${"★".repeat(safeRating)}${"☆".repeat(5 - safeRating)}`;
      const reviewText = document.createElement("p");
      reviewText.textContent = review.review_text;
      const reviewStatus = document.createElement("small");
      reviewStatus.textContent = review.approved ? "Approved" : "Pending approval";
      reviewItem.append(rating, reviewText, reviewStatus);
      reviewDetails.appendChild(reviewItem);
    });

    card.appendChild(reviewDetails);
  }

  if (client.inspiration_photos?.length) {
    const photoSection = document.createElement("div");
    photoSection.className = "client-photos";
    const photoHeading = document.createElement("h4");
    photoHeading.textContent = `Inspiration Photos (${client.inspiration_photos.length})`;
    const photoGrid = document.createElement("div");
    photoGrid.className = "client-photo-grid";

    client.inspiration_photos.forEach(photo => {
      const photoLink = document.createElement("a");
      photoLink.href = `/api/appointments/${photo.appointment_id}/inspiration`;
      photoLink.target = "_blank";
      photoLink.rel = "noopener noreferrer";
      photoLink.title = `${photo.service_name} - ${formatClientDate(photo.appointment_date)}`;

      const image = document.createElement("img");
      image.src = photoLink.href;
      image.alt = `${photo.service_name} inspiration photo`;
      image.loading = "lazy";

      const caption = document.createElement("span");
      caption.textContent = photo.service_name;
      photoLink.append(image, caption);
      photoGrid.appendChild(photoLink);
    });

    photoSection.append(photoHeading, photoGrid);
    card.appendChild(photoSection);
  }

  return card;
}

function applyClientSearch() {
  const searchInput = document.getElementById("clientSearch");
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  const filteredClients = allClients.filter(client => {
    const text = [client.name, client.phone, client.email, client.favorite_service, client.vip_level]
      .join(" ")
      .toLowerCase();
    const phone = String(client.phone || "").replace(/\D/g, "");
    return !query || text.includes(query) || (digits && phone.includes(digits));
  });

  const list = document.getElementById("clientsList");
  const summary = document.getElementById("clientsSummary");
  if (!list || !summary) return;

  summary.textContent = query
    ? `${filteredClients.length} of ${allClients.length} clients`
    : `${allClients.length} client${allClients.length === 1 ? "" : "s"}`;
  list.replaceChildren();

  if (!filteredClients.length) {
    const empty = document.createElement("p");
    empty.className = "clients-empty";
    empty.textContent = query
      ? "No clients match your search."
      : "No clients have booked yet.";
    list.appendChild(empty);
    return;
  }

  filteredClients.forEach(client => list.appendChild(renderClientCard(client)));
}

async function loadClients() {
  const list = document.getElementById("clientsList");
  const summary = document.getElementById("clientsSummary");
  if (!list || !summary) return;

  setLoadingState(list, "Loading client relationships...");
  summary.textContent = "Loading clients...";
  try {
    const data = await api("/api/clients");
    allClients = Array.isArray(data.clients) ? data.clients : [];
    applyClientSearch();
    renderRevenueDashboard(allAppointments, allClients);
  } catch (error) {
    console.error("Unable to load clients:", error);
    allClients = [];
    summary.textContent = "Clients unavailable";
    const message = document.createElement("p");
    message.className = "owner-empty-state";
    message.textContent = "Client information could not be loaded. Please try again.";
    list.replaceChildren(message);
    throw error;
  } finally {
    finishLoading(list);
  }
}

const clientSearch = document.getElementById("clientSearch");
if (clientSearch) clientSearch.addEventListener("input", applyClientSearch);

function appointmentTimeMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  if (match[3].toUpperCase() === "PM") hours += 12;
  return hours * 60 + minutes;
}

function calendarStatusName(status) {
  const names = {
    pending: "Pending",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
    "no-show": "No-show"
  };
  return names[status] || "Unknown";
}

function formatCalendarDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;

  const formatted = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  return dateValue === localDateKey(new Date()) ? `Today, ${formatted}` : formatted;
}

function createCalendarAppointment(appointment) {
  const item = document.createElement("article");
  const supportedStatuses = ["pending", "confirmed", "completed", "cancelled", "no-show"];
  const status = supportedStatuses.includes(appointment.status) ? appointment.status : "pending";
  item.className = `calendar-appointment calendar-status-${status}`;

  const time = document.createElement("time");
  time.className = "calendar-time";
  time.textContent = appointment.appointment_time || "Time unavailable";

  const details = document.createElement("div");
  details.className = "calendar-appointment-details";
  const client = document.createElement("strong");
  client.textContent = appointment.client_name || "PinkSpa Client";
  const service = document.createElement("span");
  service.textContent = appointment.service_name || "Service unavailable";
  details.append(client, service);

  const duration = document.createElement("span");
  duration.className = "calendar-duration";
  duration.textContent = `${Number(appointment.duration_minutes) || 60} min`;

  const statusBadge = document.createElement("span");
  statusBadge.className = `calendar-status-badge calendar-status-${status}`;
  statusBadge.textContent = calendarStatusName(appointment.status);

  item.append(time, details, duration, statusBadge);
  return item;
}

function renderCalendar(appointments) {
  const list = document.getElementById("calendarList");
  const summary = document.getElementById("calendarSummary");
  if (!list || !summary) return;

  const groups = appointments.reduce((dates, appointment) => {
    const date = appointment.appointment_date || "Date unavailable";
    if (!dates.has(date)) dates.set(date, []);
    dates.get(date).push(appointment);
    return dates;
  }, new Map());
  const today = localDateKey(new Date());
  const dates = Array.from(groups.keys()).sort((left, right) => {
    const leftUpcoming = left >= today;
    const rightUpcoming = right >= today;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    return leftUpcoming ? left.localeCompare(right) : right.localeCompare(left);
  });

  summary.textContent = `${appointments.length} appointment${appointments.length === 1 ? "" : "s"} across ${dates.length} day${dates.length === 1 ? "" : "s"}`;
  list.replaceChildren();

  if (!appointments.length) {
    const empty = document.createElement("p");
    empty.className = "calendar-empty";
    empty.textContent = "No appointments are scheduled yet.";
    list.appendChild(empty);
    return;
  }

  dates.forEach(date => {
    const day = document.createElement("section");
    day.className = "calendar-day";
    day.dataset.calendarDate = date;
    day.tabIndex = -1;
    if (date === today) day.classList.add("calendar-day-today");

    const dayHeader = document.createElement("div");
    dayHeader.className = "calendar-day-header";
    const heading = document.createElement("h3");
    heading.textContent = formatCalendarDate(date);
    const count = document.createElement("span");
    count.textContent = `${groups.get(date).length} appointment${groups.get(date).length === 1 ? "" : "s"}`;
    dayHeader.append(heading, count);

    const appointmentsList = document.createElement("div");
    appointmentsList.className = "calendar-day-appointments";
    groups.get(date)
      .slice()
      .sort((left, right) => appointmentTimeMinutes(left.appointment_time) - appointmentTimeMinutes(right.appointment_time))
      .forEach(appointment => appointmentsList.appendChild(createCalendarAppointment(appointment)));

    day.append(dayHeader, appointmentsList);
    list.appendChild(day);
  });
}

function goToCalendarToday() {
  const message = document.getElementById("calendarMessage");
  const today = localDateKey(new Date());
  const todayGroup = Array.from(document.querySelectorAll(".calendar-day")).find(day => {
    return day.dataset.calendarDate === today;
  });

  if (!todayGroup) {
    if (message) message.textContent = "No appointments are scheduled for today.";
    return;
  }

  if (message) message.textContent = "Showing today's appointments.";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  todayGroup.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  todayGroup.focus({ preventScroll: true });
}

const calendarTodayButton = document.getElementById("calendarTodayBtn");
if (calendarTodayButton) calendarTodayButton.addEventListener("click", goToCalendarToday);

async function loadAppointments() {
  const list = document.getElementById("appointmentsList");
  const calendarList = document.getElementById("calendarList");
  const financialDashboard = document.querySelector(".revenue-dashboard");
  setLoadingState(list, "Loading appointments...");
  setLoadingState(calendarList, "Loading calendar...");
  if (financialDashboard) financialDashboard.setAttribute("aria-busy", "true");

  let appointments;
  try {
    appointments = await api("/api/appointments");
  } catch (error) {
    setLoadError(list, "Appointments could not be loaded. Please try again.");
    setLoadError(calendarList, "The calendar could not be loaded. Please try again.");
    throw error;
  } finally {
    if (financialDashboard) financialDashboard.removeAttribute("aria-busy");
  }

  allAppointments = appointments;
  updateDashboardGreeting();
  renderCalendar(allAppointments);
  finishLoading(calendarList);
  finishLoading(list);
  list.replaceChildren();

  const pending = appointments.filter(a => a.status === "pending").length;
  const confirmed = appointments.filter(a => a.status === "confirmed").length;
  const completed = appointments.filter(a => a.status === "completed").length;

  const today = new Date().toISOString().split("T")[0];

  const todayCount = appointments.filter(a => {
    return a.appointment_date === today;
  }).length;

  const currentDate = new Date();

  const weekAgo = new Date();
  weekAgo.setDate(currentDate.getDate() - 7);

  const weekCount = appointments.filter(a => {
    const apptDate = new Date(a.appointment_date + "T00:00:00");
    return apptDate >= weekAgo;
  }).length;

  const monthCount = appointments.filter(a => {
    const apptDate = new Date(a.appointment_date + "T00:00:00");

    return (
      apptDate.getMonth() === currentDate.getMonth() &&
      apptDate.getFullYear() === currentDate.getFullYear()
    );
  }).length;

  setCounterValue("statAppointments", appointments.length);
  setCounterValue("statPending", pending);
  setCounterValue("statConfirmed", confirmed);

  setCounterValue("statToday", todayCount);
  setCounterValue("statWeek", weekCount);
  setCounterValue("statMonth", monthCount);
  setCounterValue("statCompleted", completed);

  renderRevenueDashboard(appointments, allClients);

  if (!appointments.length) {
    list.appendChild(createEmptyState("No appointment requests yet", "New bookings will appear here automatically."));
    return;
  }

  appointments.forEach(appt => {
    const card = document.createElement("div");
    card.className = "appointment-card";

    card.innerHTML = `
      <strong>${appt.service_name}</strong>
      <span><b>Client:</b> ${appt.client_name}</span>
      <span><b>Phone:</b> ${appt.client_phone}</span>
      <span><b>Date:</b> ${appt.appointment_date}</span>
      <span><b>Time:</b> ${appt.appointment_time}</span>
      <span><b>Duration:</b> ${appt.duration_minutes || 60} minutes</span>
      <span><b>Status:</b> ${statusLabel(appt.status)}</span>
      <p><b>Notes:</b> ${appt.notes || "No notes added."}</p>
      ${appt.inspiration_image ? `
        <div>
          <b>Inspiration Photo:</b><br>
          <a
            href="/api/appointments/${appt.id}/inspiration"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="/api/appointments/${appt.id}/inspiration"
              alt="Client inspiration photo"
              loading="lazy"
              style="display:block;width:min(240px,100%);max-height:240px;margin-top:8px;object-fit:cover;border-radius:16px;border:1px solid #ffd3e4;"
            />
          </a>
       </div>
      ` : ""}
    `;

    card.appendChild(createAppointmentQuickActions(appt));

    const statusRow = document.createElement("div");
    statusRow.className = "status-row";
    [
      ["Confirm Appointment", "status-confirmed", button => confirmAppointment(appt.id, button)],
      ["Cancel Appointment", "status-cancelled", button => cancelAppointment(appt.id, button)],
      ["Mark Completed", "status-completed", button => completeAppointment(appt.id, button)],
      ["Back to Pending", "status-pending", button => setStatus(appt.id, "pending", button)],
      ["No-show", "status-no-show", button => setStatus(appt.id, "no-show", button)],
      ["Request Review", "", button => copyReviewRequest(appt.client_name, button)],
      ["Delete", "", button => deleteAppointment(appt.id, button)]
    ].forEach(([label, className, handler]) => {
      const button = document.createElement("button");
      button.type = "button";
      if (className) button.className = className;
      button.textContent = label;
      button.addEventListener("click", () => handler(button));
      statusRow.appendChild(button);
    });
    card.appendChild(statusRow);

    list.appendChild(card);
  });
}

async function setStatus(id, status, button) {
  const statusMessages = {
    pending: "Appointment moved back to pending.",
    confirmed: "Appointment confirmed successfully.",
    completed: "Appointment marked as completed.",
    cancelled: "Appointment cancelled.",
    "no-show": "Appointment marked as a no-show."
  };
  await performAction({
    button,
    busyText: "Updating...",
    successMessage: statusMessages[status] || "Appointment updated.",
    action: async () => {
      await api(`/api/appointments/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status })
      });
      await Promise.all([loadAppointments(), loadClients()]);
      await loadNotifications();
    }
  });
}

async function confirmAppointment(id, button) {
  if (!confirm("Confirm this appointment?")) return;
  await setStatus(id, "confirmed", button);
}

async function cancelAppointment(id, button) {
  if (!confirm("Cancel this appointment?")) return;
  await setStatus(id, "cancelled", button);
}

async function completeAppointment(id, button) {
  if (!confirm("Mark this appointment as completed?")) return;
  await setStatus(id, "completed", button);
}

async function deleteAppointment(id, button) {
  if (!confirm("Delete this appointment request permanently?")) return;
  await performAction({
    button,
    busyText: "Deleting...",
    successMessage: "Appointment deleted.",
    action: async () => {
      await api(`/api/appointments/${id}`, { method: "DELETE" });
      await Promise.all([loadAppointments(), loadClients()]);
    }
  });
}

async function loadServices() {
  const list = document.getElementById("servicesList");
  setLoadingState(list, "Loading services...");
  let services;
  try {
    services = await api("/api/services");
  } catch (error) {
    setLoadError(list, "Services could not be loaded. Please try again.");
    throw error;
  }

  setCounterValue("statServices", services.length);
  finishLoading(list);
  list.replaceChildren();

  if (!services.length) {
    list.appendChild(createEmptyState("No active services", "Add a service to make it available for booking."));
    return;
  }

  services.forEach(service => {
    const row = document.createElement("div");
    row.className = "service-row";

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px;">
        <img
          src="${serviceImage(service)}"
          alt="${service.name}"
          style="width:70px;height:70px;object-fit:cover;border-radius:16px;border:1px solid #ffd3e4;"
        />
        <div>
          <strong>${service.name}</strong><br>
          <small>${service.category} • ${service.price} • ${service.duration} min</small>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button onclick='editService(${JSON.stringify(service)})'>Edit</button>
        <button onclick="deleteService(${service.id}, this)">Remove</button>
      </div>
    `;

    list.appendChild(row);
  });
}

function editService(service) {
  const form = document.getElementById("serviceForm");

  editingServiceId = service.id;

  form.elements.name.value = service.name || "";
  form.elements.category.value = service.category || "";
  form.elements.price.value = service.price || "";
  form.elements.duration.value = service.duration || 60;
  form.elements.image.value = service.image || "";

  if (form.elements.image_file) {
    form.elements.image_file.value = "";
  }

  showImagePreview(serviceImage(service));

  const button = form.querySelector("button[type='submit']");
  button.textContent = "Save Service Changes";

  let cancelButton = document.getElementById("cancelEditService");

  if (!cancelButton) {
    cancelButton = document.createElement("button");
    cancelButton.id = "cancelEditService";
    cancelButton.type = "button";
    cancelButton.className = "btn full";
    cancelButton.style.marginTop = "10px";
    cancelButton.style.background = "#21171c";
    cancelButton.style.color = "white";
    cancelButton.textContent = "Cancel Edit";
    cancelButton.onclick = cancelEditService;
    form.appendChild(cancelButton);
  }

  form.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function cancelEditService() {
  editingServiceId = null;

  const form = document.getElementById("serviceForm");
  form.reset();

  showImagePreview("");

  const button = form.querySelector("button[type='submit']");
  button.textContent = "Add Service";

  const cancelButton = document.getElementById("cancelEditService");
  if (cancelButton) cancelButton.remove();
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && editingServiceId) {
    cancelEditService();
    showToast("Service editing cancelled.");
  }
});

document.getElementById("serviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const serviceId = editingServiceId;
  const success = await performAction({
    button: e.submitter,
    busyText: serviceId ? "Saving changes..." : "Adding service...",
    successMessage: serviceId ? "Service updated successfully." : "Service added successfully.",
    action: async () => {
      let imagePath = form.elements.image.value || "";
      const imageFile = form.elements.image_file?.files?.[0];

      if (imageFile) {
        const uploadData = new FormData();
        uploadData.append("image", imageFile);
        const uploadResponse = await fetch("/api/upload-service-image", {
          method: "POST",
          body: uploadData
        });
        const uploadResult = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok) throw new Error(uploadResult.error || "Image upload failed.");
        imagePath = uploadResult.image;
      }

      const payload = {
        name: form.elements.name.value,
        category: form.elements.category.value,
        price: form.elements.price.value,
        duration: form.elements.duration.value,
        image: imagePath
      };

      if (serviceId) {
        payload.active = true;
        await api(`/api/services/${serviceId}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
      } else {
        await api("/api/services", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      await Promise.all([loadServices(), loadAppointments(), loadClients()]);
    }
  });

  if (success) {
    if (serviceId) cancelEditService();
    else {
      form.reset();
      showImagePreview("");
    }
  }
});

async function deleteService(id, button) {
  if (!confirm("Remove this service?")) return;
  await performAction({
    button,
    busyText: "Removing...",
    successMessage: "Service deleted successfully.",
    action: async () => {
      await api(`/api/services/${id}`, { method: "DELETE" });
      await Promise.all([loadServices(), loadClients()]);
    }
  });
}

async function loadSettings() {
  const form = document.getElementById("settingsForm");
  const message = document.getElementById("settingsMessage");
  if (message) message.textContent = "Loading business settings...";
  setFormLoading(form, true);
  try {
    const settings = await api("/api/settings");
    dashboardBusinessName = settings.business_name || "PinkSpa";
    Object.keys(settings).forEach(key => {
      if (form.elements[key]) form.elements[key].value = settings[key] || "";
    });
    updateDashboardGreeting();
    if (message) message.textContent = "";
  } catch (error) {
    if (message) message.textContent = "Business settings could not be loaded. Please try again.";
    throw error;
  } finally {
    setFormLoading(form, false);
  }
}

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const success = await performAction({
    button: e.submitter,
    busyText: "Saving settings...",
    successMessage: "Business settings saved.",
    action: async () => {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      dashboardBusinessName = payload.business_name || "PinkSpa";
      updateDashboardGreeting();
    }
  });

  if (success) document.getElementById("settingsMessage").textContent = "Settings saved.";
});

async function loadBlockedDays() {
  const list = document.getElementById("blockedDaysList");

  if (!list) return;

  setLoadingState(list, "Loading blocked dates...");
  let days;
  try {
    days = await api("/api/blocked-days");
  } catch (error) {
    setLoadError(list, "Blocked dates could not be loaded. Please try again.");
    throw error;
  }

  finishLoading(list);
  list.replaceChildren();

  if (!days.length) {
    list.appendChild(createEmptyState("No blocked dates", "Your booking calendar is currently open."));
    return;
  }

  days.forEach(day => {
    const row = document.createElement("div");
    row.className = "service-row";

    row.innerHTML = `
      <div>
        <strong>${day.block_date}</strong><br>
        <small>${day.reason || "Unavailable"}</small>
      </div>

      <button onclick="deleteBlockedDay(${day.id}, this)">
        Remove
      </button>
    `;

    list.appendChild(row);
  });
}

async function deleteBlockedDay(id, button) {
  if (!confirm("Remove this blocked date?")) return;

  await performAction({
    button,
    busyText: "Removing...",
    successMessage: "Blocked date removed.",
    action: async () => {
      await api(`/api/blocked-days/${id}`, { method: "DELETE" });
      await loadBlockedDays();
    }
  });
}

const blockedDayForm = document.getElementById("blockedDayForm");

if (blockedDayForm) {
  blockedDayForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = Object.fromEntries(new FormData(e.target).entries());

    const success = await performAction({
      button: e.submitter,
      busyText: "Blocking date...",
      successMessage: "Date blocked successfully.",
      action: async () => {
        await api("/api/blocked-days", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        await loadBlockedDays();
      }
    });

    if (success) {
      e.target.reset();
      document.getElementById("blockedDayMessage").textContent = "Date blocked successfully.";
    }
  });
}

async function loadReviews() {
  const container = document.getElementById("ownerReviewsList");
  if (!container) return;

  setLoadingState(container, "Loading client reviews...");
  let data;
  try {
    data = await api("/api/admin/reviews");
  } catch (error) {
    setLoadError(container, "Reviews could not be loaded. Please try again.");
    throw error;
  }
  const reviews = data.reviews || [];
  finishLoading(container);

  if (!reviews.length) {
    container.replaceChildren(createEmptyState("No reviews submitted yet", "New client feedback will appear here."));
    return;
  }

  container.innerHTML = reviews.map(review => `
    <div class="appointment-card">
      <h3>${review.client_name}</h3>
      <p>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
      <p>${review.review_text}</p>
      <p><b>Status:</b> ${review.approved ? "Approved" : "Pending Approval"}</p>

      <div class="status-row">
        <button onclick="approveReview(${review.id}, this)">Approve</button>
        <button onclick="unapproveReview(${review.id}, this)">Hide</button>
        <button onclick="deleteReview(${review.id}, this)">Delete</button>
      </div>
    </div>
  `).join("");
}

async function approveReview(id, button) {
  await performAction({
    button,
    busyText: "Approving...",
    successMessage: "Review approved and published.",
    action: async () => {
      await api(`/api/admin/reviews/${id}/approve`, { method: "PUT" });
      await Promise.all([loadReviews(), loadClients()]);
    }
  });
}

async function unapproveReview(id, button) {
  await performAction({
    button,
    busyText: "Hiding...",
    successMessage: "Review hidden from the website.",
    action: async () => {
      await api(`/api/admin/reviews/${id}/unapprove`, { method: "PUT" });
      await Promise.all([loadReviews(), loadClients()]);
    }
  });
}

async function deleteReview(id, button) {
  if (!confirm("Delete this review?")) return;
  await performAction({
    button,
    busyText: "Deleting...",
    successMessage: "Review deleted.",
    action: async () => {
      await api(`/api/admin/reviews/${id}`, { method: "DELETE" });
      await Promise.all([loadReviews(), loadClients()]);
    }
  });
}

window.approveReview = approveReview;
window.unapproveReview = unapproveReview;
window.deleteReview = deleteReview;

async function copyReviewRequest(clientName, button) {
  const message =
`Hi ${clientName || ""}! Thank you for visiting PinkSpa 💖

We would love your feedback.

Please leave us a quick review here:
https://rachelpinkspa.com/review`;

  await performAction({
    button,
    busyText: "Copying...",
    successMessage: "Review request copied. It is ready to paste into a message.",
    action: () => navigator.clipboard.writeText(message)
  });
}

checkLogin();
