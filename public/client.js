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
let revealObserver = null;
let availabilityRequestId = 0;
let primaryServiceId = null;
let activeServiceCategory = "all";
let servicePageIndex = 0;
let serviceFilterRenderTimer = null;
let statsObserver = null;
const mobileServicesPerPage = 3;

const serviceCategories = [
  { key: "all", label: "All" },
  { key: "nails", label: "Nails" },
  { key: "lashes", label: "Lashes" },
  { key: "brows", label: "Brows" },
  { key: "pedicure", label: "Pedicure" },
  { key: "waxing", label: "Waxing" },
  { key: "other", label: "Other" }
];

function setAppLoading(isVisible) {
  const overlay = document.getElementById("appLoadingOverlay");
  if (!overlay) return;

  overlay.classList.toggle("is-visible", isVisible);
  overlay.setAttribute("aria-hidden", isVisible ? "false" : "true");
}

function setupAppLoadingOverlay() {
  const overlay = document.getElementById("appLoadingOverlay");
  if (!overlay) return;

  window.setTimeout(() => setAppLoading(false), 850);
  window.addEventListener("load", () => {
    window.setTimeout(() => setAppLoading(false), 250);
  }, { once: true });
}

if (document.body?.classList.contains("home-page")) {
  document.documentElement.classList.add("home-entrance-prep");
  window.requestAnimationFrame(() => {
    setTimeout(() => {
      document.documentElement.classList.add("home-entrance-ready");
    }, 150);
  });
}

function setupGlassNavigation() {
  const nav = document.querySelector(".home-page .nav");
  if (!nav) return;

  let ticking = false;
  const updateNav = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 18);
    ticking = false;
  };

  updateNav();
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateNav);
  }, { passive: true });
}

function observeRevealElements(elements) {
  if (!revealObserver) return;

  Array.from(elements).forEach((element, index) => {
    element.classList.add("scroll-reveal");
    element.style.setProperty("--reveal-delay", `${Math.min(index * 65, 325)}ms`);
    revealObserver.observe(element);
  });
}

function setupScrollReveal() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || !("IntersectionObserver" in window)) return;

  document.documentElement.classList.add("reveal-enabled");

  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -8%",
    threshold: 0.12
  });

  observeRevealElements(document.querySelectorAll(
    ".home-page #services .heading, .home-page .service-category-filters, " +
    ".home-page #stats .heading, .home-page .home-stat-card, " +
    ".home-page #gallery .heading, .home-page .gallery-grid img, " +
    ".home-page #reviews .heading, .home-page .review-card, " +
    ".home-page #status .heading, .home-page #status .form-card, " +
    ".home-page .booking-copy, .home-page #bookingForm, " +
    ".home-page .cta, .home-page footer"
  ));
}

function formatStatValue(value, decimals, suffix) {
  return `${value.toFixed(decimals)}${suffix}`;
}

function animateStatNumber(element) {
  if (element.dataset.statAnimated === "true") return;

  const target = Number(element.dataset.statTarget || "0");
  const decimals = Number(element.dataset.statDecimals || "0");
  const suffix = element.dataset.statSuffix || "";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  element.dataset.statAnimated = "true";

  if (reduceMotion || !Number.isFinite(target)) {
    element.textContent = formatStatValue(target, decimals, suffix);
    return;
  }

  const duration = 1300;
  const startTime = performance.now();

  const step = currentTime => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = target * eased;

    element.textContent = formatStatValue(currentValue, decimals, suffix);

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };

  window.requestAnimationFrame(step);
}

function setupStatsCounters() {
  const statsSection = document.getElementById("stats");
  const statNumbers = document.querySelectorAll(".home-page .stat-number");
  if (!statsSection || !statNumbers.length) return;

  if (!("IntersectionObserver" in window)) {
    statNumbers.forEach(animateStatNumber);
    return;
  }

  statsObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      statNumbers.forEach(animateStatNumber);
      statsObserver.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -12%",
    threshold: 0.28
  });

  statsObserver.observe(statsSection);
}

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

