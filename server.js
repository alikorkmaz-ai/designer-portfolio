const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { MongoClient } = require("mongodb");

loadEnv();

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "data", "site.json");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
const HOST = process.env.RENDER ? "0.0.0.0" : (process.env.HOST || "0.0.0.0");
const PORT = Number(process.env.PORT || 8787);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(24).toString("hex");
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "designer_portfolio";
const SITE_DOC_ID = "site";
const sessions = new Set();
let mongoClient = null;
let siteCollection = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/site" && req.method === "GET") {
      return sendJson(res, 200, await readSite());
    }

    if (url.pathname === "/admin" && req.method === "GET") {
      return serveStatic("/admin.html", res);
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = await readJson(req);
      if (body.password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "Invalid password" });
      }
      const token = crypto.randomBytes(24).toString("hex");
      sessions.add(token);
      res.setHeader("Set-Cookie", `portfolio_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const token = sessionToken(req);
      if (token) sessions.delete(token);
      res.setHeader("Set-Cookie", "portfolio_session=; Max-Age=0; Path=/");
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      const token = sessionToken(req);
      return sendJson(res, 200, { authenticated: Boolean(token && sessions.has(token)) });
    }

    if (url.pathname === "/api/site" && req.method === "PUT") {
      requireAdmin(req);
      const body = await readJson(req);
      const site = await readSite();
      site.profile = sanitizeProfile(body.profile || site.profile);
      site.translations = site.translations || {};
      site.translations.en = site.translations.en || {};
      site.translations.en.profile = sanitizeProfileTranslation(body.translation || site.translations.en.profile || {});
      await writeSite(site);
      return sendJson(res, 200, site);
    }

    if (url.pathname === "/api/projects" && req.method === "POST") {
      requireAdmin(req);
      const body = await readJson(req);
      const site = await readSite();
      const project = sanitizeProject(body);
      project.id = project.id || slugify(project.title);
      if (site.projects.some((item) => item.id === project.id)) {
        project.id = `${project.id}-${Date.now()}`;
      }
      site.projects.push(project);
      saveProjectTranslation(site, project.id, body.translation);
      await writeSite(site);
      return sendJson(res, 201, project);
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && req.method === "PUT") {
      requireAdmin(req);
      const id = decodeURIComponent(projectMatch[1]);
      const body = await readJson(req);
      const site = await readSite();
      const index = site.projects.findIndex((item) => item.id === id);
      if (index === -1) return sendJson(res, 404, { error: "Project not found" });
      site.projects[index] = { ...site.projects[index], ...sanitizeProject(body), id };
      saveProjectTranslation(site, id, body.translation);
      await writeSite(site);
      return sendJson(res, 200, site.projects[index]);
    }

    if (projectMatch && req.method === "DELETE") {
      requireAdmin(req);
      const id = decodeURIComponent(projectMatch[1]);
      const site = await readSite();
      site.projects = site.projects.filter((item) => item.id !== id);
      if (site.translations?.en?.projects) {
        delete site.translations.en.projects[id];
      }
      await writeSite(site);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/upload" && req.method === "POST") {
      requireAdmin(req);
      const body = await readJson(req, 12_000_000);
      const uploaded = await saveDataUrl(body.fileName, body.dataUrl);
      return sendJson(res, 201, uploaded);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    if (error.statusCode === 401) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    console.error(error);
    return sendJson(res, error.statusCode || 500, { error: publicErrorMessage(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Portfolio site: http://${HOST}:${PORT}`);
  console.log(`Admin panel:    http://${HOST}:${PORT}/admin.html`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});

async function readSite() {
  if (MONGODB_URI) {
    await connectDatabase();
    let site = await siteCollection.findOne({ _id: SITE_DOC_ID }, { projection: { _id: 0 } });
    if (!site) {
      site = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
      await siteCollection.updateOne({ _id: SITE_DOC_ID }, { $set: site }, { upsert: true });
    }
    site.projects = [...(site.projects || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    return site;
  }
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const site = JSON.parse(raw);
  site.projects = [...site.projects].sort((a, b) => (a.order || 0) - (b.order || 0));
  return site;
}

async function writeSite(site) {
  if (MONGODB_URI) {
    await connectDatabase();
    try {
      await siteCollection.updateOne({ _id: SITE_DOC_ID }, { $set: site }, { upsert: true });
    } catch (error) {
      resetDatabaseConnection();
      throw error;
    }
    return;
  }
  await fs.writeFile(DATA_FILE, `${JSON.stringify(site, null, 2)}\n`);
}

async function connectDatabase() {
  if (siteCollection) return;
  mongoClient = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 10_000
  });
  try {
    await mongoClient.connect();
    siteCollection = mongoClient.db(MONGODB_DB).collection("site");
  } catch (error) {
    resetDatabaseConnection();
    throw error;
  }
}

