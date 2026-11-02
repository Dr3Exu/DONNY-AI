const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("donnyDesktop", {
  getStatus: () => ipcRenderer.invoke("donny:status"),
  chat: (messages) => ipcRenderer.invoke("donny:chat", messages),
  saveApiKey: (value) => ipcRenderer.invoke("donny:save-api-key", value),
  clearApiKey: () => ipcRenderer.invoke("donny:clear-api-key"),
  listPrograms: () => ipcRenderer.invoke("donny:list-programs"),
  openProgram: (id) => ipcRenderer.invoke("donny:open-program", id),
  closeProgram: (id) => ipcRenderer.invoke("donny:close-program", id),
  searchWeb: (query) => ipcRenderer.invoke("donny:search-web", query),
  openWebUrl: (url) => ipcRenderer.invoke("donny:open-web-url", url),
  listAppointments: () => ipcRenderer.invoke("donny:list-appointments"),
  saveAppointment: (appointment) => ipcRenderer.invoke("donny:save-appointment", appointment),
  deleteAppointment: (id) => ipcRenderer.invoke("donny:delete-appointment", id),
});