function serviceCategoryKey(service) {
  const text = `${service.category || ""} ${service.name || ""}`.toLowerCase();
  if (text.includes("lash")) return "lashes";
  if (text.includes("brow")) return "brows";
  if (text.includes("pedi")) return "pedicure";
  if (text.includes("wax")) return "waxing";
  if (text.includes("nail")) return "nails";
  return "other";
}

function filteredServices() {
  if (activeServiceCategory === "all") return allServices;
  return allServices.filter(service => serviceCategoryKey(service) === activeServiceCategory);
}

function shouldLimitMobileServices() {
  return window.matchMedia("(max-width: 700px)").matches;
}

function createServiceCard(service) {
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

  const bookButton = card.querySelector(".service-book-btn");

  if (bookButton) {
    bookButton.addEventListener("click", () => {
      selectServiceForBooking(service.id, service.name);
    });
  }

  return card;
}

function renderServiceCards(options = {}) {
  const grid = document.getElementById("serviceGrid");
  const pager = document.getElementById("servicePager");
  const prevButton = document.getElementById("servicePrev");
  const nextButton = document.getElementById("serviceNext");
  const pageInfo = document.getElementById("servicePageInfo");
  if (!grid) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const render = () => {
    const services = filteredServices();
    const isMobile = shouldLimitMobileServices();
    const totalPages = Math.max(1, Math.ceil(services.length / mobileServicesPerPage));
    servicePageIndex = Math.min(servicePageIndex, totalPages - 1);

    const startIndex = isMobile ? servicePageIndex * mobileServicesPerPage : 0;
    const endIndex = isMobile ? Math.min(startIndex + mobileServicesPerPage, services.length) : services.length;
    const visibleServices = isMobile ? services.slice(startIndex, endIndex) : services;

    grid.replaceChildren(...visibleServices.map(createServiceCard));
    grid.classList.remove("is-switching");

    if (pager) {
      const shouldShowPager = isMobile && services.length > mobileServicesPerPage;
      pager.hidden = !shouldShowPager;
    }

    if (pageInfo) {
      pageInfo.textContent = services.length ? `${startIndex + 1}-${endIndex} of ${services.length}` : "0 of 0";
    }

    if (prevButton) {
      prevButton.disabled = servicePageIndex === 0;
      prevButton.setAttribute("aria-disabled", String(prevButton.disabled));
    }

    if (nextButton) {
      nextButton.disabled = servicePageIndex >= totalPages - 1;
      nextButton.setAttribute("aria-disabled", String(nextButton.disabled));
    }

    observeRevealElements(grid.querySelectorAll(".service-card"));
  };

  window.clearTimeout(serviceFilterRenderTimer);

  if (options.animate && !reduceMotion) {
    grid.classList.add("is-switching");
    serviceFilterRenderTimer = window.setTimeout(render, 120);
    return;
  }

  render();
}

function renderServiceCategoryFilters() {
  const filters = document.getElementById("serviceCategoryFilters");
  const prevButton = document.getElementById("servicePrev");
  const nextButton = document.getElementById("serviceNext");
  if (!filters) return;

  filters.replaceChildren(...serviceCategories.map(category => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "service-filter";
    button.textContent = category.label;
    button.dataset.category = category.key;
    button.setAttribute("aria-pressed", String(category.key === activeServiceCategory));

    button.addEventListener("click", () => {
      activeServiceCategory = category.key;
      servicePageIndex = 0;

      filters.querySelectorAll(".service-filter").forEach(filterButton => {
        filterButton.setAttribute("aria-pressed", String(filterButton.dataset.category === activeServiceCategory));
      });

      renderServiceCards({ animate: true });
    });

    return button;
  }));

  observeRevealElements(filters.querySelectorAll(".service-filter"));

  if (prevButton) {
    prevButton.addEventListener("click", () => {
      if (servicePageIndex === 0) return;
      servicePageIndex -= 1;
      renderServiceCards({ animate: true });
    });
  }

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(filteredServices().length / mobileServicesPerPage));
      if (servicePageIndex >= totalPages - 1) return;
      servicePageIndex += 1;
      renderServiceCards({ animate: true });
    });
  }
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

