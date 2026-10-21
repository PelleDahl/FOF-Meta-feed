# FOF Feed Generator

Samler produktfeeds fra alle FOF-skoler til én fælles Meta/Google-produktfeed (`fof-alle-skoler-feed.xml`).

## Live feed-URL'er

Samlet feed (alle skoler):

```
https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-alle-skoler-feed.xml
```

FOF København og Nordsjælland (kun KBH's hold; `<g:id>` er det rå holdnummer uden `KBH-`-præfiks, så det matcher holdnummeret i pixel-events):

```
https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-koebenhavn-og-nordsjaelland-feed.xml
```

Skoler med eget feed konfigureres i `SCHOOL_FEEDS` i `merge-fof-feeds.js`. Fejler hentningen af skolens kildefeed, overskrives dens egen fil ikke, så den seneste gode version bliver liggende.

Brug denne URL i Meta Commerce Manager / Google Merchant Center — **ikke** `raw.githubusercontent.com`. GitHub's raw-service sender altid `Content-Type: text/plain`, hvilket kan få feed-parsere til at afvise eller fejllæse filen. jsDelivr spejler samme GitHub-repo, men sætter korrekt `Content-Type: application/xml`.

jsDelivr's CDN cacher indhold i op til ca. 24 timer efter et push til `main`. Skal ændringer slå igennem med det samme, kan cachen purges manuelt via: `https://purge.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-alle-skoler-feed.xml`

## Kørsel

```
node merge-fof-feeds.js
```

## Hvad scriptet gør

1. Henter XML-feedet for hver skole i `FEED_URLS`.
2. Udtrækker alle `<item>`-elementer fra hvert feed. For skolerne i `INDEX_SOURCE_SCHOOLS` (pt. alle skoler) bygges items i stedet direkte fra søgeindekset — se [Kilde: søgeindeks](#kilde-søgeindeks-i-stedet-for-fofdks-feed).
3. For skolerne i `OG_IMAGE_SCHOOLS` (pt. alle skoler) erstattes `<g:image_link>` med kursussidens metabillede (`og:image`) i stedet for herobilledet — se [Metabilleder](#metabilleder-ogimage).
4. For skolerne i `TAG_SCHOOLS` (pt. alle skoler) tilføjes holdets tags fra søgeindekset — se [Tags](#tags).
5. URL-encoder `<g:image_link>` for alle skoler. Filnavne med specialtegn (f.eks. `oh-lá-lá.jpg`) giver ellers HTTP 500 fra fof.dk, og billedet afvises af Meta/Google.
6. Skriver skolens eget feed for skolerne i `SCHOOL_FEEDS` (uden id-præfiks).
7. Præfikser `<g:id>` med skolens korte kode (se nedenfor), f.eks. `264364` → `DJU-264364`. Uden præfikset kan to skoler tilfældigt bruge samme holdnummer, hvilket giver dubletter i den samlede feed — præfikset gør hvert `<g:id>` unikt på tværs af skoler.
8. Samler alle items fra alle skoler — undtagen skolerne i `EXCLUDED_FROM_MERGED` — i én fælles `<rss>`-feed og skriver den til `fof-alle-skoler-feed.xml`.
9. Logger resultatet af kørslen til `logs/feed-merge-YYYY-MM-DD.log`. Logfiler ældre end 60 dage (`LOG_RETENTION_DAYS`) slettes automatisk ved næste kørsel.

Fejler hentning af et enkelt skolefeed (timeout, non-200, for mange redirects), logges fejlen, og scriptet fortsætter med de øvrige skoler.

## Kilde: søgeindeks i stedet for fof.dk's feed

fof.dk's natlige feeds (`/feeds/<skole>/feed.xml`) mangler ca. 25 % af de ledige hold på tværs af alle skoler — se [fejlrapporten](docs/fejlrapport-fof-feeds.md). For skolerne i `INDEX_SOURCE_SCHOOLS` bygger scriptet derfor items direkte fra `fof-courses-production` i Azure AI Search:

- Kun kommende, offentlige hold med ledige pladser (og ikke markeret udsolgt) og en pris, der starter inden for 12 måneder (`FEED_MONTHS_AHEAD`). Prisen i feedet er den almene pris (type `ALMEN`), ellers standardprisen, ellers første pris.
- Samme felter: titel, beskrivelse (metabeskrivelse), link (`/aftenskolen/<skole>/<kursus>?holdnr=<nr>`), pris, brand, `product_type` og `custom_label_0–2` fra taksonomien. Taksonomiens navne slås op i `fof-external-production`.
- Sammenlignet med fof.dk's KBH-feed er titel, beskrivelse, pris, brand og kategorier identiske for alle hold, der findes i begge.
- Kræver `AZURE_SEARCH_API_KEY`. Mangler nøglen, eller fejler opslaget, falder scriptet tilbage til fof.dk's feed for skolen.

Alle 18 skoler bygges fra indekset. For skoler uden for `OG_IMAGE_SCHOOLS` bruges kursets herobillede (`imageUrl`).

## Metabilleder (og:image)

Skolernes feeds bruger kursets herobillede som `<g:image_link>`. For skolerne i `OG_IMAGE_SCHOOLS` henter scriptet i stedet hver kursusside og bruger dens `og:image` — det metabillede, der er sat i Umbraco.

- `og:image` på fof.dk peger på Next.js' billedproxy (`/_next/image?url=…`). Scriptet bruger den underliggende `/media/…`-URL.
- Resultatet caches pr. kursus-URL i `og-image-cache.json`, som committes af workflowen. En side hentes igen, når den er ældre end `OG_IMAGE_CACHE_MAX_AGE_DAYS` (7 dage), så ændrede metabilleder slår igennem inden for en uge. Slet en linje i cachen for at tvinge en ny hentning.
- Fejler hentningen af en kursusside, bruges seneste cachede værdi, og ellers beholdes herobilledet.
- Kursussider, der ikke længere er i feedet, ryddes fra cachen.

Tilføj en skoles slug til `OG_IMAGE_SCHOOLS` for at slå det til for flere skoler. Første kørsel henter alle kursussider (ca. 2 min. for alle skoler); derefter kun nye kurser og sider ældre end 7 dage.

## Tags

For skolerne i `TAG_SCHOOLS` slår scriptet holdets tags op i FOF's Azure AI Search (`fof-ai-search`):

- Holdene hentes fra `fof-courses-production` (`docType eq 'courseVariant'`, filtreret på `associationSlug`) og matches på holdnummer (`variantCourseNo` = `<g:id>` i skolens kildefeed). Indeksets `tags`-felt er tomt, så tag-navnene slås op via `tagIds` i `tag`-noderne i `fof-external-production` (`x__Key` → `nodeName`).
- Tags skrives som `<g:custom_label_3>` (kommasepareret, maks. 100 tegn) og `<g:internal_label>` (Metas listeformat, f.eks. `['Foredrag','Debat']`) — i skolens eget feed og, hvis skolen indgår der, i det samlede feed.
- Kræver miljøvariablen `AZURE_SEARCH_API_KEY` (query-nøgle, kun læseadgang). I GitHub Actions ligger den som repository secret med samme navn. Mangler nøglen, eller fejler opslaget, logges en advarsel, og feedet bygges uden tags.
- Hold, der endnu ikke er i indekset, eller som ikke har tags, får ingen tag-felter.

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

Har en skole ingen kode i `SCHOOL_CODES`, bruges hele skoleslugen som fallback-præfiks, så `<g:id>` altid forbliver unikt.

## Tilføje eller fjerne en skole

1. Tilføj/fjern skolens feed-URL i `FEED_URLS`.
2. Tilføj/fjern en tilsvarende kode i `SCHOOL_CODES`.
3. Kør scriptet igen for at opdatere `fof-alle-skoler-feed.xml`.

## Kendte fravalg

- **FOF København og Nordsjælland** er midlertidigt holdt ude af det samlede feed (`EXCLUDED_FROM_MERGED`), indtil skolen aktivt har sagt ja til at indgå. KBH's hold findes kun i skolens eget feed. Fjern slug'en fra `EXCLUDED_FROM_MERGED` for at tage KBH med igen.
- **Fjordlandet** er bevidst fjernet fra feedet.
- **Vendsyssel** har aldrig indgået i feedet.
