const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");

const publicDirectory = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("Die Anfrage ist zu groß.");
    }
  }
  return JSON.parse(body);
}

async function serveFile(requestPath, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    response.writeHead(400).end("Ungültiger Pfad");
    return;
  }

  const filePath = path.resolve(publicDirectory, `.${decodedPath === "/" ? "/index.html" : decodedPath}`);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403).end("Verboten");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end("Nicht gefunden");
  }
}

async function handleChat(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 503, {
      error: "KI noch nicht verbunden. Starte D.O.N.N.Y. mit OPENAI_API_KEY, um freie KI-Antworten zu aktivieren.",
    });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Die Chat-Anfrage ist ungültig oder zu groß." });
    return;
  }

  if (!Array.isArray(payload.messages) || payload.messages.length > 40) {
    sendJson(response, 400, { error: "Der Chatverlauf ist ungültig oder zu lang." });
    return;
  }

  const messages = payload.messages.filter(
    (message) =>
      message &&
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.length <= 8_000,
  );

  try {
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Du bist D.O.N.N.Y., ein hilfreicher, freundlicher persönlicher KI-Assistent. Antworte klar und auf Deutsch, sofern die Person keine andere Sprache verwendet.",
          },
          ...messages,
        ],
      }),
    });

    const result = await upstreamResponse.json();
    if (!upstreamResponse.ok) {
      sendJson(response, 502, { error: result.error?.message || "Der KI-Dienst ist gerade nicht erreichbar." });
      return;
    }

    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== "string") {
      sendJson(response, 502, { error: "Der KI-Dienst hat keine Antwort geliefert." });
      return;
    }
    sendJson(response, 200, { answer });
  } catch {
    sendJson(response, 502, { error: "Verbindung zum KI-Dienst fehlgeschlagen." });
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && requestUrl.pathname === "/api/status") {
    sendJson(response, 200, { aiConnected: Boolean(process.env.OPENAI_API_KEY) });
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }
  if (request.method === "GET") {
    await serveFile(requestUrl.pathname, response);
    return;
  }
  response.writeHead(405, { Allow: "GET, POST" }).end("Methode nicht erlaubt");
});

function promptForApiKey() {
  if (process.env.OPENAI_API_KEY || !process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    prompt._writeToOutput = () => {};
    process.stderr.write("Neu erstellten API-Schlüssel eingeben (Eingabe bleibt verborgen):\n");
    prompt.question("", (apiKey) => {
      if (apiKey.trim()) process.env.OPENAI_API_KEY = apiKey.trim();
      prompt.close();
      resolve();
    });
  });
}

async function startServer() {
  await promptForApiKey();
  server.listen(port, "127.0.0.1", () => {
    console.log(`D.O.N.N.Y. läuft auf http://127.0.0.1:${port}`);
  });
}

startServer();