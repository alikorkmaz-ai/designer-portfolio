let siteData = null;
let currentLocale = localStorage.getItem("portfolio_locale") || "tr";
let currentFilter = "__all__";
let activeGallery = [];
let activeGalleryIndex = 0;
let activeProject = null;

const dialog = document.getElementById("projectDialog");
const LABELS = {
  tr: {
    navWork: "Projeler",
    navAbout: "Hakkımda",
    navContact: "İletişim",
    workKicker: "Arşiv",
    workTitle: "Seçili İşler",
    aboutKicker: "Profil",
    aboutTitle: "Hakkımda",
    contactKicker: "Ulaşılabilirlik",
    contactTitle: "İletişim",
    all: "Tümü",
    featured: "Öne çıkan proje",
    open: "Projeyi Gör",
    practice: "Alan",
    archive: "Arşiv",
    disciplines: "Disiplinler",
    years: "Yıllar",
    publishedWorks: "yayında",
    categories: "kategori",
    projects: "proje",
    selected: "Seçili",
    email: "E-posta"
  },
  en: {
    navWork: "Work",
    navAbout: "About",
    navContact: "Contact",
    workKicker: "Archive",
    workTitle: "Selected Work",
    aboutKicker: "Profile",
    aboutTitle: "About",
    contactKicker: "Availability",
    contactTitle: "Contact",
    all: "All",
    featured: "Featured project",
    open: "View Project",
    practice: "Practice",
    archive: "Archive",
    disciplines: "Disciplines",
    years: "Years",
    publishedWorks: "published works",
    categories: "categories",
    projects: "projects",
    selected: "Selected",
    email: "Email"
  }
};

document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
document.querySelector(".gallery-prev").addEventListener("click", () => moveGallery(-1));
document.querySelector(".gallery-next").addEventListener("click", () => moveGallery(1));
document.addEventListener("keydown", handleGalleryKeys);
document.querySelectorAll("[data-locale]").forEach((button) => {
  button.addEventListener("click", () => setLocale(button.dataset.locale));
});

setupReveal();
loadSite();

async function loadSite() {
  const response = await fetch("/api/site");
  siteData = await response.json();
  renderSite();
}

function renderSite() {
  document.documentElement.lang = currentLocale;
  renderLanguageButtons();
  renderStaticLabels();
  renderProfile(localizedProfile());
  renderStudioStrip(siteData);
  renderFeatured(localizedProjects());
  renderFilters(siteData.projects);
  renderProjects(siteData.projects);
  observeRevealItems();
}

function renderProfile(profile) {
  document.title = `${profile.name} Portfolio`;
  document.getElementById("name").textContent = profile.name;
  document.getElementById("role").textContent = `${profile.role} · ${profile.location}`;
  document.getElementById("intro").textContent = profile.intro;
  document.getElementById("location").textContent = profile.location;
  document.getElementById("aboutText").textContent = profile.about;
  document.getElementById("emailLink").href = `mailto:${profile.email}`;
  document.getElementById("emailLink").textContent = profile.email || t("email");
  document.getElementById("instagramLink").href = profile.instagram;
  document.getElementById("linkedinLink").href = profile.linkedin;
}

function renderStudioStrip(data) {
  const profile = localizedProfile();
  const published = localizedProjects().filter((project) => project.published);
  const categories = new Set(published.map((project) => project.category));
  const years = published.map((project) => Number(project.year)).filter(Boolean);
  const yearRange = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : t("selected");
  document.getElementById("studioStrip").innerHTML = `
    <div><span>${t("practice")}</span><strong>${escapeHtml(profile.role || "Graphic Design")}</strong></div>
    <div><span>${t("archive")}</span><strong>${published.length} ${t("publishedWorks")}</strong></div>
    <div><span>${t("disciplines")}</span><strong>${categories.size} ${t("categories")}</strong></div>
    <div><span>${t("years")}</span><strong>${yearRange}</strong></div>
  `;
}

function renderFeatured(projects) {
  const featured = projects.find((project) => project.featured && project.published)
    || projects.find((project) => project.published);
  if (!featured) return;
  document.getElementById("featured").innerHTML = `
    <button class="featured-card reveal" type="button" data-project="${featured.id}" data-open-label="${t("open")}">
      <span class="featured-label">${t("featured")}</span>
      <img src="${featured.cover}" alt="${escapeHtml(featured.title)}">
      <span class="featured-copy">
        <span>${escapeHtml(featured.category)} · ${escapeHtml(featured.year)}</span>
        <strong>${escapeHtml(featured.title)}</strong>
        <em>${escapeHtml(featured.summary)}</em>
      </span>
    </button>
  `;
  document.querySelector(".featured-card").addEventListener("click", () => openProject(featured.id));
}