function getPrimaryService(selectedServices = getSelectedServices()) {
  if (!selectedServices.length) return null;

  return selectedServices.find(service => {
    return String(service.id) === String(primaryServiceId);
  }) || selectedServices[0];
}

function syncServiceChoiceCard(checkbox) {
  const card = checkbox?.closest(".service-checkbox-item");
  if (card) card.classList.toggle("is-selected", checkbox.checked);
}

function getSelectedDuration() {
  return getSelectedServices().reduce((sum, service) => {
    return sum + Number(service.duration || 0);
  }, 0);
}

function updateBookingProgress() {
  const selected = getSelectedServices();
  const serviceNames = selected.map(service => service.name).join(", ");
  const totalMinutes = getSelectedDuration();
  const nameInput = document.querySelector('input[name="client_name"]');
  const phoneInput = document.querySelector('input[name="client_phone"]');
  const dateInput = document.querySelector('input[name="appointment_date"]');
  const timeSelect = document.querySelector('select[name="appointment_time"]');
  const miniSummary = document.getElementById("bookingMiniSummary");
  const steps = Array.from(document.querySelectorAll(".booking-step"));

  const hasService = selected.length > 0;
  const hasDetails = Boolean(nameInput?.value.trim() && phoneInput?.value.trim());
  const hasDateTime = Boolean(dateInput?.value && timeSelect?.value && !timeSelect.disabled);
  const currentStep = hasService ? (hasDetails ? (hasDateTime ? "confirm" : "datetime") : "details") : "service";
  const stepOrder = ["service", "details", "datetime", "confirm"];
  const currentIndex = stepOrder.indexOf(currentStep);

  steps.forEach(step => {
    const stepIndex = stepOrder.indexOf(step.dataset.step);
    const isActive = step.dataset.step === currentStep;
    step.classList.toggle("is-active", isActive);
    step.classList.toggle("is-complete", stepIndex > -1 && stepIndex < currentIndex);
    step.setAttribute("aria-current", isActive ? "step" : "false");
  });

  if (miniSummary) {
    miniSummary.innerHTML = `
      <span><b>Services</b> ${serviceNames || "Select one or more services"}</span>
      <span><b>Duration</b> ${totalMinutes ? `${totalMinutes} minutes` : "Not selected yet"}</span>
      <span><b>Date</b> ${dateInput?.value || "Choose a date"}</span>
      <span><b>Time</b> ${timeSelect?.value || "Choose a time"}</span>
    `;
  }
}

function updateBookingSummary() {
  const selected = getSelectedServices();
  const hiddenServiceInput = document.getElementById("serviceSelect");
  const summary = document.getElementById("bookingSummary");

  if (!hiddenServiceInput || !summary) return;

  if (!selected.length) {
    primaryServiceId = null;
    hiddenServiceInput.value = "";
    summary.textContent = "Select one or more services.";
    updateBookingProgress();
    updateAvailableTimes();
    return;
  }

  const primaryService = getPrimaryService(selected);
  primaryServiceId = String(primaryService.id);
  hiddenServiceInput.value = primaryService.id;

  const totalMinutes = getSelectedDuration();

  const serviceNames = selected.map(service => service.name).join(", ");

  const primaryLine = document.createElement("div");
  const primaryLabel = document.createElement("strong");
  primaryLabel.textContent = "Primary service: ";
  primaryLine.append(primaryLabel, primaryService.name);

  const selectedLine = document.createElement("div");
  const selectedLabel = document.createElement("strong");
  selectedLabel.textContent = "Selected services: ";
  selectedLine.append(selectedLabel, serviceNames);

  const durationLine = document.createElement("div");
  const durationLabel = document.createElement("strong");
  durationLabel.textContent = "Total estimated time: ";
  durationLine.append(durationLabel, `${totalMinutes} minutes`);

  summary.replaceChildren(primaryLine, selectedLine, durationLine);
  updateBookingProgress();

  updateAvailableTimes();
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
    updateBookingProgress();
    return;
  }

  timeSelect.disabled = false;

  availableTimes.forEach(time => {
    const option = document.createElement("option");
    option.value = time;
    option.textContent = time;
    timeSelect.appendChild(option);
  });

  updateBookingProgress();
}

