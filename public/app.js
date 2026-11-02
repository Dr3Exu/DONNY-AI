const messagesElement = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector(".send-button");
const suggestions = document.querySelector("#suggestions");
const toast = document.querySelector("#toast");
const desktop = window.donnyDesktop;
const conversation = [];
const pendingActions = new Map();
let toastTimer;
let recognition;

function currentTime() {
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function updateClock() {
  document.querySelector("#header-clock").textContent = currentTime();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function addMessage(role, text, { typing = false } = {}) {
  const row = document.createElement("article");
  row.className = `message ${role}${typing ? " typing" : ""}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "assistant" ? "D" : "Du";
  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("span");
  name.textContent = role === "assistant" ? "D.O.N.N.Y." : "DU";
  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = currentTime();
  meta.append(name, time);
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (typing) {
    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.setAttribute("aria-label", "D.O.N.N.Y. schreibt");
    for (let index = 0; index < 3; index += 1) dots.append(document.createElement("i"));
    bubble.append(dots);
  } else {
    bubble.textContent = text;
  }
  content.append(meta, bubble);
  row.append(avatar, content);
  messagesElement.append(row);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return row;
}

function addActionProposal(summary, action) {
  const row = addMessage("assistant", summary);
  const proposalId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingActions.set(proposalId, action);
  const controls = document.createElement("div");
  controls.className = "proposal-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "tool-submit";
  approve.dataset.approveProposal = proposalId;
  approve.textContent = action.name === "list_appointments" ? "Termine anzeigen" : "Aktion bestätigen";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "text-button";
  cancel.dataset.cancelProposal = proposalId;
  cancel.textContent = "Abbrechen";
  controls.append(approve, cancel);
  row.querySelector(".message-bubble").append(controls);
}

async function executeAssistantAction(action) {
  if (!desktop) throw new Error("Desktop-Aktionen sind nur in der Windows-App verfügbar.");
  const args = action.args;
  switch (action.name) {
    case "open_program":
      return desktop.openProgram(args.programId);
    case "close_program":
      return desktop.closeProgram(args.programId);
    case "search_web":
      return desktop.searchWeb(args.query);
    case "open_website":
      return desktop.openWebUrl(args.url);
    case "create_appointment":
      await desktop.saveAppointment(args);
      await loadAppointments();
      return "Der Termin wurde lokal gespeichert.";
    case "list_appointments": {
      const entries = await desktop.listAppointments();
      return entries.length
        ? entries.map((entry) => `${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.startsAt))}: ${entry.title}${entry.notes ? ` (${entry.notes})` : ""}`).join("\n")
        : "Es sind noch keine lokalen Termine gespeichert.";
    }
    default:
      throw new Error("Diese Aktion ist nicht freigegeben.");
  }
}

function localAnswer(text) {
  const query = text.toLocaleLowerCase("de-DE");
  if (/\b(uhrzeit|wie spät|wieviel uhr)\b/.test(query)) {
    return `Es ist ${currentTime()} Uhr.`;
  }
  if (/\b(datum|welcher tag|heute)\b/.test(query)) {
    const date = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    return `Heute ist ${date}.`;
  }
  if (/\b(was kannst du|hilfe|funktionen|was machst du)\b/.test(query)) {
    return "Ich kann mit einer verbundenen KI frei mit dir chatten. Hier im Browser kann ich dir außerdem Datum und Uhrzeit nennen. Schreib mir einfach, wobei ich helfen soll.";
  }
  if (/\b(hallo|hi|guten morgen|guten tag|guten abend)\b/.test(query)) {
    return "Hallo! Schön, dass du da bist. Wobei kann ich dir helfen?";
  }
  return null;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  window.speechSynthesis.speak(utterance);
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || sendButton.disabled) return;

  suggestions.hidden = true;
  addMessage("user", text);
  input.value = "";
  input.style.height = "auto";
  const localResponse = localAnswer(text);
  if (localResponse) {
    addMessage("assistant", localResponse);
    conversation.push({ role: "user", content: text }, { role: "assistant", content: localResponse });
    speak(localResponse);
    return;
  }

  sendButton.disabled = true;
  const pending = addMessage("assistant", "", { typing: true });
  conversation.push({ role: "user", content: text });
  try {
    let answer;
    if (desktop) {
      answer = await desktop.chat(conversation.slice(-20));
    } else {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-20) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Die Anfrage konnte nicht verarbeitet werden.");
      answer = result.answer;
    }
    pending.remove();
    if (answer && typeof answer === "object" && answer.type === "action") {
      addActionProposal(answer.summary, answer.action);
      conversation.push({ role: "assistant", content: answer.summary });
      return;
    }
    addMessage("assistant", answer);
    conversation.push({ role: "assistant", content: answer });
    speak(answer);
  } catch (error) {
    pending.remove();
    const message = error.message || "Die Anfrage konnte nicht verarbeitet werden.";
    addMessage("assistant", message);
    showToast(message);
    conversation.pop();
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

messagesElement.addEventListener("click", async (event) => {
  const approve = event.target.closest("[data-approve-proposal]");
  const cancel = event.target.closest("[data-cancel-proposal]");
  const selectedButton = approve || cancel;
  if (!selectedButton) return;
  const proposalId = selectedButton.dataset.approveProposal || selectedButton.dataset.cancelProposal;
  const action = pendingActions.get(proposalId);
  if (!action) return;
  pendingActions.delete(proposalId);
  const proposalRow = selectedButton.closest(".message");
  proposalRow.querySelectorAll(".proposal-actions button").forEach((button) => { button.disabled = true; });
  if (cancel) {
    addMessage("assistant", "Alles klar, ich habe nichts ausgeführt.");
    return;
  }
  try {
    const result = await executeAssistantAction(action);
    addMessage("assistant", result);
    conversation.push({ role: "assistant", content: result });
  } catch (error) {
    const message = error.message || "Die Aktion konnte nicht ausgeführt werden.";
    addMessage("assistant", message);
    showToast(message);
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 100)}px`;
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-prompt]");
  if (button) sendMessage(button.dataset.prompt);
});

