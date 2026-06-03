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

async function checkLogin() {
  const data = await api("/api/me");
  if (data.owner) showDashboard();
}

function showDashboard() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  loadAll();
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  const msg = document.getElementById("loginMessage");
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
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
    document.querySelectorAll(".tab-content").forEach(section => section.classList.add("hidden"));
    document.getElementById(btn.dataset.tab + "Tab").classList.remove("hidden");
  });
});

async function loadAll() {
  await Promise.all([loadAppointments(), loadServices(), loadSettings()]);
}

async function loadAppointments() {
  const appointments = await api("/api/appointments");
  const list = document.getElementById("appointmentsList");
  list.innerHTML = "";

  const pending = appointments.filter(a => a.status === "pending").length;
  const confirmed = appointments.filter(a => a.status === "confirmed").length;

  document.getElementById("statAppointments").textContent = appointments.length;
  document.getElementById("statPending").textContent = pending;
  document.getElementById("statConfirmed").textContent = confirmed;

  if (!appointments.length) {
    list.innerHTML = "<p>No appointment requests yet.</p>";
    return;
  }

  appointments.forEach(appt => {
    const card = document.createElement("div");
    card.className = "appointment-card";
    card.innerHTML = `
      <strong>${appt.service_name}</strong>
      <span>${appt.client_name} • ${appt.client_phone}</span>
      <span>${appt.appointment_date} at ${appt.appointment_time}</span>
      <span>Status: <b>${appt.status}</b></span>
      <p>${appt.notes || "No notes added."}</p>
      <div class="status-row">
        <button class="status-pending" onclick="setStatus(${appt.id}, 'pending')">Pending</button>
        <button class="status-confirmed" onclick="setStatus(${appt.id}, 'confirmed')">Confirm</button>
        <button class="status-cancelled" onclick="setStatus(${appt.id}, 'cancelled')">Cancel</button>
        <button class="status-completed" onclick="setStatus(${appt.id}, 'completed')">Completed</button>
        <button class="status-no-show" onclick="setStatus(${appt.id}, 'no-show')">No-show</button>
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
  loadAppointments();
}

async function deleteAppointment(id) {
  if (!confirm("Delete this appointment request?")) return;
  await api(`/api/appointments/${id}`, { method: "DELETE" });
  loadAppointments();
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
      <div>
        <strong>${service.name}</strong><br>
        <small>${service.category} • ${service.price} • ${service.duration} min</small>
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

  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditService() {
  editingServiceId = null;

  const form = document.getElementById("serviceForm");
  form.reset();

  const button = form.querySelector("button[type='submit']");
  button.textContent = "Add Service";

  const cancelButton = document.getElementById("cancelEditService");
  if (cancelButton) cancelButton.remove();
}

document.getElementById("serviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());

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
  }

  loadServices();
});

async function deleteService(id) {
  if (!confirm("Remove this service?")) return;
  await api(`/api/services/${id}`, { method: "DELETE" });
  loadServices();
}

async function loadSettings() {
  const settings = await api("/api/settings");
  const form = document.getElementById("settingsForm");
  Object.keys(settings).forEach(key => {
    if (form.elements[key]) form.elements[key].value = settings[key] || "";
  });
}

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
  document.getElementById("settingsMessage").textContent = "Settings saved.";
});

checkLogin();
