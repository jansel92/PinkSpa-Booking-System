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
  const data = await api("/api/me");
  if (data.owner) showDashboard();
}

function showDashboard() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  setupImageFilePreview();
  loadAll();
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const msg = document.getElementById("loginMessage");

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showDashboard();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(section => {
      section.classList.add("hidden");
    });

    document.getElementById(btn.dataset.tab + "Tab").classList.remove("hidden");
  });
});

async function loadAll() {
  await Promise.all([
  loadAppointments(),
  loadServices(),
  loadClients(),
  loadSettings(),
  loadBlockedDays(),
  loadReviews()
]);
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

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderRevenueDashboard(appointments) {
  const completedAppointments = appointments.filter(appt => appt.status === "completed");
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

  const serviceCounts = completedAppointments.reduce((counts, appt) => {
    const serviceName = appt.service_name || "Unknown Service";
    counts.set(serviceName, (counts.get(serviceName) || 0) + 1);
    return counts;
  }, new Map());
  const mostPopularService = Array.from(serviceCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "-";

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
    revenuePopular: mostPopularService
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
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

  const appointmentBadge = document.createElement("span");
  appointmentBadge.className = "client-appointment-badge";
  appointmentBadge.textContent = `${client.total_appointments} appointment${client.total_appointments === 1 ? "" : "s"}`;
  header.append(identity, appointmentBadge);

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
    const text = [client.name, client.phone, client.email, client.favorite_service]
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

  try {
    const data = await api("/api/clients");
    allClients = Array.isArray(data.clients) ? data.clients : [];
    applyClientSearch();
  } catch (error) {
    console.error("Unable to load clients:", error);
    allClients = [];
    summary.textContent = "Clients unavailable";
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = "Client information could not be loaded. Please try again.";
    list.replaceChildren(message);
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
  const appointments = await api("/api/appointments");
  allAppointments = appointments;
  renderCalendar(allAppointments);
  const list = document.getElementById("appointmentsList");
  list.innerHTML = "";

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

  document.getElementById("statAppointments").textContent = appointments.length;
  document.getElementById("statPending").textContent = pending;
  document.getElementById("statConfirmed").textContent = confirmed;

  const statToday = document.getElementById("statToday");
  const statWeek = document.getElementById("statWeek");
  const statMonth = document.getElementById("statMonth");
  const statCompleted = document.getElementById("statCompleted");

  if (statToday) statToday.textContent = todayCount;
  if (statWeek) statWeek.textContent = weekCount;
  if (statMonth) statMonth.textContent = monthCount;
  if (statCompleted) statCompleted.textContent = completed;

  renderRevenueDashboard(appointments);

  if (!appointments.length) {
    list.innerHTML = "<p>No appointment requests yet.</p>";
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

      <div class="status-row">
        <button class="status-confirmed" onclick="confirmAppointment(${appt.id})">Confirm Appointment</button>
        <button class="status-cancelled" onclick="cancelAppointment(${appt.id})">Cancel Appointment</button>
        <button class="status-completed" onclick="completeAppointment(${appt.id})">Mark Completed</button>
        <button class="status-pending" onclick="setStatus(${appt.id}, 'pending')">Back to Pending</button>
        <button class="status-no-show" onclick="setStatus(${appt.id}, 'no-show')">No-show</button>
        <button onclick="copyReviewRequest('${appt.client_name}')">
           Request Review
        </button>

       <button onclick="deleteAppointment(${appt.id})">Delete</button>
       </div>
    `;

    list.appendChild(card);
  });
}

async function setStatus(id, status) {
  await api(`/api/appointments/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status })
  });

  await Promise.all([loadAppointments(), loadClients()]);
}

async function confirmAppointment(id) {
  if (!confirm("Confirm this appointment?")) return;
  await setStatus(id, "confirmed");
}

async function cancelAppointment(id) {
  if (!confirm("Cancel this appointment?")) return;
  await setStatus(id, "cancelled");
}

async function completeAppointment(id) {
  if (!confirm("Mark this appointment as completed?")) return;
  await setStatus(id, "completed");
}

async function deleteAppointment(id) {
  if (!confirm("Delete this appointment request permanently?")) return;

  await api(`/api/appointments/${id}`, {
    method: "DELETE"
  });

  await Promise.all([loadAppointments(), loadClients()]);
}

