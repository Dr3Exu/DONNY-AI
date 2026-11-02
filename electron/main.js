const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const publicDirectory = path.join(__dirname, "..", "public");
const trustedPage = path.join(publicDirectory, "index.html");
const keyFile = () => path.join(app.getPath("userData"), "api-key.bin");
const appointmentsFile = () => path.join(app.getPath("userData"), "appointments.json");
const programs = [
  { id: "notepad", name: "Editor", executable: "notepad.exe", closeable: true },
  { id: "calculator", name: "Rechner", executable: "calc.exe", closeable: true },
  { id: "paint", name: "Paint", executable: "mspaint.exe", closeable: true },
  { id: "edge", name: "Microsoft Edge", executable: "msedge.exe", closeable: true },
  { id: "chrome", name: "Google Chrome", executable: "chrome.exe", closeable: true },
];
const assistantTools = [
  {
    type: "function",
    function: {
      name: "open_program",
      description: "Schlägt vor, ein freigegebenes Windows-Programm zu öffnen.",
      parameters: { type: "object", properties: { programId: { type: "string", enum: programs.map((program) => program.id) } }, required: ["programId"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "close_program",
      description: "Schlägt vor, ein freigegebenes Windows-Programm zu schließen.",
      parameters: { type: "object", properties: { programId: { type: "string", enum: programs.map((program) => program.id) } }, required: ["programId"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Schlägt eine Websuche im Standardbrowser vor.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "open_website",
      description: "Schlägt vor, eine HTTP- oder HTTPS-Webseite im Standardbrowser zu öffnen.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description: "Schlägt vor, einen lokalen Termin zu erstellen. Frage zuerst nach Titel und Datum/Uhrzeit, falls etwas davon fehlt.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, startsAt: { type: "string", description: "ISO-8601-Datum mit Zeitzone" }, notes: { type: "string" } },
        required: ["title", "startsAt", "notes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_appointments",
      description: "Schlägt vor, die lokal gespeicherten Termine anzuzeigen.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
];

let mainWindow;
let apiKey = "";

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || "";
  if (!senderUrl.startsWith("file://") || path.resolve(fileURLToPath(senderUrl)) !== trustedPage) {
    throw new Error("Nicht autorisierte D.O.N.N.Y.-Anfrage.");
  }
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return callback(...args);
  });
}

async function loadApiKey() {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const encrypted = await fs.readFile(keyFile());
    apiKey = safeStorage.decryptString(encrypted);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Der gespeicherte API-Schlüssel konnte nicht gelesen werden.");
  }
}

async function saveApiKey(value) {
  if (typeof value !== "string" || value.trim().length < 8 || value.length > 512) {
    throw new Error("Bitte gib einen gültigen API-Schlüssel ein.");
  }

  apiKey = value.trim();
  if (!safeStorage.isEncryptionAvailable()) {
    return { saved: false, message: "Schlüssel gilt bis zum Beenden der App; sichere Speicherung ist hier nicht verfügbar." };
  }

  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(keyFile(), safeStorage.encryptString(apiKey), { mode: 0o600 });
  return { saved: true, message: "Schlüssel verschlüsselt auf diesem Gerät gespeichert." };
}

async function clearApiKey() {
  apiKey = "";
  await fs.rm(keyFile(), { force: true });
}

async function readAppointments() {
  try {
    const content = await fs.readFile(appointmentsFile(), "utf8");
    const entries = JSON.parse(content);
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Die lokale Terminliste konnte nicht gelesen werden.");
  }
}

async function writeAppointments(entries) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const temporaryFile = `${appointmentsFile()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(entries, null, 2), "utf8");
  await fs.rename(temporaryFile, appointmentsFile());
}

function normalizeAppointment(input, id = randomUUID()) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const notes = typeof input?.notes === "string" ? input.notes.trim() : "";
  const startsAt = new Date(input?.startsAt);
  if (!title || title.length > 120 || notes.length > 2000 || Number.isNaN(startsAt.getTime())) {
    throw new Error("Bitte prüfe Titel, Datum und Notizen des Termins.");
  }
  return { id, title, startsAt: startsAt.toISOString(), notes };
}

function findProgram(id) {
  return programs.find((program) => program.id === id);
}

async function confirmAction(title, message) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title,
    message,
    buttons: ["Abbrechen", "Bestätigen"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

function validateWebUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Die Adresse ist ungültig.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Bitte gib eine vollständige Webadresse ein, zum Beispiel https://example.com.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Aus Sicherheitsgründen sind nur HTTP- und HTTPS-Webseiten erlaubt.");
  }
  return url;
}

function describeAssistantAction(name, args) {
  switch (name) {
    case "open_program":
    case "close_program": {
      const program = findProgram(args.programId);
      if (!program) throw new Error("Die KI hat ein nicht freigegebenes Programm vorgeschlagen.");
      return name === "open_program" ? `${program.name} öffnen?` : `${program.name} schließen?`;
    }
    case "search_web":
      if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 300) throw new Error("Der Suchvorschlag ist ungültig.");
      return `Im Internet nach „${args.query.trim()}“ suchen?`;
    case "open_website": {
      const url = validateWebUrl(args.url);
      return `${url.hostname} im Standardbrowser öffnen?`;
    }
    case "create_appointment": {
      const appointment = normalizeAppointment(args);
      return `Termin „${appointment.title}“ am ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(appointment.startsAt))} speichern?`;
    }
    case "list_appointments":
      return "Lokale Termine anzeigen?";
    default:
      throw new Error("Die KI hat eine nicht unterstützte Aktion vorgeschlagen.");
  }
}

function registerHandlers() {
  handle("donny:status", () => ({
    aiConnected: Boolean(apiKey),
    platform: process.platform,
    canStoreKey: safeStorage.isEncryptionAvailable(),
  }));

  handle("donny:save-api-key", saveApiKey);
  handle("donny:clear-api-key", clearApiKey);

  handle("donny:chat", async (messages) => {
    if (!apiKey) throw new Error("Bitte verbinde zuerst deinen API-Schlüssel über die Schlüssel-Schaltfläche.");
    if (!Array.isArray(messages) || messages.length > 40) throw new Error("Der Chatverlauf ist ungültig.");
    const safeMessages = messages.filter(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.length <= 8000,
    );
    const response = await fetch(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Du bist D.O.N.N.Y., ein hilfreicher deutscher Desktop-Assistent. Wenn die Person eindeutig eine App-, Web- oder Terminaktion wünscht, nutze genau ein passendes Werkzeug. D.O.N.N.Y. führt Vorschläge erst nach einer ausdrücklichen Bestätigung in der Oberfläche aus. Behaupte niemals, eine Aktion sei bereits erledigt. Erfinde bei fehlenden Angaben keinen Termin, sondern frage nach.",
          },
          ...safeMessages,
        ],
        tools: assistantTools,
        tool_choice: "auto",
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Der KI-Dienst ist gerade nicht erreichbar.");
    const assistantMessage = result.choices?.[0]?.message;
    const toolCall = assistantMessage?.tool_calls?.[0];
    if (toolCall) {
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        throw new Error("Der Aktionsvorschlag der KI war ungültig.");
      }
      const allowedTools = new Set(assistantTools.map((tool) => tool.function.name));
      if (!allowedTools.has(toolCall.function.name) || !args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("Die KI hat eine nicht unterstützte Aktion vorgeschlagen.");
      }
      return {
        type: "action",
        summary: describeAssistantAction(toolCall.function.name, args),
        action: { name: toolCall.function.name, args },
      };
    }
    const answer = assistantMessage?.content;
    if (typeof answer !== "string") throw new Error("Der KI-Dienst hat keine Textantwort geliefert.");
    return answer;
  });

  handle("donny:list-programs", () => ({
    supported: process.platform === "win32",
    programs: programs.map(({ id, name, closeable }) => ({ id, name, closeable })),
  }));

  handle("donny:open-program", async (id) => {
    const program = findProgram(id);
    if (!program) throw new Error("Dieses Programm ist nicht freigegeben.");
    if (process.platform !== "win32") throw new Error("Das Öffnen von Windows-Programmen funktioniert nur unter Windows.");
    return new Promise((resolve, reject) => {
      const child = spawn(program.executable, [], { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", () => reject(new Error(`${program.name} wurde nicht gefunden oder konnte nicht gestartet werden.`)));
      child.once("spawn", () => {
        child.unref();
        resolve(`${program.name} wurde geöffnet.`);
      });
    });
  });

  handle("donny:close-program", async (id) => {
    const program = findProgram(id);
    if (!program || !program.closeable) throw new Error("Dieses Programm kann nicht geschlossen werden.");
    if (process.platform !== "win32") throw new Error("Das Schließen von Windows-Programmen funktioniert nur unter Windows.");
    const confirmed = await confirmAction(
      `${program.name} schließen?`,
      `D.O.N.N.Y. beendet ${program.name}. Nicht gespeicherte Arbeit kann verloren gehen.`,
    );
    if (!confirmed) return "Aktion abgebrochen.";
    try {
      await execFileAsync("taskkill.exe", ["/IM", program.executable, "/T"], { windowsHide: true });
      return `${program.name} wurde geschlossen.`;
    } catch {
      throw new Error(`${program.name} läuft möglicherweise nicht oder konnte nicht geschlossen werden.`);
    }
  });

  handle("donny:search-web", async (query) => {
    if (typeof query !== "string" || !query.trim() || query.length > 300) throw new Error("Bitte gib einen Suchbegriff ein.");
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", query.trim());
    if (!(await confirmAction("Websuche öffnen?", `D.O.N.N.Y. öffnet die Suche nach „${query.trim()}“ im Standardbrowser.`))) {
      return "Suche abgebrochen.";
    }
    await shell.openExternal(url.toString());
    return "Die Suche wurde im Standardbrowser geöffnet.";
  });

  handle("donny:open-web-url", async (value) => {
    const url = validateWebUrl(value);
    if (!(await confirmAction("Webseite öffnen?", `D.O.N.N.Y. öffnet ${url.hostname} im Standardbrowser.`))) {
      return "Öffnen abgebrochen.";
    }
    await shell.openExternal(url.toString());
    return "Die Webseite wurde im Standardbrowser geöffnet.";
  });

  handle("donny:list-appointments", async () => {
    const entries = await readAppointments();
    return entries.sort((first, second) => new Date(first.startsAt) - new Date(second.startsAt));
  });

  handle("donny:save-appointment", async (input) => {
    const entries = await readAppointments();
    const existingIndex = input?.id ? entries.findIndex((entry) => entry.id === input.id) : -1;
    if (input?.id && existingIndex < 0) throw new Error("Der Termin wurde nicht gefunden.");
    const appointment = normalizeAppointment(input, existingIndex >= 0 ? entries[existingIndex].id : randomUUID());
    if (existingIndex >= 0) entries[existingIndex] = appointment;
    else entries.push(appointment);
    await writeAppointments(entries);
    return appointment;
  });

  handle("donny:delete-appointment", async (id) => {
    const entries = await readAppointments();
    const appointment = entries.find((entry) => entry.id === id);
    if (!appointment) throw new Error("Der Termin wurde nicht gefunden.");
    if (!(await confirmAction("Termin löschen?", `„${appointment.title}“ wird aus der lokalen Terminliste entfernt.`))) {
      return false;
    }
    await writeAppointments(entries.filter((entry) => entry.id !== id));
    return true;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: "#101513",
    title: "D.O.N.N.Y. | Persönlicher Assistent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadFile(trustedPage);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await loadApiKey();
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());