function isWeekend(dateValue) {
  const date = new Date(dateValue + "T00:00:00");
  const day = date.getDay();
  return day === 0 || day === 6;
}

async function updateAvailableTimes() {
  const dateInput = document.querySelector('input[name="appointment_date"]');
  const message = document.getElementById("bookingMessage");
  const requestId = ++availabilityRequestId;

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
    const params = new URLSearchParams({ date: dateInput.value });
    const selectedDuration = getSelectedDuration();

    if (selectedDuration) {
      params.set("duration_minutes", String(selectedDuration));
    }

    const response = await fetch(`/api/booked-times?${params.toString()}`);
    const data = await response.json();

    if (requestId !== availabilityRequestId) return;

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

    const availableTimes = Array.isArray(data.availableTimes)
      ? data.availableTimes
      : allTimes.filter(time => !(data.bookedTimes || []).includes(time));

    renderTimeOptions(availableTimes);

    if (!availableTimes.length && message) {
      message.textContent = "No times are available for this date. Please choose another date.";
    }
  } catch (error) {
    if (requestId === availabilityRequestId) {
      renderTimeOptions(allTimes);
    }
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

  dateInput.addEventListener("change", () => {
    updateBookingProgress();
    updateAvailableTimes();
  });
  renderTimeOptions(allTimes);
}

function selectServiceForBooking(serviceId, serviceName) {
  const checkbox = document.querySelector(`.service-choice[value="${serviceId}"]`);
  const bookSection = document.getElementById("book");
  const message = document.getElementById("bookingMessage");

  if (checkbox) {
    primaryServiceId = String(serviceId);
    checkbox.checked = true;
    syncServiceChoiceCard(checkbox);
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

function whatsappBookingUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const whatsappPhone = digits.length === 10 ? `1${digits}` : digits;
  const text = "Hi PinkSpa! I would like to ask about booking an appointment.";
  return `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}`;
}

function ensureBookingConfirmationModal() {
  let modal = document.getElementById("bookingConfirmation");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "bookingConfirmation";
  modal.className = "booking-confirmation";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "bookingConfirmationTitle");
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="booking-confirmation-card">
      <button id="bookingConfirmationClose" class="booking-confirmation-close" type="button" aria-label="Close confirmation">×</button>
      <div class="confirmation-mark">
        <img src="/images/PinkSpa.png" alt="" width="1254" height="1254" loading="lazy" decoding="async" />
        <span>✓</span>
        <i></i>
        <i></i>
        <i></i>
      </div>
      <p class="eyebrow dark">PinkSpa Booking</p>
      <h2 id="bookingConfirmationTitle">Your booking request was received</h2>
      <p class="confirmation-message">Thank you for choosing PinkSpa. We’ll review your request and follow up shortly.</p>
      <p class="confirmation-welcome">We’re excited to welcome you to PinkSpa!</p>

      <div class="confirmation-summary" aria-label="Appointment details summary">
        <div>
          <span><b>💅</b> Service</span>
          <strong id="confirmationService">PinkSpa Service</strong>
        </div>
        <div>
          <span><b>📅</b> Date</span>
          <strong id="confirmationDate">Selected date</strong>
        </div>
        <div>
          <span><b>⏰</b> Time</span>
          <strong id="confirmationTime">Selected time</strong>
        </div>
        <div>
          <span><b>⏳</b> Duration</span>
          <strong id="confirmationDuration">Estimated duration</strong>
        </div>
        <div>
          <span><b>👤</b> Client</span>
          <strong id="confirmationClient">Client name</strong>
        </div>
      </div>

      <div class="confirmation-actions">
        <a class="btn primary" href="#status" id="confirmationStatus">Check Booking Status</a>
        <button class="btn ghost" id="confirmationBookAnother" type="button">Book Another Appointment</button>
        <a class="btn ghost" id="confirmationWhatsapp" href="https://wa.me/17863036126?text=Hi%20PinkSpa%21%20I%20would%20like%20to%20ask%20about%20booking%20an%20appointment." target="_blank" rel="noopener noreferrer">WhatsApp PinkSpa</a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function runBookingConfetti(modal) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !modal) return;

  const burst = document.createElement("div");
  burst.className = "confirmation-confetti";
  const colors = ["#ff5f93", "#b71956", "#d4974d", "#58b887", "#ffd5e3"];

  for (let index = 0; index < 18; index += 1) {
    const piece = document.createElement("span");
    piece.style.setProperty("--confetti-x", `${Math.cos(index) * (70 + (index % 4) * 18)}px`);
    piece.style.setProperty("--confetti-y", `${Math.sin(index * 1.7) * 74 - 38}px`);
    piece.style.setProperty("--confetti-color", colors[index % colors.length]);
    piece.style.setProperty("--confetti-delay", `${index * 18}ms`);
    burst.appendChild(piece);
  }

  modal.appendChild(burst);
  window.setTimeout(() => burst.remove(), 1100);
}