document.querySelector("#clear-chat").addEventListener("click", () => {
  conversation.length = 0;
  messagesElement.replaceChildren();
  suggestions.hidden = false;
  addMessage("assistant", "Hallo, ich bin D.O.N.N.Y. Was kann ich heute für dich tun?");
  input.focus();
});

const microphoneButton = document.querySelector("#mic-button");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "de-DE";
  recognition.interimResults = false;
  recognition.onstart = () => microphoneButton.classList.add("listening");
  recognition.onend = () => microphoneButton.classList.remove("listening");
  recognition.onresult = (event) => {
    input.value = event.results[0][0].transcript;
    form.requestSubmit();
  };
  recognition.onerror = () => showToast("Spracheingabe nicht verfügbar. Prüfe bitte die Mikrofonfreigabe.");
  microphoneButton.addEventListener("click", () => {
    try {
      recognition.start();
    } catch {
      recognition.stop();
    }
  });
} else {
  microphoneButton.addEventListener("click", () => showToast("Dieser Browser unterstützt keine Spracheingabe."));
}

async function checkConnection() {
  const dot = document.querySelector("#connection-dot");
  const title = document.querySelector("#connection-title");
  const detail = document.querySelector("#connection-detail");
  try {
    const status = desktop
      ? await desktop.getStatus()
      : await fetch("/api/status").then((response) => response.json());
    if (status.aiConnected) {
      dot.classList.add("connected");
      title.textContent = "KI verbunden";
      detail.textContent = "Bereit für deine Fragen";
      document.querySelector("#privacy-label").textContent = "EXTERNE KI AKTIV";
    } else {
      title.textContent = "Lokaler Modus";
      detail.textContent = "Einfache Befehle bereit";
    }
  } catch {
    title.textContent = "Server nicht erreichbar";
    detail.textContent = "Bitte npm start ausführen";
  }
}

