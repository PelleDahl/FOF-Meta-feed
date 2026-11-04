# Arkitektur

## Filer

| Fil | Rolle | Ændres af |
|---|---|---|
| `merge-fof-feeds.js` | Hele generatoren. Bruger kun Node's indbyggede moduler, så der er hverken `package.json` eller `node_modules`. | Mennesker |
| `.github/workflows/merge-fof-feed.yml` | Kører scriptet, committer resultatet og tømmer CDN-cachen. | Mennesker |
| `tag-mapping.csv` | Oversætter Umbraco-tags til type og ensrettet navn. | Mennesker |
| `fof-alle-skoler-feed.xml` | Det samlede feed. | Botten |
| `fof-<skole>-feed.xml` (18 stk.) | Ét feed pr. skole, bl.a. til skolernes shops i Meta. | Botten |
| `og-image-cache.json` | Cache over metabilleder pr. kursusside. | Botten |
| `logs/` | Lokal kørselslog. Er i `.gitignore`, og oprettes af scriptet. | Scriptet |

Filnavnet `merge-fof-feeds.js` er historisk. Scriptet flettede oprindeligt fof.dk's feeds, men bygger nu alt fra søgeindekset.

## Eksterne afhængigheder

| System | Bruges til | Adgang |
|---|---|---|
| Azure AI Search `fof-ai-search`, indeks `fof-courses-production` | Hold: navn, pris, pladser, startdato, by, tag-id'er | `AZURE_SEARCH_API_KEY` |
| Azure AI Search `fof-ai-search`, indeks `fof-external-production` | Umbraco-noder: taksonomi og tag-navne | Samme nøgle |
| `www.fof.dk`, kursussider | Metabillede (`og:image`), som ikke findes i indekset | Offentlig |
| `purge.jsdelivr.net` | Tømmer CDN-cachen efter nye feeds | Offentlig |
| Meta Commerce Manager | Modtager feedene. Henter selv efter sin egen tidsplan. | Sættes op i Meta |
| GTM | Pixlen sender `content_ids` i samme format som `<g:id>` | Vedligeholdes uden for dette repo |

## Workflow

`.github/workflows/merge-fof-feed.yml`:

- **Udløses af** cron `30 */4 * * *` (UTC), push til `main` og manuelt (`workflow_dispatch`).
- **Kører på** GitHubs hostede `ubuntu-24.04` med Node 20.
- **Samtidighed:** en ny kørsel afbryder en igangværende (`cancel-in-progress`).

Trin:

1. Kører `node merge-fof-feeds.js`. Op til 3 forsøg, 10 minutter pr. forsøg.
2. Uploader feedene som artifact.
3. Committer feeds og cache som `github-actions[bot]` med beskeden `chore: update merged FOF feed`, hvis noget er ændret.
4. Tømmer jsDelivr-cachen for hvert feed, hvis der blev committet.

Bottens push starter ikke en ny kørsel, fordi GitHub ikke udløser workflows fra pushes med `GITHUB_TOKEN`. Derfor opstår der ingen løkke.

## Scriptets forløb (`mergeFeeds`)

1. Opretter logfil og sletter logs ældre end 60 dage.
2. Stopper med fejl, hvis `AZURE_SEARCH_API_KEY` mangler.
3. Henter taksonomi og tags fra `fof-external-production`.
4. For hver skole i `SCHOOL_CODES`:
   1. `buildItemsFromIndex`: filtrerer holdene og bygger `<item>`-elementer.
   2. `applyOgImages`: erstatter billedet med kursussidens `og:image`.
   3. `applyTags`: tilføjer `custom_label_3` og `internal_label`. Matcher på det rå holdnummer.
   4. `encodeImageLinks`: URL-encoder billed-URL'er. Specialtegn giver ellers HTTP 500 fra fof.dk.
   5. `applyItemIds`: sætter skolekoden foran id'et. Skal ske efter tags, fordi tags matcher på det rå nummer.
   6. `feedDropProblem`: sammenligner antallet af hold med `<item>` i den eksisterende fil. Et for stort fald gør skolen til en fejlet skole.
   7. Skriver skolens feed.
   8. `withoutDuplicateIds`: dropper og logger dubletter til det samlede feed.