function setupBookingConfirmation() {
  const modal = ensureBookingConfirmationModal();
  if (!modal) return null;

  const closeButton = document.getElementById("bookingConfirmationClose");
  const statusButton = document.getElementById("confirmationStatus");
  const bookAnotherButton = document.getElementById("confirmationBookAnother");
  const fields = {
    service: document.getElementById("confirmationService"),
    date: document.getElementById("confirmationDate"),
    time: document.getElementById("confirmationTime"),
    duration: document.getElementById("confirmationDuration"),
    client: document.getElementById("confirmationClient")
  };

  const close = () => {
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  const open = details => {
    if (fields.service) fields.service.textContent = details.service || "PinkSpa Service";
    if (fields.date) fields.date.textContent = details.date || "Selected date";
    if (fields.time) fields.time.textContent = details.time || "Selected time";
    if (fields.duration) fields.duration.textContent = details.duration || "Estimated duration";
    if (fields.client) fields.client.textContent = details.client || "Client";

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    runBookingConfetti(modal);
    closeButton?.focus();
  };

  closeButton?.addEventListener("click", close);

  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });

  statusButton?.addEventListener("click", close);

  bookAnotherButton?.addEventListener("click", () => {
    close();
    document.getElementById("book")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) close();
  });

  return { open, close };
}

const bookingConfirmation = setupBookingConfirmation();

async function loadSettings() {
  const cityText = document.getElementById("cityText");
  const businessPhoneText = document.getElementById("businessPhoneText");
  const businessHoursText = document.getElementById("businessHoursText");
  const phoneLink = document.getElementById("phoneLink");
  const ctaPhone = document.getElementById("ctaPhone");
  const footerPhone = document.getElementById("footerPhone");
  const footerWhatsapp = document.getElementById("footerWhatsapp");
  const footerLocation = document.getElementById("footerLocation");
  const footerHours = document.getElementById("footerHours");
  const confirmationWhatsapp = document.getElementById("confirmationWhatsapp");
  const message = document.getElementById("bookingMessage");

  try {
    const response = await fetch("/api/settings");
    const settings = await response.json().catch(() => null);

    if (!response.ok || !settings) {
      throw new Error(settings?.error || `Settings request failed with status ${response.status}.`);
    }

    if (cityText) cityText.textContent = "📍 " + settings.city;
    if (businessPhoneText) businessPhoneText.textContent = "☎ " + settings.phone;
    if (businessHoursText) businessHoursText.textContent = "🕘 " + settings.hours;
    if (footerLocation) footerLocation.textContent = settings.city;
    if (footerHours) footerHours.textContent = settings.hours;

    if (phoneLink) {
      phoneLink.href = whatsappBookingUrl(settings.phone);
      phoneLink.textContent = "WhatsApp";
      phoneLink.target = "_blank";
      phoneLink.rel = "noopener noreferrer";
    }

    if (ctaPhone) {
      ctaPhone.href = "tel:" + settings.phone;
    }

    if (footerPhone) {
      footerPhone.href = "tel:" + settings.phone;
      footerPhone.textContent = settings.phone;
    }

    if (footerWhatsapp) {
      footerWhatsapp.href = whatsappBookingUrl(settings.phone);
    }

    if (confirmationWhatsapp) {
      confirmationWhatsapp.href = whatsappBookingUrl(settings.phone);
    }
  } catch (error) {
    console.error("Unable to load business settings:", error);
    if (message && !message.textContent) {
      message.textContent = "We couldn't refresh PinkSpa's business details. The contact information shown may be outdated. Please try again later.";
    }
  }
}

