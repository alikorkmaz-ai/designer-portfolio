let site = null;
let editingId = "";

const loginPanel = document.getElementById("loginPanel");
const adminApp = document.getElementById("adminApp");
const profileForm = document.getElementById("profileForm");
const projectForm = document.getElementById("projectForm");
const coverInput = document.getElementById("coverInput");
const coverPreview = document.getElementById("coverPreview");
const galleryInput = document.getElementById("galleryInput");
const galleryPreview = document.getElementById("galleryPreview");

document.getElementById("loginForm").addEventListener("submit", login);
document.getElementById("logoutButton").addEventListener("click", logout);
document.getElementById("newProjectButton").addEventListener("click", clearProjectForm);
profileForm.addEventListener("submit", saveProfile);
projectForm.addEventListener("submit", saveProject);
coverInput.addEventListener("change", uploadCover);
galleryInput.addEventListener("change", uploadGallery);

checkSession();

async function checkSession() {
  const response = await fetch("/api/session");
  const session = await response.json();
  if (session.authenticated) {
    await loadAdmin();
    return;
  }
  loginPanel.classList.remove("hidden");
  adminApp.classList.add("hidden");
}

async function loadAdmin() {
  const response = await fetch("/api/site");
  site = await response.json();
  showAdmin();
}

async function login(event) {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get("password");
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!response.ok) {
    alert("Şifre hatalı.");
    return;
  }
  await loadAdmin();
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
}

function showAdmin() {
  loginPanel.classList.add("hidden");
  adminApp.classList.remove("hidden");
  fillProfileForm();
  renderProjectList();
}

function fillProfileForm() {
  for (const [key, value] of Object.entries(site.profile)) {
    if (profileForm.elements[key]) profileForm.elements[key].value = value;
  }
  const englishProfile = site.translations?.en?.profile || {};
  profileForm.elements.en_role.value = englishProfile.role || "";
  profileForm.elements.en_intro.value = englishProfile.intro || "";
  profileForm.elements.en_about.value = englishProfile.about || "";
}

async function saveProfile(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  setBusy(submitButton, true);
  const form = new FormData(profileForm);
  const profile = {
    name: form.get("name"),
    role: form.get("role"),
    location: form.get("location"),
    intro: form.get("intro"),
    about: form.get("about"),
    email: form.get("email"),
    instagram: form.get("instagram"),
    linkedin: form.get("linkedin")
  };
  const translation = {
    role: form.get("en_role"),
    intro: form.get("en_intro"),
    about: form.get("en_about")
  };
  const response = await fetch("/api/site", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, translation })
  });
  if (response.status === 401) {
    setBusy(submitButton, false);
    return showLoginExpired();
  }
  if (!response.ok) {
    setBusy(submitButton, false);
    return showError(response, "Profil kaydedilemedi.");
  }
  site = await response.json();
  setBusy(submitButton, false);
  alert("Profile saved.");
}

async function uploadCover() {
  const file = coverInput.files[0];
  if (!file) return;
  const result = await uploadImage(file);
  projectForm.elements.cover.value = result.url;
  coverPreview.src = result.url;
  coverPreview.classList.remove("hidden");
  const gallery = currentGallery();
  if (!gallery.includes(result.url)) {
    setGallery([result.url, ...gallery]);
  }
}

async function uploadGallery() {
  const files = Array.from(galleryInput.files || []);
  if (!files.length) return;
  const uploaded = [];
  for (const file of files) {
    const result = await uploadImage(file);
    uploaded.push(result.url);
  }
  setGallery([...currentGallery(), ...uploaded]);
  galleryInput.value = "";
}

async function uploadImage(file) {
  const dataUrl = await readFile(file);
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, dataUrl })
  });
  if (response.status === 401) {
    showLoginExpired();
    throw new Error("Unauthorized");
  }
  return response.json();
}

async function saveProject(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  setBusy(submitButton, true);
  const data = formProjectData();
  const url = editingId ? `/api/projects/${editingId}` : "/api/projects";
  const method = editingId ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (response.status === 401) {
    setBusy(submitButton, false);
    return showLoginExpired();
  }
  if (!response.ok) {
    setBusy(submitButton, false);
    return showError(response, "Proje kaydedilemedi.");
  }
  await refreshSite();
  clearProjectForm();
  setBusy(submitButton, false);
  alert("Project saved.");
}

