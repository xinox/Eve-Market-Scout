# Dashboard

Vite/React-Dashboard für aktuelle Marktpreise, gebührenbereinigte Handelsrouten, Preisverläufe und Alarmverwaltung.

```bash
npm run dev:web
npm run build:web
```

`npm run dev:web` startet Frontend und lokalen Worker gemeinsam, migriert die lokale D1-Datenbank und verbindet `/api` automatisch. Der Admin-Schlüssel ist ausschließlich in diesem lokalen Modus optional.

Im Cloudflare-Deployment werden Frontend und API über denselben Worker ausgeliefert; dafür ist keine Frontend-Umgebungsvariable nötig. Für einen getrennten Host kann `VITE_API_BASE_URL` auf die öffentliche Worker-Origin gesetzt werden. Der Worker müsste dann zusätzlich CORS erlauben.

Lokale Entwicklung zeigt bei einer leeren oder nicht erreichbaren API klar markierte Demo-Daten. Ein Production-Build zeigt niemals Demo-Daten.

Online-Alarmregeln liegen in D1. Anlegen und Löschen erfordert den beim Deploy gesetzten `INGEST_SECRET`; er wird nur im Arbeitsspeicher des geöffneten Tabs gehalten. Discord wird vom Collector bedient. Browser-Benachrichtigungen werden im geöffneten Dashboard alle 60 Sekunden geprüft.

Der Items-Tab verwaltet die gemeinsame D1-Watchlist. Suchvorschläge kommen aus einem kompakten, mitgelieferten Marktkatalog. `npm run catalog:update` aktualisiert ihn aus dem [EVE Ref Reference-Data-Datensatz](https://docs.everef.net/datasets/reference-data.html); Rechte an EVE-Daten und -Namen verbleiben bei CCP beziehungsweise den jeweiligen Rechteinhabern.