async function loadServices() {
  const grid = document.getElementById("serviceGrid");
  const hiddenServiceInput = document.getElementById("serviceSelect");
  const checkboxList = document.getElementById("serviceCheckboxList");
  const summary = document.getElementById("bookingSummary");
  const message = document.getElementById("bookingMessage");

  if (!grid || !hiddenServiceInput || !checkboxList) return;

  let services;

  try {
    const response = await fetch("/api/services");
    services = await response.json().catch(() => null);

    if (!response.ok || !Array.isArray(services)) {
      throw new Error(services?.error || `Services request failed with status ${response.status}.`);
    }
  } catch (error) {
    console.error("Unable to load services:", error);
    allServices = [];
    hiddenServiceInput.value = "";

    const serviceError = document.createElement("p");
    serviceError.className = "message";
    serviceError.textContent = "We couldn't load PinkSpa services. Please refresh the page or try again later.";
    grid.replaceChildren(serviceError);

    checkboxList.textContent = "Services are temporarily unavailable.";
    if (summary) summary.textContent = "Services are temporarily unavailable.";
    if (message) message.textContent = "We couldn't load the service list, so booking is temporarily unavailable. Please refresh the page or try again later.";
    return;
  }

  allServices = services;
  primaryServiceId = null;
  activeServiceCategory = "all";
  servicePageIndex = 0;
  checkboxList.innerHTML = "";

  services.forEach(service => {
    const serviceOption = document.createElement("label");
    serviceOption.className = "service-checkbox-item";
    const checkboxId = `service-choice-${service.id}`;
    serviceOption.htmlFor = checkboxId;

    serviceOption.innerHTML = `
      <input
        id="${checkboxId}"
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

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        primaryServiceId = String(checkbox.value);
      } else if (String(primaryServiceId) === String(checkbox.value)) {
        primaryServiceId = null;
      }

      syncServiceChoiceCard(checkbox);
      updateBookingSummary();
    });

    checkboxList.appendChild(serviceOption);
  });

  renderServiceCategoryFilters();
  renderServiceCards();
  updateBookingSummary();
}

const bookingForm = document.getElementById("bookingForm");

if (bookingForm) {
  bookingForm.addEventListener("input", event => {
    if (event.target.matches('input[name="client_name"], input[name="client_phone"], input[name="appointment_date"], select[name="appointment_time"]')) {
      updateBookingProgress();
    }
  });

  bookingForm.addEventListener("change", event => {
    if (event.target.matches('input[name="client_name"], input[name="client_phone"], input[name="appointment_date"], select[name="appointment_time"]')) {
      updateBookingProgress();
    }
  });

  bookingForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = document.getElementById("bookingMessage");
    const selectedServices = getSelectedServices();
    const primaryService = getPrimaryService(selectedServices);

    if (!selectedServices.length || !primaryService) {
      message.textContent = "Please select at least one service.";
      return;
    }

    primaryServiceId = String(primaryService.id);
    updateBookingSummary();

    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());
    const inspirationPhoto = form.get("inspiration_image");
    const clientNotes = String(payload.notes || "").trim();

    if (inspirationPhoto instanceof File && inspirationPhoto.size > 0) {
      const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];

      if (!allowedImageTypes.includes(inspirationPhoto.type)) {
        message.textContent = "Please choose a JPEG, PNG, or WebP inspiration photo.";
        return;
      }

      if (inspirationPhoto.size > 5 * 1024 * 1024) {
        message.textContent = "Your inspiration photo must be 5MB or smaller.";
        return;
      }
    }

    payload.service_id = primaryService.id;

    const selectedServiceText = selectedServices
      .map(service => `${service.name} (${service.duration} min)`)
      .join(", ");

    const totalMinutes = selectedServices.reduce((sum, service) => {
      return sum + Number(service.duration || 0);
    }, 0);
payload.duration_minutes = totalMinutes;
    const confirmationDetails = {
      service: selectedServiceText,
      date: payload.appointment_date,
      time: payload.appointment_time,
      duration: `${totalMinutes} minutes`,
      client: payload.client_name
    };
    
    payload.notes = `
Selected Services: ${selectedServiceText}
Total Estimated Time: ${totalMinutes} minutes

Client Notes:
${payload.notes || "No notes added."}
`;

    form.set("service_id", String(payload.service_id));
    form.set("selected_service_ids", selectedServices.map(service => service.id).join(","));
    form.set("duration_minutes", String(payload.duration_minutes));
    form.set("client_notes", clientNotes);
    form.set("notes", payload.notes);

    message.textContent = selectedServices.length > 1
      ? `Submitting ${primaryService.name} as the primary service with ${selectedServices.length - 1} additional service${selectedServices.length === 2 ? "" : "s"}.`
      : `Submitting your appointment for ${primaryService.name}.`;

    if (isWeekend(payload.appointment_date)) {
      message.textContent = "PinkSpa is closed on Saturdays and Sundays. Please choose Monday through Friday.";
      return;
    }

    if (!payload.appointment_time) {
      message.textContent = "Please choose an available time.";
      return;
    }

    setAppLoading(true);

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        body: form
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage = data.error || "We couldn't send your appointment request. Please review your information and try again.";
        await updateAvailableTimes();
        message.textContent = errorMessage;
        return;
      }

      e.target.reset();

      document.querySelectorAll(".service-choice").forEach(input => {
        input.checked = false;
        syncServiceChoiceCard(input);
      });

      primaryServiceId = null;
      updateBookingSummary();
      renderTimeOptions(allTimes);

      message.textContent = "Your appointment request was sent to PinkSpa. You can check your appointment status using your phone number.";
      bookingConfirmation?.open(confirmationDetails);
    } catch (error) {
      console.error("Unable to submit appointment:", error);
      message.textContent = "We couldn't send your appointment request. Please check your connection and try again. Your information is still in the form.";
    } finally {
      setAppLoading(false);
    }
  });
}

const statusForm = document.getElementById("statusForm");

if (statusForm) {
  statusForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const phone = new FormData(e.target).get("phone");
    const resultBox = document.getElementById("statusResult");

    resultBox.innerHTML = "Checking appointment status...";

    try {
      const response = await fetch(`/api/appointment-status?phone=${encodeURIComponent(phone)}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        resultBox.textContent = data.error || "We couldn't check your appointment status right now. Please try again.";
        return;
      }

      if (!data.appointments || data.appointments.length === 0) {
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
    } catch (error) {
      console.error("Unable to check appointment status:", error);
      resultBox.textContent = "We couldn't check your appointment status. Please check your connection and try again.";
    }
  });
}

