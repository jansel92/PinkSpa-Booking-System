const imageFallbacks = {
  nails: "/images/nails/nails1.jpeg",
  pedi: "/images/pedicure/pedi1.png",
  lashes: "/images/lashes/lashes1.jpeg",
  brows: "/images/brows/brows1.jpeg"
};

const allTimes = [
  "9:30 AM",
  "10:00 AM",
  "10:30 AM",
  "11:00 AM",
  "11:30 AM",
  "12:00 PM",
  "12:30 PM",
  "1:00 PM",
  "1:30 PM",
  "2:00 PM",
  "2:30 PM"
];

function categoryImage(service) {
  if (service.image) return service.image;

  const category = (service.category || "").toLowerCase();
  const name = (service.name || "").toLowerCase();
  const text = category + " " + name;

  if (text.includes("pedi") || text.includes("toe") || text.includes("foot")) {
    return imageFallbacks.pedi;
  }

  if (text.includes("lash") || text.includes("eyelash")) {
    return imageFallbacks.lashes;
  }

  if (
    text.includes("brow") ||
    text.includes("eyebrow") ||
    text.includes("wax") ||
    text.includes("henna") ||
    text.includes("lamination")
  ) {
    return imageFallbacks.brows;
  }

  return imageFallbacks.nails;
}

function statusText(status) {
  const statuses = {
    pending: "Pending Review",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    completed: "Completed",
    "no-show": "No-show"
  };

  return statuses[status] || status;
}

function renderTimeOptions(availableTimes) {
  const timeSelect = document.querySelector('select[name="appointment_time"]');
  if (!timeSelect) return;

  timeSelect.innerHTML = "";

  if (!availableTimes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No times available";
    timeSelect.appendChild(option);
    timeSelect.disabled = true;
    return;
  }

  timeSelect.disabled = false;

  availableTimes.forEach(time => {
    const option = document.createElement("option");
    option.value = time;
    option.textContent = time;
    timeSelect.appendChild(option);
  });
}

function isWeekend(dateValue) {
  const date = new Date(dateValue + "T00:00:00");
  const day = date.getDay();
  return day === 0 || day === 6;
}

async function updateAvailableTimes() {
  const dateInput = document.querySelector('input[name="appointment_date"]');
  const message = document.getElementById("bookingMessage");

  if (!dateInput || !dateInput.value) {
    renderTimeOptions(allTimes);
    return;
  }

  if (isWeekend(dateInput.value)) {
    renderTimeOptions([]);
    if (message) {
      message.textContent = "PinkSpa is closed on Saturdays and Sundays. Please choose Monday through Friday.";
    }
    return;
  }

  if (message) message.textContent = "";

  try {
    const response = await fetch(`/api/booked-times?date=${encodeURIComponent(dateInput.value)}`);
    const data = await response.json();

    if (!response.ok) {
      renderTimeOptions(allTimes);
      return;
    }

    if (data.blocked) {
      renderTimeOptions([]);
      if (message) {
        message.textContent = data.reason
          ? `This date is unavailable: ${data.reason}. Please choose another date.`
          : "This date is unavailable. Please choose another date.";
      }
      return;
    }

    const bookedTimes = data.bookedTimes || [];
    const availableTimes = allTimes.filter(time => !bookedTimes.includes(time));

    renderTimeOptions(availableTimes);

    if (!availableTimes.length && message) {
      message.textContent = "No times are available for this date. Please choose another date.";
    }
  } catch (error) {
    renderTimeOptions(allTimes);
  }
}

function setupBookingDateRules() {
  const dateInput = document.querySelector('input[name="appointment_date"]');
  if (!dateInput) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  dateInput.min = `${yyyy}-${mm}-${dd}`;

  dateInput.addEventListener("change", updateAvailableTimes);
  renderTimeOptions(allTimes);
}