function formProjectData() {
  const form = new FormData(projectForm);
  const gallery = currentGallery();
  const cover = form.get("cover") || gallery[0] || "";
  return {
    id: form.get("id"),
    title: form.get("title"),
    category: form.get("category"),
    year: form.get("year"),
    client: form.get("client"),
    summary: form.get("summary"),
    description: form.get("description"),
    cover,
    gallery,
    translation: {
      title: form.get("en_title"),
      category: form.get("en_category"),
      summary: form.get("en_summary"),
      description: form.get("en_description")
    },
    order: Number(form.get("order") || 100),
    featured: form.get("featured") === "on",
    published: form.get("published") === "on"
  };
}

async function refreshSite() {
  const response = await fetch("/api/site");
  site = await response.json();
  renderProjectList();
}

function renderProjectList() {
  document.getElementById("adminProjects").innerHTML = site.projects.map((project) => `
    <article class="admin-project-row">
      <img src="${project.cover}" alt="">
      <div>
        <strong>${escapeHtml(project.title)}</strong>
        <p>${escapeHtml(project.category)} · ${escapeHtml(project.year)} · ${projectGallery(project).length} images · ${project.published ? "Published" : "Draft"}</p>
      </div>
      <div class="admin-actions">
        <button class="secondary-button" type="button" data-edit="${project.id}">Edit</button>
        <button class="secondary-button" type="button" data-delete="${project.id}">Delete</button>
      </div>
    </article>
  `).join("");
  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editProject(button.dataset.edit));
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteProject(button.dataset.delete));
  });
}

function editProject(id) {
  const project = site.projects.find((item) => item.id === id);
  if (!project) return;
  editingId = id;
  document.getElementById("projectFormTitle").textContent = "Edit Project";
  for (const [key, value] of Object.entries(project)) {
    if (!projectForm.elements[key]) continue;
    if (projectForm.elements[key].type === "checkbox") {
      projectForm.elements[key].checked = Boolean(value);
    } else {
      projectForm.elements[key].value = value;
    }
  }
  const translation = site.translations?.en?.projects?.[id] || {};
  projectForm.elements.en_title.value = translation.title || "";
  projectForm.elements.en_category.value = translation.category || "";
  projectForm.elements.en_summary.value = translation.summary || "";
  projectForm.elements.en_description.value = translation.description || "";
  coverPreview.src = project.cover;
  coverPreview.classList.remove("hidden");
  setGallery(projectGallery(project));
  projectForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteProject(id) {
  if (!confirm("Projeyi silmek istiyor musun?")) return;
  const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (response.status === 401) return showLoginExpired();
  await refreshSite();
}

function clearProjectForm() {
  editingId = "";
  projectForm.reset();
  projectForm.elements.id.value = "";
  projectForm.elements.cover.value = "";
  projectForm.elements.gallery.value = "";
  projectForm.elements.order.value = "100";
  projectForm.elements.published.checked = true;
  coverPreview.classList.add("hidden");
  renderGalleryPreview();
  document.getElementById("projectFormTitle").textContent = "New Project";
}

function currentGallery() {
  try {
    const gallery = JSON.parse(projectForm.elements.gallery.value || "[]");
    return Array.isArray(gallery) ? gallery.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function setGallery(gallery) {
  const uniqueGallery = [...new Set(gallery.filter(Boolean))];
  projectForm.elements.gallery.value = JSON.stringify(uniqueGallery);
  renderGalleryPreview();
}

function renderGalleryPreview() {
  const gallery = currentGallery();
  galleryPreview.innerHTML = gallery.map((url, index) => `
    <div class="gallery-thumb">
      <img src="${url}" alt="">
      <button type="button" aria-label="Remove image" data-remove-gallery="${index}">×</button>
    </div>
  `).join("");
  document.querySelectorAll("[data-remove-gallery]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextGallery = currentGallery();
      nextGallery.splice(Number(button.dataset.removeGallery), 1);
      setGallery(nextGallery);
    });
  });
}

function projectGallery(project) {
  const gallery = Array.isArray(project.gallery) ? project.gallery.filter(Boolean) : [];
  return gallery.length ? gallery : [project.cover].filter(Boolean);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showLoginExpired() {
  alert("Oturum süresi doldu. Tekrar giriş yap.");
  location.reload();
}

async function showError(response, fallbackMessage) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.error ? `\n${body.error}` : "";
  } catch {
    detail = "";
  }
  alert(`${fallbackMessage}${detail}`);
}

function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? "Saving..." : button.dataset.label || button.textContent;
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