loadSettings();
loadServices();
setupBookingDateRules();
window.addEventListener("resize", () => {
  if (!allServices.length) return;
  renderServiceCards();
}, { passive: true });
function setupGalleryLightbox() {
  const galleryImages = Array.from(document.querySelectorAll(".gallery-grid img"));
  const lightbox = document.getElementById("galleryLightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const closeBtn = document.getElementById("lightboxClose");
  const prevBtn = document.getElementById("lightboxPrev");
  const nextBtn = document.getElementById("lightboxNext");

  if (!galleryImages.length || !lightbox || !lightboxImage) return;

  let currentIndex = 0;
  let touchStartX = 0;
  let touchEndX = 0;

  function openLightbox(index) {
    currentIndex = index;
    lightboxImage.src = galleryImages[currentIndex].src;
    lightbox.classList.add("active");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("active");
    lightbox.setAttribute("aria-hidden", "true");
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

  lightbox.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  });

  lightbox.addEventListener("touchend", (e) => {
    touchEndX = e.changedTouches[0].screenX;

    if (touchStartX - touchEndX > 50) {
      showNext();
    }

    if (touchEndX - touchStartX > 50) {
      showPrev();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("active")) return;

    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") showPrev();
    if (e.key === "ArrowRight") showNext();
  });
}