function renderFilters(projects) {
  const published = projects.filter((project) => project.published);
  const categories = [{ key: "__all__", label: t("all") }];
  [...new Set(published.map((project) => project.category))].forEach((category) => {
    const sampleProject = published.find((project) => project.category === category);
    categories.push({ key: category, label: localizedProject(sampleProject).category });
  });
  document.getElementById("projectCount").textContent = `${published.length} ${t("projects")}`;
  document.getElementById("filters").innerHTML = categories
    .map((category) => `<button type="button" class="${category.key === currentFilter ? "active" : ""}" data-filter="${escapeHtml(category.key)}">${escapeHtml(category.label)}</button>`)
    .join("");
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;
      renderFilters(siteData.projects);
      renderProjects(siteData.projects);
    });
  });
}

function renderProjects(projects) {
  const visible = projects
    .filter((project) => project.published)
    .filter((project) => currentFilter === "__all__" || project.category === currentFilter)
    .map((project) => localizedProject(project));
  document.getElementById("projectGrid").innerHTML = visible
    .map((project, index) => projectCard(project, index))
    .join("");
  document.querySelectorAll("[data-project]").forEach((card) => {
    card.addEventListener("click", () => openProject(card.dataset.project));
  });
}

function projectCard(project, index) {
  return `
    <article class="project-card reveal ${index % 5 === 0 ? "wide" : ""}" data-project="${project.id}" style="--delay: ${Math.min(index * 45, 220)}ms">
      <div class="project-image">
        <img src="${project.cover}" alt="${escapeHtml(project.title)}">
        <span>${t("open")}</span>
      </div>
      <div class="project-info">
        <div class="project-meta"><span>${String(index + 1).padStart(2, "0")} · ${escapeHtml(project.category)}</span><span>${escapeHtml(project.year)}</span></div>
        <h3>${escapeHtml(project.title)}</h3>
        <p>${escapeHtml(project.summary)}</p>
      </div>
    </article>
  `;
}

function openProject(id) {
  const sourceProject = siteData.projects.find((item) => item.id === id);
  const project = sourceProject ? localizedProject(sourceProject) : null;
  if (!project) return;
  activeProject = project;
  activeGallery = projectGallery(project);
  activeGalleryIndex = 0;
  renderDialogImage(project);
  document.getElementById("dialogMeta").textContent = `${project.category} · ${project.client} · ${project.year}`;
  document.getElementById("dialogTitle").textContent = project.title;
  document.getElementById("dialogDescription").textContent = project.description;
  dialog.showModal();
}

function setLocale(locale) {
  if (!LABELS[locale] || locale === currentLocale) return;
  currentLocale = locale;
  localStorage.setItem("portfolio_locale", locale);
  currentFilter = "__all__";
  renderSite();
}

function renderLanguageButtons() {
  document.querySelectorAll("[data-locale]").forEach((button) => {
    const isActive = button.dataset.locale === currentLocale;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderStaticLabels() {
  ["navWork", "navAbout", "navContact", "workKicker", "workTitle", "aboutKicker", "aboutTitle", "contactKicker", "contactTitle"].forEach((id) => {
    document.getElementById(id).textContent = t(id);
  });
}

function localizedProfile() {
  return {
    ...siteData.profile,
    ...compactTranslation(siteData.translations?.[currentLocale]?.profile || {})
  };
}

function localizedProjects() {
  return siteData.projects.map((project) => localizedProject(project));
}

function localizedProject(project) {
  return {
    ...project,
    ...compactTranslation(siteData.translations?.[currentLocale]?.projects?.[project.id] || {})
  };
}

function t(key) {
  return LABELS[currentLocale][key] || LABELS.tr[key] || key;
}

function compactTranslation(translation) {
  return Object.fromEntries(
    Object.entries(translation).filter(([, value]) => String(value || "").trim())
  );
}

function projectGallery(project) {
  const gallery = Array.isArray(project.gallery) ? project.gallery.filter(Boolean) : [];
  return gallery.length ? gallery : [project.cover];
}

function moveGallery(direction) {
  if (activeGallery.length < 2) return;
  activeGalleryIndex = (activeGalleryIndex + direction + activeGallery.length) % activeGallery.length;
  renderDialogImage(activeProject || {});
}

function handleGalleryKeys(event) {
  if (!dialog.open) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveGallery(1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveGallery(-1);
  }
}

function renderDialogImage(project) {
  const image = document.getElementById("dialogImage");
  const counter = document.getElementById("galleryCounter");
  const controls = document.querySelectorAll(".gallery-nav");
  image.classList.remove("is-loaded");
  image.src = activeGallery[activeGalleryIndex];
  image.alt = project.title || "Project image";
  image.onload = () => image.classList.add("is-loaded");
  counter.textContent = `${activeGalleryIndex + 1} / ${activeGallery.length}`;
  controls.forEach((control) => control.classList.toggle("hidden", activeGallery.length < 2));
  counter.classList.toggle("hidden", activeGallery.length < 2);
}

function setupReveal() {
  if (!("IntersectionObserver" in window)) {
    document.documentElement.classList.add("no-reveal");
    return;
  }
  window.revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      window.revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.16 });
}

function observeRevealItems() {
  document.querySelectorAll(".reveal, .studio-strip, .about, .contact").forEach((item) => {
    if (item.dataset.observed) return;
    item.dataset.observed = "true";
    if (window.revealObserver) {
      window.revealObserver.observe(item);
    } else {
      item.classList.add("is-visible");
    }
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