5. Tjekker faldet i det samlede feed med `feedDropProblem`, hvis alle skoler lykkedes.
6. Rydder kursussider, der ikke længere er i feedet, ud af cachen, men kun hvis alle skoler lykkedes, og det samlede fald er rimeligt.
7. Skriver det samlede feed på samme betingelse.

Items behandles som tekststrenge med regex, ikke som et XML-træ. Rækkefølgen af trinene har derfor betydning.

## Konfiguration i toppen af scriptet

| Konstant | Betydning | Værdi nu |
|---|---|---|
| `SCHOOL_CODES` | Skoler i feedet og deres id-præfiks | 18 skoler |
| `UNPREFIXED_ID_SCHOOLS` | Skoler med rå holdnummer som id | KBH |
| `EXCLUDED_FROM_MERGED` | Får eget feed, men er ikke med i det samlede | Ingen |
| `OG_IMAGE_SCHOOLS`, `TAG_SCHOOLS`, `SCHOOL_FEED_SCHOOLS` | Slår funktioner til pr. skole | Alle |
| `FEED_MONTHS_AHEAD` | Hvor langt frem hold tages med | 12 måneder |
| `OG_IMAGE_CACHE_MAX_AGE_DAYS` | Hvornår et metabillede hentes igen | 7 dage |
| `OG_IMAGE_FETCH_CONCURRENCY` | Samtidige kald til fof.dk | 8 |
| `LOG_RETENTION_DAYS` | Levetid for logfiler | 60 dage |
| `MAX_SCHOOL_DROP_RATIO` | Største fald i et skolefeed på én kørsel | 50 % |
| `MAX_MERGED_DROP_RATIO` | Største fald i det samlede feed på én kørsel | 30 % |
| `MIN_ITEMS_LOST_TO_BLOCK` | Et feed skal mindst miste dette antal hold, før værnet kan slå til | 10 |
| `ALLOWED_FEED_DROPS` | Filnavne, der midlertidigt er undtaget fra værnet | Ingen |

## Fejlhåndtering

| Situation | Lokalt | I GitHub Actions |
|---|---|---|
| Nøglen mangler | Ingen feeds skrives, exit 1 | Kørslen fejler, de gamle feeds består |
| Tags eller taksonomi kan ikke hentes | Ingen feeds skrives, exit 1 | Kørslen fejler, de gamle feeds består |
| Én skole fejler | Øvrige skoler skrives, samlet feed skrives ikke, exit 1 | Prøver igen. Fejler alle 3 forsøg, committes **intet**, heller ikke de skoler, der lykkedes. |
| Et metabillede kan ikke hentes | Bruger seneste cachede værdi, ellers herobilledet, og logger en advarsel | Samme, kørslen lykkes |
| Dublet-id i det samlede feed | Holdet udelades og logges | Samme, kørslen lykkes |
| Et skolefeed mister mindst 10 hold og over 50 %, f.eks. fordi indekset returnerer 0 hold | `[ERROR]`, skolens fil beholdes, samlet feed skrives ikke, exit 1 | Som når én skole fejler: prøver igen, og fejler alle 3 forsøg, committes **intet**. |
| Det samlede feed mister mindst 10 hold og over 30 % | `[ERROR]`, samlet feed skrives ikke, cachen ryddes ikke, exit 1. Skolefeeds er allerede skrevet lokalt. | Prøver igen. Fejler alle 3 forsøg, committes **intet**. |
| Et skolefeed mister færre end 10 hold, også hvis det ender på 0 | Feedet skrives | Kørslen lykkes, og feedet committes. Se [drift.md](drift.md#kendte-risici). |

Værnet sammenligner med filen på disken. I GitHub Actions er det den seneste committede version, medmindre et tidligere forsøg i samme kørsel har skrevet filen.

Grænserne er sat ud fra feedhistorikken pr. 2026-11-04. Det største fald på én kørsel var 17 % for en skole med mindst 10 hold og 22 % for det samlede feed i de seneste 120 versioner. Historikken er kort, fordi skolefeedene kun har eksisteret siden 2026-10-23, så den dækker ikke et helt sæsonskifte. Justér grænserne, hvis værnet slår til ved normale fald.

Minimumsgrænsen på 10 hold findes, fordi små skoler kan tømmes naturligt. Fof-odder har svinget mellem 1 og 5 hold, og et brud på værnet stopper opdateringen af alle feeds.

Logfilen fra en kørsel i GitHub Actions gemmes ikke. Brug kørslens konsol-log i Actions-fanen.