function selectServiceForBooking(serviceId, serviceName) {
  const select = document.getElementById("serviceSelect");
  const bookSection = document.getElementById("book");
  const message = document.getElementById("bookingMessage");

  if (select) {
    select.value = String(serviceId);
  }

  if (message) {
    message.textContent = `${serviceName} selected. Please choose your date and time.`;
  }

  if (bookSection) {
    bookSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

async function loadSettings() {
  const settings = await fetch("/api/settings").then(r => r.json());

  const cityText = document.getElementById("cityText");
  const businessPhoneText = document.getElementById("businessPhoneText");
  const businessHoursText = document.getElementById("businessHoursText");
  const phoneLink = document.getElementById("phoneLink");
  const ctaPhone = document.getElementById("ctaPhone");

  if (cityText) cityText.textContent = "📍 " + settings.city;
  if (businessPhoneText) businessPhoneText.textContent = "☎ " + settings.phone;
  if (businessHoursText) businessHoursText.textContent = "🕘 " + settings.hours;

  if (phoneLink) {
    phoneLink.href = "tel:" + settings.phone;
    phoneLink.textContent = "Call PinkSpa";
  }

  if (ctaPhone) {
    ctaPhone.href = "tel:" + settings.phone;
  }
}

async function loadServices() {
  const services = await fetch("/api/services").then(r => r.json());
  const grid = document.getElementById("serviceGrid");
  const select = document.getElementById("serviceSelect");

  if (!grid || !select) return;

  grid.innerHTML = "";
  select.innerHTML = "";

  services.forEach(service => {
    const card = document.createElement("article");
    card.className = "service-card";

    card.innerHTML = `
      <div class="service-card-img" style="background-image:url('${categoryImage(service)}')"></div>
      <div class="service-card-body">
        <span class="service-category">${service.category}</span>
        <h3>${service.name}</h3>
        <strong>${service.price}</strong>
        <p>${service.duration} minutes</p>
        <button
          type="button"
          class="service-book-btn"
          data-service-id="${service.id}"
          data-service-name="${service.name}"
        >
          Book This Service
        </button>
      </div>
    `;

    grid.appendChild(card);

    const bookButton = card.querySelector(".service-book-btn");

    if (bookButton) {
      bookButton.addEventListener("click", () => {
        selectServiceForBooking(service.id, service.name);
      });
    }

    const option = document.createElement("option");
    option.value = service.id;
    option.textContent = `${service.name} - ${service.price}`;
    select.appendChild(option);
  });
}

const bookingForm = document.getElementById("bookingForm");

if (bookingForm) {
  bookingForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    const message = document.getElementById("bookingMessage");

    if (isWeekend(payload.appointment_date)) {
      message.textContent = "PinkSpa is closed on Saturdays and Sundays. Please choose Monday through Friday.";
      return;
    }

    if (!payload.appointment_time) {
      message.textContent = "Please choose an available time.";
      return;
    }

    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      message.textContent = data.error || "Something went wrong.";
      await updateAvailableTimes();
      return;
    }

    e.target.reset();
    renderTimeOptions(allTimes);
    message.textContent = "Your appointment request was sent to PinkSpa. You can check your appointment status using your phone number.";
  });
}

const statusForm = document.getElementById("statusForm");

if (statusForm) {
  statusForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const phone = new FormData(e.target).get("phone");
    const resultBox = document.getElementById("statusResult");

    resultBox.innerHTML = "Checking appointment status...";

    const response = await fetch(`/api/appointment-status?phone=${encodeURIComponent(phone)}`);
    const data = await response.json();

    if (!response.ok || !data.appointments || data.appointments.length === 0) {
      resultBox.innerHTML = `
        <div class="status-result-card">
          <strong>No appointment found.</strong>
          <p>Please check the phone number and try again.</p>
        </div>
      `;
      return;
    }

    resultBox.innerHTML = data.appointments.map(appt => `
      <div class="status-result-card">
        <h3>${appt.service_name}</h3>
        <p><b>Name:</b> ${appt.client_name}</p>
        <p><b>Date:</b> ${appt.appointment_date}</p>
        <p><b>Time:</b> ${appt.appointment_time}</p>
        <p><b>Status:</b> ${statusText(appt.status)}</p>
      </div>
    `).join("");
  });
}

loadSettings();
loadServices();
setupBookingDateRules();
