# Drift

## Tjek at alt kører

1. **Kørsler:** <https://github.com/PelleDahl/FOF-Meta-feed/actions>. Workflowet hedder *Merge FOF Product Feeds*.
2. **Seneste feed:** seneste commit fra `github-actions[bot]` på `main`.
3. **Meta:** datakilder og diagnostik i Commerce Manager. Der er ingen API-adgang til Meta fra Claude. Brug skærmbilleder eller Claude in Chrome.

Planlagte kørsler er sat til hver 4. time, men GitHub forsinker dem. I perioden frem til 2026-11-04 var der i gennemsnit 7,2 timer mellem kørslerne og højst 12,1. Det er normalt. Kræver noget hurtig opdatering, så start workflowet manuelt under *Run workflow*.

Der er ikke sat alarmer op. En fejlet kørsel ses i Actions-fanen og kan give en mail fra GitHub, afhængigt af kontoens notifikationer.

## Feed-URL'er

Filerne på `main` kan hentes tre steder fra. Alle viser samme indhold:

| Kilde | URL | Content-Type | Bemærkning |
|---|---|---|---|
| jsDelivr **(brug denne)** | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/<fil>` | `application/xml` | Cachen tømmes efter hver opdatering |
| GitHub Pages | `https://pelledahl.github.io/FOF-Meta-feed/<fil>` | `application/xml` | Slået til i repoet |
| GitHub raw | `https://raw.githubusercontent.com/PelleDahl/FOF-Meta-feed/main/<fil>` | `text/plain` | Den oprindelige URL. Forkert content-type. |

Skift til jsDelivr blev testet i et testkatalog i august 2026, men det er ikke registreret, om alle produktionskataloger er flyttet. **Slå derfor ikke Pages fra, og gør ikke repoet privat, før det er tjekket i Commerce Manager.** Et privat repo vil stoppe alle tre URL'er.

## Kør lokalt

Kræver Node 20 eller nyere og en query-nøgle. Kør fra roden af repoet, fordi output skrives til den aktuelle mappe.

```powershell
$env:AZURE_SEARCH_API_KEY = "<query-nøgle>"
node merge-fof-feeds.js
```

Kørslen overskriver feedfilerne og cachen lokalt. Det er meningen, at botten committer dem, så smid dem væk igen, medmindre du har en grund til andet:

```bash
git restore fof-*-feed.xml og-image-cache.json
```

## Nøgler og adgang

| Hemmelighed | Hvor | Bemærkning |
|---|---|---|
| `AZURE_SEARCH_API_KEY` | GitHub: *Settings → Secrets and variables → Actions* | Query-nøgle med læseadgang. Ligger ikke i repoet. |

**Skift af nøglen:** opret en ny query-nøgle i Azure Portal (`fof-ai-search` → *Keys*), opdatér secret'en, start workflowet manuelt, og slet først den gamle nøgle, når kørslen er grøn.

Git-remoten bruger et SSH-alias (`git@github.com-work:PelleDahl/FOF-Meta-feed.git`), der kræver en tilsvarende indgang i `~/.ssh/config`. Klon på en ny maskine med `git@github.com:PelleDahl/FOF-Meta-feed.git`, hvis aliaset ikke findes.

## Almindelige opgaver

### Tilføj eller fjern en skole

1. Tilføj eller fjern skolen i `SCHOOL_CODES`. Slug er `associationSlug` i indekset.
2. Tilføj eller fjern skolens URL i `README.md` og koden i [feed-format.md](feed-format.md#skolekoder).
3. Tilføj koden i GTM, så pixlen sender samme id som feedet.
4. Push. Kørslen laver det nye feed. Feedet for en fjernet skole skal slettes manuelt.

### Tilføj nye tags

Søg efter `not in tag-mapping.csv` i kørslens log, tilføj linjerne i `tag-mapping.csv`, og push.

### Fejlsøg et manglende hold

Tjek i denne rækkefølge:

1. Opfylder holdet [reglerne](feed-format.md#hvilke-hold-kommer-med)? Typisk er det startet eller uden ledige pladser.
2. Findes holdet i `fof-courses-production` med det rigtige `associationSlug`?
3. Er det i `fof-<skole>-feed.xml` på `main`? Så ligger problemet mellem feed og Meta.
4. Har Meta hentet feedet siden? Tjek datakildens seneste hentning og diagnostikken.

## Fejlsøgning

| Symptom | Sandsynlig årsag | Løsning |
|---|---|---|
| `[FATAL] AZURE_SEARCH_API_KEY is not set` | Secret mangler | Sæt secret'en |
| `HTTP 403` fra søgeindekset | Nøglen er ugyldig eller slettet | Skift nøgle |
| `[ERROR] <skole>: …` på alle tre forsøg | Indeksfejl eller ændret slug | Se fejlbeskeden. Intet committes, så Meta bevarer gamle data. |
| `[WARN] og:image could not be fetched` | Kursusside utilgængelig | Som regel harmløst. Falder tilbage til cache eller herobillede. |
| Mange billeder afvises af Meta | fof.dk ændrer billed-URL'er | Tjek `g:image_link` i feedet i en browser |
| Mange produkter forsvinder i Meta | Tomt feed eller ændret id-format | Tjek antal `<item>` og seneste ikke-bot-commit |
| Workflowet kører ikke længere | GitHub slår planlagte kørsler fra efter 60 dage uden aktivitet i repoet | Aktivér igen under Actions |

### Rul et feed tilbage

Find seneste gode commit, og gendan filen. Næste kørsel overskriver den igen, så ret årsagen samtidig.

```bash
git checkout <commit> -- fof-alle-skoler-feed.xml
```

## Kendte risici

| Risiko | Konsekvens | Status |
|---|---|---|
| **Intet værn mod tomme feeds.** Returnerer indekset 0 hold uden fejl, committes et tomt feed. | Meta kan fjerne produkterne fra kataloget, og produktsæt og annoncer rammes. | Åben. Bør have en grænse for, hvor meget et feed må falde. |
| **Node 20 har nået end-of-life** (april 2026). | Ingen akut fejl, men ingen sikkerhedsopdateringer. | Åben. Hæv `node-version` i workflowet. Scriptet bruger kun indbyggede moduler. |
| **Repoet ligger på en personlig GitHub-konto.** Adgang og URL'er følger `PelleDahl`. | En flytning til en organisation ændrer alle feed-URL'er og kræver opdatering af alle kataloger i Meta. | Kendt. Planlæg det som en samlet flytning. |
| **Én skole, der fejler, blokerer alle skoler** i GitHub Actions. | Feedene bliver ikke opdateret, før fejlen er væk. Data ældes, men forsvinder ikke. | Bevidst valg. |
| **Git-historikken vokser** med hver feed-commit (ca. 34 MB efter 4,5 måneder). | Ingen problemer nu. | Holdes øje med. |

## Uden for dette repo

Følgende hører ikke til produktionen af feeds, men ligger tæt på og kan forveksles med den:

- **Den gamle løsning:** mappen `XML Feed` i OneDrive og den planlagte Windows-opgave *Generer samlet XML Feed FOF* er forgængeren fra februar 2026. Opgaven er aldrig blevet kørt, og den skriver kun en lokal fil.
- **Søgeindekset:** vedligeholdes i et separat projekt.
- **GTM og pixel:** vedligeholdes i et separat repo.
- **Tagging-værktøjet:** et separat projekt med egen MCP-server. Feed-generatoren bruger den ikke.
