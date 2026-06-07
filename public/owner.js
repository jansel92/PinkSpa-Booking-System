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
  await Promise.all([
    loadAppointments(),
    loadServices(),
    loadSettings(),
    loadBlockedDays()
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
      <span><b>Client:</b> ${appt.client_name}</span>
      <span><b>Phone:</b> ${appt.client_phone}</span>
      <span><b>Date:</b> ${appt.appointment_date}</span>
      <span><b>Time:</b> ${appt.appointment_time}</span>
      <span><b>Status:</b> ${statusLabel(appt.status)}</span>
      <p><b>Notes:</b> ${appt.notes || "No notes added."}</p>

      <div class="status-row">
        <button class="status-confirmed" onclick="confirmAppointment(${appt.id})">Confirm Appointment</button>
        <button class="status-cancelled" onclick="cancelAppointment(${appt.id})">Cancel Appointment</button>
        <button class="status-completed" onclick="completeAppointment(${appt.id})">Mark Completed</button>
        <button class="status-pending" onclick="setStatus(${appt.id}, 'pending')">Back to Pending</button>
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

  form.scrollIntoView({ behavior: "smooth", block: "center" });
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

    const payload = Object.fromEntries(
      new FormData(e.target).entries()
    );

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
