# FOF Feed Generator

Bygger Meta/Google-produktfeeds for alle FOF-skoler direkte fra FOF's søgeindeks i Azure AI Search: ét samlet feed (`fof-alle-skoler-feed.xml`) og ét feed pr. skole (`<slug>-feed.xml`).

## Live feed-URL'er

Samlet feed (alle skoler):

```
https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-alle-skoler-feed.xml
```

Skolefeeds — ét feed pr. skole, f.eks. til skolens egen shop/katalog i Meta. `<g:id>` er det rå holdnummer uden skolepræfiks, så det matcher holdnummeret i pixel-events:

| Skole | URL |
|---|---|
| fof-djursland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-djursland-feed.xml` |
| fof-herning | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-herning-feed.xml` |
| fof-nordvestjylland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-nordvestjylland-feed.xml` |
| fof-odder | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-odder-feed.xml` |
| fof-randers-favrskov-mariagerfjord-viborg | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-randers-favrskov-mariagerfjord-viborg-feed.xml` |
| fof-sydjylland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-sydjylland-feed.xml` |
| fof-sydoestjylland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-sydoestjylland-feed.xml` |
| fof-soenderjylland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-soenderjylland-feed.xml` |
| fof-sydvestjylland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-sydvestjylland-feed.xml` |
| fof-aalborg | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-aalborg-feed.xml` |
| fof-aarhus | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-aarhus-feed.xml` |
| fof-fyn-fredericia | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-fyn-fredericia-feed.xml` |
| fof-oestfyn | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-oestfyn-feed.xml` |
| fof-koebenhavn-og-nordsjaelland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-koebenhavn-og-nordsjaelland-feed.xml` |
| fof-koebenhavns-omegn | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-koebenhavns-omegn-feed.xml` |
| fof-koege-bugt | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-koege-bugt-feed.xml` |
| fof-syd-og-vestsjaelland | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-syd-og-vestsjaelland-feed.xml` |
| fof-sydoest | `https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-sydoest-feed.xml` |

Skolefeeds styres af `SCHOOL_FEED_SCHOOLS` i `merge-fof-feeds.js` (pt. alle skoler). Fejler opslaget i indekset for en skole, overskrives skolens fil ikke, så den seneste gode version bliver liggende.

## Kørsel

```
node merge-fof-feeds.js
```

## Hvad scriptet gør

1. Henter tag-navne og taksonomien fra `fof-external-production`.
2. Bygger items for hver skole i `SCHOOL_CODES` direkte fra `fof-courses-production` — se [Kilde: søgeindeks](#kilde-søgeindeks).
3. For skolerne i `OG_IMAGE_SCHOOLS` (pt. alle skoler) erstattes `<g:image_link>` med kursussidens metabillede (`og:image`) i stedet for herobilledet — se [Metabilleder](#metabilleder-ogimage).
4. For skolerne i `TAG_SCHOOLS` (pt. alle skoler) tilføjes holdets tags fra søgeindekset — se [Tags](#tags).
5. URL-encoder `<g:image_link>` for alle skoler. Filnavne med specialtegn (f.eks. `oh-lá-lá.jpg`) giver ellers HTTP 500 fra fof.dk, og billedet afvises af Meta/Google.
6. Skriver et skolefeed (`<slug>-feed.xml`) for hver skole i `SCHOOL_FEED_SCHOOLS` (uden id-præfiks).
7. Præfikser `<g:id>` med skolens korte kode (se nedenfor), f.eks. `264364` → `DJU-264364`. Uden præfikset kan to skoler tilfældigt bruge samme holdnummer, hvilket giver dubletter i den samlede feed — præfikset gør hvert `<g:id>` unikt på tværs af skoler.
8. Samler alle items fra alle skoler — undtagen skolerne i `EXCLUDED_FROM_MERGED` — i én fælles `<rss>`-feed og skriver den til `fof-alle-skoler-feed.xml`.
9. Logger resultatet af kørslen til `logs/feed-merge-YYYY-MM-DD.log`. Logfiler ældre end 60 dage (`LOG_RETENTION_DAYS`) slettes automatisk ved næste kørsel.

Fejler opslaget for en skole, logges fejlen, skolens feed opdateres ikke, og scriptet fortsætter med de øvrige skoler. Det samlede feed skrives kun, når alle skoler er bygget — ellers ender kørslen med en fejl (exit code 1), så workflowen prøver igen, og det forrige samlede feed bliver liggende. Mangler `AZURE_SEARCH_API_KEY`, eller fejler opslaget af tags/taksonomi, skrives ingen feeds.

## Kilde: søgeindeks

Alle feeds bygges fra `fof-courses-production` i Azure AI Search (`fof-ai-search`). fof.dk's egne natlige feeds (`/feeds/<skole>/feed.xml`) bruges ikke, fordi de mangler ca. 25 % af de ledige hold — se [fejlrapporten](docs/fejlrapport-fof-feeds.md).

- Kun kommende, offentlige hold med ledige pladser (og ikke markeret udsolgt) og en pris, der starter inden for 12 måneder (`FEED_MONTHS_AHEAD`). Prisen i feedet er den almene pris (type `ALMEN`), ellers standardprisen, ellers første pris.
- Samme felter: titel, beskrivelse (metabeskrivelse), link (`/aftenskolen/<skole>/<kursus>?holdnr=<nr>`), pris, brand, `product_type` og `custom_label_0–2` fra taksonomien. Taksonomiens navne slås op i `fof-external-production`.
- Sammenlignet med fof.dk's KBH-feed er titel, beskrivelse, pris, brand og kategorier identiske for alle hold, der findes i begge.
- Kræver `AZURE_SEARCH_API_KEY` (query-nøgle, kun læseadgang). I GitHub Actions ligger den som repository secret med samme navn.
- For skoler uden for `OG_IMAGE_SCHOOLS` bruges kursets herobillede (`imageUrl`).

## Metabilleder (og:image)

Indekset har kun kursets herobillede (`imageUrl`). For skolerne i `OG_IMAGE_SCHOOLS` henter scriptet i stedet hver kursusside og bruger dens `og:image` — det metabillede, der er sat i Umbraco.

- `og:image` på fof.dk peger på Next.js' billedproxy (`/_next/image?url=…`). Scriptet bruger den underliggende `/media/…`-URL.
- Resultatet caches pr. kursus-URL i `og-image-cache.json`, som committes af workflowen. En side hentes igen, når den er ældre end `OG_IMAGE_CACHE_MAX_AGE_DAYS` (7 dage), så ændrede metabilleder slår igennem inden for en uge. Slet en linje i cachen for at tvinge en ny hentning.
- Fejler hentningen af en kursusside, bruges seneste cachede værdi, og ellers beholdes herobilledet.
- Kursussider, der ikke længere er i feedet, ryddes fra cachen.

Tilføj en skoles slug til `OG_IMAGE_SCHOOLS` for at slå det til for flere skoler. Første kørsel henter alle kursussider (ca. 2 min. for alle skoler); derefter kun nye kurser og sider ældre end 7 dage.

## Tags

For skolerne i `TAG_SCHOOLS` slår scriptet holdets tags op i FOF's Azure AI Search (`fof-ai-search`):

- Holdene hentes fra `fof-courses-production` (`docType eq 'courseVariant'`, filtreret på `associationSlug`) og matches på holdnummer (`variantCourseNo` = `<g:id>`). Indeksets `tags`-felt er tomt, så tag-navnene slås op via `tagIds` i `tag`-noderne i `fof-external-production` (`x__Key` → `nodeName`).
- Tags slås op i [`tag-mapping.csv`](tag-mapping.csv), der pr. tag-id angiver en `type` (sted, format, emne, målgruppe, tid, kampagne, underviser, intern) og et ensrettet navn (`normaliseret`), f.eks. `hold køge` → Køge. Tags af typen `intern` og `underviser` kommer ikke med.
- `<g:custom_label_3>` er holdets første tag og `<g:custom_label_4>` det andet (én værdi hver, i Umbracos rækkefølge). `<g:internal_label>` indeholder alle holdets tags i Metas listeformat, f.eks. `['Grenaa','Nyhed','Korte kurser']`, til filtrering af produktsæt.
- Nye tags, der ikke står i `tag-mapping.csv`, kommer med under deres Umbraco-navn og logges (`[TAGS] … not in tag-mapping.csv`). Tilføj dem til filen med type og ensrettet navn.
- Hold uden tags får ingen tag-felter.

### Vedligehold af tag-mapping.csv

Semikolonsepareret UTF-8 (åbner direkte i dansk Excel). Kun kolonnerne `type` og `normaliseret` bruges af scriptet; `tag_id` er nøglen, og `skole`, `tag`, `hold_nu` og `gaet_grundlag` er til orientering. Udkastet blev genereret automatisk ud fra tag-navnene (`gaet_grundlag` viser hvordan) og bør gennemgås.

## Skolekoder

Hver skole har en fast, kort kode i `SCHOOL_CODES`, der bruges som præfiks foran `<g:id>`:

| Skole | Kode |
|---|---|
| fof-djursland | DJU |
| fof-herning | HER |
| fof-nordvestjylland | NVJ |
| fof-odder | ODD |
| fof-randers-favrskov-mariagerfjord-viborg | RFMV |
| fof-sydjylland | SJY |
| fof-sydoestjylland | SOJ |
| fof-soenderjylland | SDJ |
| fof-sydvestjylland | SVJ |
| fof-aalborg | AAL |
| fof-aarhus | AAR |
| fof-fyn-fredericia | FYN |
| fof-oestfyn | OFY |
| fof-koebenhavn-og-nordsjaelland | KBH |
| fof-koebenhavns-omegn | KBO |
| fof-koege-bugt | KOE |
| fof-syd-og-vestsjaelland | SVS |
| fof-sydoest | SYO |

## Tilføje eller fjerne en skole

1. Tilføj/fjern skolen i `SCHOOL_CODES` (slug = `associationSlug` i søgeindekset).
2. Tilføj/fjern skolens URL i tabellen øverst.
3. Kør scriptet igen. En fjernet skoles `<slug>-feed.xml` skal slettes manuelt.

## Kendte fravalg

- **FOF København og Nordsjælland** er midlertidigt holdt ude af det samlede feed (`EXCLUDED_FROM_MERGED`), indtil skolen aktivt har sagt ja til at indgå. KBH's hold findes kun i skolens eget feed. Fjern slug'en fra `EXCLUDED_FROM_MERGED` for at tage KBH med igen.
- **Fjordlandet** er bevidst fjernet fra feedet.
- **Vendsyssel** har aldrig indgået i feedet.
