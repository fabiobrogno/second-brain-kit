# MCP-Logos (`vendor/icons/`)

Quelle: **Simple Icons**, Version **16.33.0** (ermittelt am 03.10.2026 über
`https://data.jsdelivr.com/v1/packages/npm/simple-icons`, Feld `tags.latest`), geladen je Datei per
`curl https://cdn.jsdelivr.net/npm/simple-icons@16.33.0/icons/<slug>.svg` — fest auf diese Version gepinnt
(kein `@latest` zur Laufzeit, kein Netzwerkzugriff der Ansicht selbst).

## Lizenz: CC0 1.0 Universal (gemeinfrei)

Simple Icons steht vollständig unter CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/):
„To the extent possible under law, the person who associated CC0 with this work has waived all copyright
and related or neighboring rights to this work.“ Projekt: https://github.com/simple-icons/simple-icons
(Lizenztext der Bibliothek: `https://github.com/simple-icons/simple-icons/blob/master/LICENSE.md`).

**Wichtig:** CC0 gilt für die SVG-Dateien (die Zeichnung), nicht für die dargestellten Marken selbst — die
Namen und Logos bleiben Marken ihrer jeweiligen Inhaber (Google, GitHub, Shopify, …). Diese Datei dient nur
der Kennzeichnung einzelner MCP-Server in der eigenen 3D-Ansicht, keiner Markenaussage.

## Enthaltene Symbole (46, Slug = Dateiname ohne `.svg`)

anthropic, airtable, asana, claude, cloudflare, confluence, discord, docker, dropbox, figma, github, gitlab,
gmail, google, googleanalytics, googlecalendar, googlechrome, googledocs, googledrive, googlemeet,
googlesheets, hubspot, jira, kubernetes, linear, meta, miro, mongodb, mysql, n8n, nginx, notion, postgresql,
redis, sentry, shopify, spotify, stripe, supabase, telegram, trello, vercel, whatsapp, youtube, zapier, zoom

Zuordnung Servername → Slug: `zuordnung.json` (Teilwort-Treffer über `icons-zuordnung.mjs#iconFuer`).

## Von Simple Icons entfernte Marken → Monogramm-Rückfall

Simple Icons hat einzelne Markenlogos auf Wunsch der Rechteinhaber oder nach Richtlinienprüfung entfernt.
Für folgende, in der Praxis häufige MCP-Dienste gibt es deshalb **keine** Slug mehr (Stand 16.33.0, geprüft
per `curl` → HTTP 404) — sie bekommen in der Ansicht ein Monogramm statt eines Logos:

- Microsoft (und damit Microsoft 365 / Outlook / Teams)
- Slack
- Canva
- Klaviyo
- OpenAI
- Playwright
- Amazon (und damit Amazon Ads)
- Salesforce
- Twilio

Ebenfalls ohne Logo, weil kein passender Slug existiert (kein Entfernen, es gab nie eines): `context7`,
`browser-use`. `chrome-devtools` bekommt trotzdem ein Logo — der Name enthält „chrome“ und trifft damit den
Google-Chrome-Slug.