async function loadServices() {
  const services = await api("/api/services");

  document.getElementById("statServices").textContent = services.length;

  const list = document.getElementById("servicesList");
  list.innerHTML = "";

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
        <button onclick="deleteService(${service.id})">Remove</button>
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

document.getElementById("serviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  let imagePath = form.elements.image.value || "";

  const imageFile = form.elements.image_file?.files?.[0];

  if (imageFile) {
    const uploadData = new FormData();
    uploadData.append("image", imageFile);

    const uploadResponse = await fetch("/api/upload-service-image", {
      method: "POST",
      body: uploadData
    });

    const uploadResult = await uploadResponse.json();

    if (!uploadResponse.ok) {
      alert(uploadResult.error || "Image upload failed.");
      return;
    }

    imagePath = uploadResult.image;
  }

  const payload = {
    name: form.elements.name.value,
    category: form.elements.category.value,
    price: form.elements.price.value,
    duration: form.elements.duration.value,
    image: imagePath
  };

  if (editingServiceId) {
    payload.active = true;

    await api(`/api/services/${editingServiceId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    cancelEditService();
  } else {
    await api("/api/services", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    form.reset();
    showImagePreview("");
  }

  await Promise.all([loadServices(), loadAppointments(), loadClients()]);
});

async function deleteService(id) {
  if (!confirm("Remove this service?")) return;

  await api(`/api/services/${id}`, {
    method: "DELETE"
  });

  await Promise.all([loadServices(), loadClients()]);
}

async function loadSettings() {
  const settings = await api("/api/settings");
  const form = document.getElementById("settingsForm");

  Object.keys(settings).forEach(key => {
    if (form.elements[key]) {
      form.elements[key].value = settings[key] || "";
    }
  });
}

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = Object.fromEntries(new FormData(e.target).entries());

  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  document.getElementById("settingsMessage").textContent = "Settings saved.";
});

async function loadBlockedDays() {
  const list = document.getElementById("blockedDaysList");

  if (!list) return;

  const days = await api("/api/blocked-days");

  list.innerHTML = "";

  if (!days.length) {
    list.innerHTML = "<p>No blocked dates.</p>";
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

      <button onclick="deleteBlockedDay(${day.id})">
        Remove
      </button>
    `;

    list.appendChild(row);
  });
}

async function deleteBlockedDay(id) {
  if (!confirm("Remove this blocked date?")) return;

  await api(`/api/blocked-days/${id}`, {
    method: "DELETE"
  });

  loadBlockedDays();
}

const blockedDayForm = document.getElementById("blockedDayForm");

if (blockedDayForm) {
  blockedDayForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = Object.fromEntries(new FormData(e.target).entries());

    await api("/api/blocked-days", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    e.target.reset();

    document.getElementById("blockedDayMessage").textContent =
      "Date blocked successfully.";

    loadBlockedDays();
  });
}

async function loadReviews() {
  const container = document.getElementById("ownerReviewsList");
  if (!container) return;

  const data = await api("/api/admin/reviews");
  const reviews = data.reviews || [];

  if (!reviews.length) {
    container.innerHTML = "<p>No reviews submitted yet.</p>";
    return;
  }

  container.innerHTML = reviews.map(review => `
    <div class="appointment-card">
      <h3>${review.client_name}</h3>
      <p>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
      <p>${review.review_text}</p>
      <p><b>Status:</b> ${review.approved ? "Approved" : "Pending Approval"}</p>

      <div class="status-row">
        <button onclick="approveReview(${review.id})">Approve</button>
        <button onclick="unapproveReview(${review.id})">Hide</button>
        <button onclick="deleteReview(${review.id})">Delete</button>
      </div>
    </div>
  `).join("");
}

async function approveReview(id) {
  await api(`/api/admin/reviews/${id}/approve`, { method: "PUT" });
  await Promise.all([loadReviews(), loadClients()]);
}

async function unapproveReview(id) {
  await api(`/api/admin/reviews/${id}/unapprove`, { method: "PUT" });
  await Promise.all([loadReviews(), loadClients()]);
}

async function deleteReview(id) {
  if (!confirm("Delete this review?")) return;
  await api(`/api/admin/reviews/${id}`, { method: "DELETE" });
  await Promise.all([loadReviews(), loadClients()]);
}

window.approveReview = approveReview;
window.unapproveReview = unapproveReview;
window.deleteReview = deleteReview;

function copyReviewRequest(clientName) {
  const message =
`Hi ${clientName || ""}! Thank you for visiting PinkSpa 💖

We would love your feedback.

Please leave us a quick review here:
https://rachelpinkspa.com/review`;

  navigator.clipboard.writeText(message);

  alert("Review request copied! Paste it into text message, WhatsApp, Instagram DM, or Facebook Messenger.");
}

checkLogin();
