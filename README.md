# D.O.N.N.Y.

D.O.N.N.Y. ist ein lokaler Windows-Desktop-Assistent mit Chat, Spracheingabe, Sprachausgabe und bestätigungspflichtigen Werkzeugen.

## Start und Build

Voraussetzung für die Entwicklung: Node.js 20 oder neuer.

```bash
npm install
npm start
```

Für einen Windows-Installer:

```bash
npm run dist:win
```

Der NSIS-Installer wird im Ordner `dist/` erzeugt. Unter Windows lässt sich die App auch direkt mit `npm start` testen.

## Funktionen

- Öffnen und Schließen einer festen Liste unterstützter Windows-Programme. Beim Schließen fragt D.O.N.N.Y. vorher nach; nicht gespeicherte Arbeit kann verloren gehen.
- Termine lokal anlegen, bearbeiten und löschen. Die Daten bleiben im App-Datenordner dieses Windows-Benutzerkontos. Outlook-/Google-Kalender-Synchronisierung und Erinnerungen sind noch nicht enthalten.
- Suchanfragen und HTTP-/HTTPS-Webseiten im Standardbrowser öffnen. D.O.N.N.Y. zeigt davor eine Bestätigung.
- Im KI-Chat können Aktionen vorgeschlagen werden. Erst nach Klick auf „Aktion bestätigen“ und gegebenenfalls einer zusätzlichen Windows-Bestätigung wird etwas ausgeführt.
- KI-Chat über eine OpenAI-kompatible Chat-Completions-API.

## API-Schlüssel

Über **Schlüssel** in der App einen neuen API-Schlüssel eingeben. Unter Windows wird er mit dem Windows-Schlüsselspeicher verschlüsselt auf dem Gerät abgelegt. Chatnachrichten werden an den eingestellten API-Anbieter übertragen. Schlüssel niemals in den Chat oder in Projektdateien schreiben.

Optional können Modell und API-Adresse vor dem Start über `OPENAI_MODEL` und `OPENAI_BASE_URL` gesetzt werden. Die Adresse muss `/chat/completions` unterstützen.

Windows-Programmsteuerung funktioniert nur in der Windows-App. Im Entwicklungscontainer lassen sich Oberfläche und Chat testen; native Windows-Programme können dort nicht geöffnet oder geschlossen werden.
