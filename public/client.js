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

let allServices = [];

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

function getSelectedServices() {
  const checked = document.querySelectorAll(".service-choice:checked");

  return Array.from(checked)
    .map(input => allServices.find(service => String(service.id) === String(input.value)))
    .filter(Boolean);
}

function updateBookingSummary() {
  const selected = getSelectedServices();
  const hiddenServiceInput = document.getElementById("serviceSelect");
  const summary = document.getElementById("bookingSummary");

  if (!hiddenServiceInput || !summary) return;

  if (!selected.length) {
    hiddenServiceInput.value = "";
    summary.textContent = "Select one or more services.";
    return;
  }

  hiddenServiceInput.value = selected[0].id;

  const totalMinutes = selected.reduce((sum, service) => {
    return sum + Number(service.duration || 0);
  }, 0);

  const serviceNames = selected.map(service => service.name).join(", ");

  summary.innerHTML = `
    <strong>Selected:</strong> ${serviceNames}<br>
    <strong>Total estimated time:</strong> ${totalMinutes} minutes
  `;
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
  const checkbox = document.querySelector(`.service-choice[value="${serviceId}"]`);
  const bookSection = document.getElementById("book");
  const message = document.getElementById("bookingMessage");

  if (checkbox) {
    checkbox.checked = true;
    updateBookingSummary();
  }

  if (message) {
    message.textContent = `${serviceName} selected. You can add more services if needed.`;
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
  allServices = services;

  const grid = document.getElementById("serviceGrid");
  const hiddenServiceInput = document.getElementById("serviceSelect");
  const checkboxList = document.getElementById("serviceCheckboxList");

  if (!grid || !hiddenServiceInput || !checkboxList) return;

  grid.innerHTML = "";
  checkboxList.innerHTML = "";

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

    const serviceOption = document.createElement("label");
    serviceOption.className = "service-checkbox-item";

    serviceOption.innerHTML = `
      <input
        type="checkbox"
        class="service-choice"
        value="${service.id}"
      />
      <span>
        <strong>${service.name}</strong><br>
        <small>${service.category} • ${service.price} • ${service.duration} min</small>
      </span>
    `;

    const checkbox = serviceOption.querySelector("input");

    checkbox.addEventListener("change", updateBookingSummary);

    checkboxList.appendChild(serviceOption);
  });

  updateBookingSummary();
}

const bookingForm = document.getElementById("bookingForm");

if (bookingForm) {
  bookingForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    const message = document.getElementById("bookingMessage");

    const selectedServices = getSelectedServices();

    if (!selectedServices.length) {
      message.textContent = "Please select at least one service.";
      return;
    }

    payload.service_id = selectedServices[0].id;

    const selectedServiceText = selectedServices
      .map(service => `${service.name} (${service.duration} min)`)
      .join(", ");

    const totalMinutes = selectedServices.reduce((sum, service) => {
      return sum + Number(service.duration || 0);
    }, 0);
payload.duration_minutes = totalMinutes;
    
    payload.notes = `
Selected Services: ${selectedServiceText}
Total Estimated Time: ${totalMinutes} minutes

Client Notes:
${payload.notes || "No notes added."}
`;

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

    document.querySelectorAll(".service-choice").forEach(input => {
      input.checked = false;
    });

    updateBookingSummary();
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
function setupGalleryLightbox() {
  const galleryImages = Array.from(document.querySelectorAll(".gallery-grid img"));
  const lightbox = document.getElementById("galleryLightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const closeBtn = document.getElementById("lightboxClose");
  const prevBtn = document.getElementById("lightboxPrev");
  const nextBtn = document.getElementById("lightboxNext");

  if (!galleryImages.length || !lightbox || !lightboxImage) return;

  let currentIndex = 0;

  function openLightbox(index) {
    currentIndex = index;
    lightboxImage.src = galleryImages[currentIndex].src;
    lightbox.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("active");
    lightboxImage.src = "";
    document.body.style.overflow = "";
  }

  function showPrev() {
    currentIndex = (currentIndex - 1 + galleryImages.length) % galleryImages.length;
    lightboxImage.src = galleryImages[currentIndex].src;
  }

  function showNext() {
    currentIndex = (currentIndex + 1) % galleryImages.length;
    lightboxImage.src = galleryImages[currentIndex].src;
  }

  galleryImages.forEach((img, index) => {
    img.addEventListener("click", () => openLightbox(index));
  });

  closeBtn.addEventListener("click", closeLightbox);
  prevBtn.addEventListener("click", showPrev);
  nextBtn.addEventListener("click", showNext);

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("active")) return;

    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") showPrev();
    if (e.key === "ArrowRight") showNext();
  });
}

setupGalleryLightbox();
