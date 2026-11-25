# Vaardigheidstoets

Webapp voor het digitaal beoordelen van brandweer-vaardigheidstoetsen. Een organiserende post zet een scenario op, maximaal 10 posten doen dezelfde inzet na elkaar, waarnemers beoordelen per functie, en aan het eind van de dag volgt een prijsuitreiking met grafieken en rapportage.

## Rollen

| Rol | Hoe | Wat |
|---|---|---|
| **Beheerder** | e-mail + wachtwoord | Maakt wedstrijddagen aan; koppelt ploegen en juryleden; richt criteria, functies en tijdregels in |
| **Jury** | e-mail + wachtwoord | Stuurt de dag aan in de console (meerdere juryleden tegelijk): start en stopt inzetten, koppelt waarnemers, past de planning aan, corrigeert scores (met toelichting), bedient de prijsuitreiking |
| **Waarnemer** | dagcode of QR-code + naam | Beoordeelt één functie van de ploeg die nu speelt, ook zonder verbinding |
| **Tijdwaarnemer** | als waarnemer, gekoppeld door de jury | Markeert ploegen als *gemeld* en *ready to start* |
| **Groot scherm** | geheime link, geen login | Live status, planning, tussenstand en prijsuitreiking voor in de zaal |

## Spelregels in de app

- Scores lopen van 4 t/m 10; bij een 4 of 5 is een toelichting verplicht. Alle criteria tellen even zwaar; het ploegtotaal is de som van alle functies.
- Bonus: 1 punt (instelbaar) per resterende minuut speeltijd en per resterende minuut redtijd. Bij gelijke stand wint de minste speeltijd.
- Beoordelen kan alleen terwijl de inzet loopt, plus een afrondtijd (standaard 5 minuten) na het einde. De server dwingt dit af, ook voor de offline wachtrij (op basis van het tijdstip van invoer).
- Een volgende inzet kan pas starten als de afrondtijd van de vorige voorbij is.
- Een ploeg kan vervallen (reden verplicht); de planning is aan te passen (tijden, volgorde, alles verschuiven).
- De jury kan achteraf scores en tijden corrigeren; een toelichting is altijd verplicht en alles komt in het logboek.
- Tijdens de prijsuitreiking stuurt de server alleen de gegevens van reeds onthulde plekken naar het groot scherm.

## Lokaal draaien

Vereist Node 20 of nieuwer.

```bash
npm install
npm start              # http://localhost:3000
```

Zonder instellingen gebruikt de app een lokaal SQLite-bestand (`data/local.db`) en maakt de beheerder `admin@example.com` / `admin12345` aan (alleen buiten productie).

```bash
npm run demo           # demo-wedstrijddag "halverwege de dag" (alleen lokaal gebruiken)
npm test               # rooktest van de hele API (tijdelijke database)
```

## Deploy op Render met Turso

1. **Database (Turso)**
   ```bash
   turso db create vaardigheidstoets
   turso db show vaardigheidstoets --url        # TURSO_DATABASE_URL
   turso db tokens create vaardigheidstoets     # TURSO_AUTH_TOKEN
   ```
   De tabellen worden bij het opstarten automatisch aangemaakt.
2. **Render**: maak een *Blueprint* aan vanuit deze repository (`render.yaml`), of een *Web Service* met build `npm ci` en start `npm start`.
3. Vul in Render de omgevingsvariabelen in (zie `.env.example`): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. `SESSION_SECRET` wordt gegenereerd; `BASE_URL` staat op `https://vaardigheidstoets.onrender.com`.
4. Log in met het beheerdersaccount, maak een wedstrijddag aan en volg de tabbladen: Algemeen → Ploegen → Juryleden → Criteria → Toegang.

> Een gratis Render-instantie valt na 15 minuten stil en heeft daarna ~1 minuut nodig om op te starten. Gebruik voor een wedstrijddag een betaald plan. Gegevens staan in Turso en gaan dus niet verloren bij een herstart.

## Op de wedstrijddag

1. Jury opent de console (`/day/<id>`); waarnemers gaan naar `/join` of scannen de QR-code (Inrichten → Toegang, of tabblad Dag in de console).
2. De jury koppelt iedere aanmelding aan een functie (of *Tijdwaarnemer*).
3. Per ploeg: tijdwaarnemer markeert *gemeld* en *ready*, de jury drukt op **Start inzet**, markeert *Slachtoffer gered* en **Einde inzet**. De waarnemers krijgen daarna afrondtijd.
4. Aan het eind: *Uitslag vergrendelen*, daarna *Prijsuitreiking* starten. Open het groot scherm (`/display/<sleutel>`) in de zaal.
5. Rapporten per ploeg (afdrukken/PDF) en een CSV-export staan onder *Dag*.

## Techniek

Node + Express, `@libsql/client` (SQLite/Turso), vanilla JavaScript-frontend zonder buildstap, realtime via Server-Sent Events. Wachtwoorden met scrypt, sessies als ondertekende cookies (HttpOnly, SameSite=Lax). Inlogpogingen en aanmeldingen zijn begrensd.

```
server.js          opstarten en routes
src/               database, logica, auth, routes, realtime-hub
public/            frontend (index.html, css, js/views)
test/smoke.mjs     rooktest van de API
scripts/demo.mjs   demodata
```
