# Fejlrapport: fof.dk's produktfeeds mangler ca. 25 % af de ledige hold

**Til:** udvikleren af FOFFrontend (`scripts/generate-feeds.ts`, pipeline `azure-pipelines-feeds.yml`)
**Fra:** Pelle Dahl Skovmøller
**Dato:** 2026-10-20

## Kort fortalt

De statiske feeds under `https://www.fof.dk/feeds/<skole>/feed.xml` mangler hold, som opfylder feedets egne udvælgelsesregler: start inden for 12 måneder, ledige pladser og en normalpris. Det rammer alle 18 skoler. Typisk mangler hele kurser og ikke enkelte hold.

## Omfang

Hvert skolefeed er sammenlignet med `fof-courses-production` i Azure AI Search, med samme regler som `filterCourseVariantsForFeed`. Feeds genereret 2026-10-19 ca. kl. 00:00–00:25 UTC, indekset læst 2026-10-20.

| Skole | I feedet | Opfylder reglerne i indekset | Mangler i feedet |
|---|---:|---:|---:|
| fof-koebenhavn-og-nordsjaelland | 494 | 682 | 216 |
| fof-koebenhavns-omegn | 202 | 282 | 83 |
| fof-aarhus | 160 | 222 | 67 |
| fof-soenderjylland | 82 | 141 | 61 |
| fof-syd-og-vestsjaelland | 106 | 138 | 40 |
| fof-sydoestjylland | 59 | 94 | 36 |
| fof-aalborg | 106 | 129 | 29 |
| fof-sydjylland | 143 | 163 | 22 |
| fof-koege-bugt | 87 | 104 | 21 |
| fof-randers-favrskov-mariagerfjord-viborg | 59 | 73 | 21 |
| fof-fyn-fredericia | 26 | 41 | 18 |
| fof-herning | 41 | 49 | 12 |
| fof-djursland | 44 | 54 | 10 |
| fof-nordvestjylland | 60 | 65 | 9 |
| fof-sydoest | 26 | 34 | 9 |
| fof-sydvestjylland | 48 | 51 | 7 |
| fof-oestfyn | 24 | 29 | 6 |
| fof-odder | 3 | 5 | 2 |

## Eksempler (KBH)

Alle hold nedenfor er offentlige, har ledige pladser og en normalpris, starter inden for 12 måneder og står på kursussiden på fof.dk. De er ikke i feedet:

| Holdnr. | Kursus | Start | Ledige pladser |
|---|---|---|---:|
| 27100018 | bente-klarlund-staerk-inderst-inde-og-udenpaa | 2027-03-04 | 200 |
| 27113607 | hamlets-helsingoer-fra-myte-til-brand | 2027-04-11 | 19 |
| 27100025 | only-in-america-live | 2026-11-26 | 83 |
| 26245230 | glaskursus-med-fusing-for-familier | 2026-11-08 | 7 |
| 27151908 | tvaerfloejte | 2027-01-04 | 2 |
| 26220848 | boernemotorik-og-tumlingeleg | 2026-10-27 | 8 |

## Det er udelukket

- **Filterreglerne:** de manglende hold opfylder alle betingelser i `filterCourseVariantsForFeed`.
- **Datakvalitet:** de manglende hold har billede, beskrivelse, pris og kategori i samme omfang som dem, der er med.
- **Timing:** de manglende hold er oprettet i samme periode (april–oktober 2026) som dem, der er med. Eksempel: 27100018 er oprettet 2026-10-01 og opdateret 2026-10-15, før feedet blev genereret 2026-10-19.
- **`MAX_RAW_VARIANTS = 4000`:** KBH har ca. 2.520 publicerede hold i Umbraco.

## Formodet årsag

Kun 6 af KBH's 216 manglende hold hører til et kursus, der ellers er med i feedet. Det tyder på, at hele sider af kurser falder ud under hentningen i `loadAllCourseVariantsData` (`src/lib/umbraco/loaders/load.allCourseVariants.ts`):

```ts
hasMorePages = courses.length === PAGE_SIZE
```

Løkken stopper, så snart en side indeholder færre end `PAGE_SIZE` (50) kurser. Hvis courses-API'et filtrerer kurser fra efter pagineringen (fx kurser uden publicerede hold, med `expandChildren: true`), kan en side midt i resultatet have under 50 kurser. Så stopper løkken for tidligt, og alle kurser på de efterfølgende sider forsvinder.

Vi har ikke kunnet bekræfte det, fordi courses-API'et ikke er tilgængeligt uden for jeres netværk (403 fra Application Gateway).

## Forslag til at bekræfte og rette

1. Kør `pnpm run generate-feeds fof-koebenhavn-og-nordsjaelland`, og sammenlign `Loaded X raw variants` med antallet af hold i Umbraco. Log også `courses.length` pr. side.
2. Stop pagineringen ud fra `total` (eller tilsvarende) i API-svaret i stedet for `courses.length === PAGE_SIZE`, eller fortsæt til en side er tom.
3. Bonus: `force-cache` med `revalidate: 3600` i loaderen er unødvendigt i et natligt script og kan give gammel data, hvis cachen bliver genbrugt.

## Midlertidig løsning hos os

Feed-generatoren i `PelleDahl/FOF-Meta-feed` bygger nu KBH's feed direkte fra `fof-courses-production` med samme felter og regler som jeres generator. Indholdet er sammenlignet med jeres KBH-feed for de 457 hold, der findes i begge: titel, beskrivelse, pris, brand, kategorier og custom labels er identiske.