async function loadPrograms() {
  const list = document.querySelector("#program-list");
  const status = document.querySelector("#programs-status");
  if (!desktop) {
    status.textContent = "Programmsteuerung ist in der Windows-App verfügbar.";
    return;
  }
  try {
    const result = await desktop.listPrograms();
    if (!result.supported) status.textContent = "Die Programmsteuerung ist nur unter Windows verfügbar.";
    result.programs.forEach((program) => {
      const row = document.createElement("div");
      row.className = "program-row";
      const name = document.createElement("strong");
      name.textContent = program.name;
      const actions = document.createElement("div");
      actions.className = "program-actions";
      const openButton = document.createElement("button");
      openButton.className = "small-action";
      openButton.type = "button";
      openButton.dataset.action = "open";
      openButton.dataset.program = program.id;
      openButton.textContent = "Öffnen";
      openButton.disabled = !result.supported;
      actions.append(openButton);
      if (program.closeable) {
        const closeButton = document.createElement("button");
        closeButton.className = "small-action close-action";
        closeButton.type = "button";
        closeButton.dataset.action = "close";
        closeButton.dataset.program = program.id;
        closeButton.textContent = "Schließen";
        closeButton.disabled = !result.supported;
        actions.append(closeButton);
      }
      row.append(name, actions);
      list.append(row);
    });
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelector("#program-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !desktop) return;
  try {
    const operation = button.dataset.action === "open" ? desktop.openProgram : desktop.closeProgram;
    showToast(await operation(button.dataset.program));
  } catch (error) {
    showToast(error.message || "Programmaktion fehlgeschlagen.");
  }
});

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function loadAppointments() {
  const list = document.querySelector("#appointment-list");
  list.replaceChildren();
  if (!desktop) {
    const notice = document.createElement("p");
    notice.className = "empty-state";
    notice.textContent = "Termine werden in der Windows-App lokal gespeichert.";
    list.append(notice);
    return;
  }
  try {
    const appointments = await desktop.listAppointments();
    if (!appointments.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Noch keine Termine gespeichert.";
      list.append(empty);
      return;
    }
    appointments.forEach((appointment) => {
      const row = document.createElement("article");
      row.className = "appointment-row";
      const details = document.createElement("div");
      details.className = "appointment-details";
      const title = document.createElement("strong");
      title.textContent = appointment.title;
      const date = document.createElement("time");
      date.dateTime = appointment.startsAt;
      date.textContent = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(appointment.startsAt));
      details.append(title, date);
      if (appointment.notes) {
        const notes = document.createElement("span");
        notes.textContent = appointment.notes;
        details.append(notes);
      }
      const actions = document.createElement("div");
      actions.className = "appointment-row-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "text-button";
      edit.dataset.editAppointment = appointment.id;
      edit.textContent = "Bearbeiten";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button danger-text";
      remove.dataset.deleteAppointment = appointment.id;
      remove.textContent = "Löschen";
      actions.append(edit, remove);
      row.append(details, actions);
      list.append(row);
    });
  } catch (error) {
    showToast(error.message || "Termine konnten nicht geladen werden.");
  }
}

const appointmentForm = document.querySelector("#appointment-form");
const appointmentCancel = document.querySelector("#appointment-cancel");

appointmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!desktop) {
    showToast("Die Terminverwaltung ist in der Windows-App verfügbar.");
    return;
  }
  const submit = document.querySelector("#appointment-submit");
  submit.disabled = true;
  try {
    await desktop.saveAppointment({
      id: document.querySelector("#appointment-id").value || undefined,
      title: document.querySelector("#appointment-title").value,
      startsAt: document.querySelector("#appointment-time").value,
      notes: document.querySelector("#appointment-notes").value,
    });
    appointmentForm.reset();
    document.querySelector("#appointment-id").value = "";
    submit.textContent = "Termin speichern";
    appointmentCancel.hidden = true;
    await loadAppointments();
    showToast("Termin wurde lokal gespeichert.");
  } catch (error) {
    showToast(error.message || "Termin konnte nicht gespeichert werden.");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#appointment-list").addEventListener("click", async (event) => {
  if (!desktop) return;
  const edit = event.target.closest("[data-edit-appointment]");
  if (edit) {
    const appointment = (await desktop.listAppointments()).find((entry) => entry.id === edit.dataset.editAppointment);
    if (!appointment) return;
    document.querySelector("#appointment-id").value = appointment.id;
    document.querySelector("#appointment-title").value = appointment.title;
    document.querySelector("#appointment-time").value = localDateTimeValue(appointment.startsAt);
    document.querySelector("#appointment-notes").value = appointment.notes;
    document.querySelector("#appointment-submit").textContent = "Änderungen speichern";
    appointmentCancel.hidden = false;
    document.querySelector("#appointment-title").focus();
    return;
  }
  const remove = event.target.closest("[data-delete-appointment]");
  if (remove) {
    try {
      const deleted = await desktop.deleteAppointment(remove.dataset.deleteAppointment);
      if (deleted) {
        await loadAppointments();
        showToast("Termin wurde gelöscht.");
      }
    } catch (error) {
      showToast(error.message || "Termin konnte nicht gelöscht werden.");
    }
  }
});

appointmentCancel.addEventListener("click", () => {
  appointmentForm.reset();
  document.querySelector("#appointment-id").value = "";
  document.querySelector("#appointment-submit").textContent = "Termin speichern";
  appointmentCancel.hidden = true;
});

document.querySelector("#web-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#web-search-input").value.trim();
  if (desktop) {
    try { showToast(await desktop.searchWeb(query)); } catch (error) { showToast(error.message); }
  } else if (window.confirm(`Websuche nach „${query}“ im Browser öffnen?`)) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  }
});

document.querySelector("#web-open-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = document.querySelector("#web-url-input").value.trim();
  if (desktop) {
    try { showToast(await desktop.openWebUrl(address)); } catch (error) { showToast(error.message); }
  } else if (window.confirm(`Webseite ${address} im Browser öffnen?`)) {
    const url = new URL(address);
    if (["https:", "http:"].includes(url.protocol)) window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
});

const keyDialog = document.querySelector("#api-key-dialog");
document.querySelector("#api-key-open").addEventListener("click", () => keyDialog.showModal());
document.querySelector("#api-key-close").addEventListener("click", () => keyDialog.close());
document.querySelector("#api-key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#api-key-input");
  const status = document.querySelector("#key-dialog-status");
  if (!desktop) {
    status.textContent = "Die Schlüsselverwaltung ist in der Windows-App verfügbar.";
    return;
  }
  try {
    const result = await desktop.saveApiKey(input.value);
    input.value = "";
    status.textContent = result.message;
    await checkConnection();
  } catch (error) {
    status.textContent = error.message || "Schlüssel konnte nicht gespeichert werden.";
  }
});

document.querySelector("#api-key-clear").addEventListener("click", async () => {
  if (!desktop || !window.confirm("Gespeicherten API-Schlüssel von diesem Gerät entfernen?")) return;
  try {
    await desktop.clearApiKey();
    document.querySelector("#api-key-input").value = "";
    document.querySelector("#key-dialog-status").textContent = "API-Schlüssel entfernt.";
    await checkConnection();
  } catch (error) {
    showToast(error.message || "Schlüssel konnte nicht entfernt werden.");
  }
});

updateClock();
setInterval(updateClock, 30_000);
addMessage("assistant", "Hallo, ich bin D.O.N.N.Y. Was kann ich heute für dich tun?");
checkConnection();
loadPrograms();
loadAppointments();