function resetDatabaseConnection() {
  siteCollection = null;
  if (mongoClient) {
    mongoClient.close().catch(() => {});
    mongoClient = null;
  }
}

function sanitizeProfile(profile) {
  return {
    name: String(profile.name || ""),
    role: String(profile.role || ""),
    location: String(profile.location || ""),
    intro: String(profile.intro || ""),
    about: String(profile.about || ""),
    email: String(profile.email || ""),
    instagram: String(profile.instagram || ""),
    linkedin: String(profile.linkedin || profile.behance || "")
  };
}

function sanitizeProfileTranslation(profile) {
  return {
    role: String(profile.role || ""),
    intro: String(profile.intro || ""),
    about: String(profile.about || "")
  };
}

function sanitizeProject(project) {
  const cover = String(project.cover || "/assets/sample-identity.svg");
  const gallery = Array.isArray(project.gallery)
    ? project.gallery.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    id: project.id ? slugify(String(project.id)) : "",
    title: String(project.title || "Untitled Project"),
    category: String(project.category || "Selected Work"),
    year: String(project.year || new Date().getFullYear()),
    client: String(project.client || ""),
    summary: String(project.summary || ""),
    description: String(project.description || ""),
    cover,
    gallery: gallery.length ? gallery : [cover],
    featured: Boolean(project.featured),
    published: project.published !== false,
    order: Number(project.order || 100)
  };
}

function sanitizeProjectTranslation(project) {
  return {
    title: String(project?.title || ""),
    category: String(project?.category || ""),
    summary: String(project?.summary || ""),
    description: String(project?.description || "")
  };
}

function saveProjectTranslation(site, id, translation) {
  site.translations = site.translations || {};
  site.translations.en = site.translations.en || {};
  site.translations.en.projects = site.translations.en.projects || {};
  site.translations.en.projects[id] = sanitizeProjectTranslation(translation || site.translations.en.projects[id] || {});
}

async function saveDataUrl(fileName, dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,(.+)$/);
  if (!match) {
    const error = new Error("Unsupported file");
    error.statusCode = 400;
    throw error;
  }
  if (cloudinaryConfigured()) {
    return uploadToCloudinary(fileName, dataUrl);
  }
  const extension = match[1].includes("png")
    ? ".png"
    : match[1].includes("webp")
      ? ".webp"
      : match[1].includes("svg")
        ? ".svg"
        : ".jpg";
  const safeName = slugify(path.parse(fileName || "upload").name) || "upload";
  const finalName = `${safeName}-${Date.now()}${extension}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, finalName), Buffer.from(match[2], "base64"));
  return { url: `/uploads/${finalName}` };
}

async function uploadToCloudinary(fileName, dataUrl) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_FOLDER || "designer-portfolio";
  const signaturePayload = `folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash("sha1").update(signaturePayload).digest("hex");
  const form = new FormData();
  form.append("file", dataUrl);
  form.append("api_key", process.env.CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: form
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || "Cloudinary upload failed");
    error.statusCode = 502;
    throw error;
  }
  return {
    url: result.secure_url,
    publicId: result.public_id,
    originalName: fileName || ""
  };
}

function cloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET
  );
}

function publicErrorMessage(error) {
  if (error.name === "MongoServerSelectionError" || error.name === "MongoNetworkTimeoutError") {
    return "Database connection failed. Check MongoDB Network Access and MONGODB_URI.";
  }
  if (error.message && /querySrv|ENOTFOUND|ECONN|timed out|Server selection timed out/i.test(error.message)) {
    return "Database connection failed. Check MongoDB Network Access and MONGODB_URI.";
  }
  if (error.statusCode === 502) {
    return error.message;
  }
  return "Server error";
}

function requireAdmin(req) {
  const token = sessionToken(req);
  if (!token || !sessions.has(token)) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function sessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)portfolio_session=([^;]+)/);
  return match ? match[1] : "";
}

function readJson(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(urlPath, res) {
  const decoded = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fsSync.existsSync(envPath)) return;
  const raw = fsSync.readFileSync(envPath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}