setupGalleryLightbox();
function setupReviewSlider() {
  const reviewGrid = document.querySelector(".reviews-grid");
  const reviewCards = Array.from(document.querySelectorAll(".reviews-grid .review-card"));
  const prevButton = document.getElementById("reviewPrev");
  const nextButton = document.getElementById("reviewNext");
  const dotsContainer = document.getElementById("reviewDots");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reviewGrid || reviewCards.length === 0) return;

  let index = 0;
  let autoRotateTimer = null;
  let interactionPaused = false;

  const updateCarousel = () => {
    reviewGrid.style.transform = `translateX(-${index * 100}%)`;

    if (dotsContainer) {
      Array.from(dotsContainer.children).forEach((dot, dotIndex) => {
        const isActive = dotIndex === index;
        dot.classList.toggle("is-active", isActive);
        dot.setAttribute("aria-current", isActive ? "true" : "false");
      });
    }
  };

  const goToReview = nextIndex => {
    index = (nextIndex + reviewCards.length) % reviewCards.length;
    updateCarousel();
  };

  const pauseAutoRotate = () => {
    interactionPaused = true;
    window.clearInterval(autoRotateTimer);
  };

  if (dotsContainer) {
    dotsContainer.replaceChildren(...reviewCards.map((_, dotIndex) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "review-dot";
      dot.setAttribute("aria-label", `Show testimonial ${dotIndex + 1}`);
      dot.addEventListener("click", () => {
        pauseAutoRotate();
        goToReview(dotIndex);
      });
      return dot;
    }));
  }

  if (prevButton) {
    prevButton.addEventListener("click", () => {
      pauseAutoRotate();
      goToReview(index - 1);
    });
  }

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      pauseAutoRotate();
      goToReview(index + 1);
    });
  }

  updateCarousel();

  if (reduceMotion || reviewCards.length < 2) return;

  autoRotateTimer = window.setInterval(() => {
    if (document.hidden || interactionPaused) return;

    goToReview(index + 1);
  }, 7000);
}

async function loadApprovedReviews() {
  const reviewsGrid = document.querySelector(".reviews-grid");
  if (!reviewsGrid) return;

  try {
    const response = await fetch("/api/reviews");
    const data = await response.json();
    const reviews = data.reviews || [];

    if (!reviews.length) return;

    reviewsGrid.innerHTML = reviews.map(review => `
      <div class="review-card">
        <div class="stars">${"★".repeat(review.rating)}</div>
        <p>"${review.review_text}"</p>
        <strong>- ${review.client_name}</strong>
      </div>
    `).join("");

    observeRevealElements(reviewsGrid.querySelectorAll(".review-card"));
  } catch (error) {
    console.error("Error loading reviews:", error);
  }
}

setupAppLoadingOverlay();
setupScrollReveal();
setupStatsCounters();
setupGlassNavigation();
loadApprovedReviews().finally(setupReviewSlider);
