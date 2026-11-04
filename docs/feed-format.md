# Feed-format

RSS 2.0 med Googles `g:`-navnerum, optimeret til Meta. Google Merchant er ikke prioriteret endnu.

## Hvilke hold kommer med

Et hold (`docType eq 'courseVariant'` i `fof-courses-production`) kommer med, når alle disse gælder:

- Det har et holdnummer, der ikke allerede er set for skolen.
- `isPublic` er ikke `false`, og `soldOut` er ikke sand.
- `availableSeats` er over 0.
- Det har en pris. Hold uden pris er typisk aflyst i ASA, men ikke slettet i Umbraco.
- Det starter efter nu og inden for 12 måneder.

Hold, der starter i dag, er ude af feedet, når deres starttidspunkt er passeret.

## Felter

| Felt | Indhold | Kilde |
|---|---|---|
| `g:id` | Holdnummer med skolekode. Se [Id-format](#id-format). | `variantCourseNo` |
| `g:title` | Holdets navn, ellers kursets navn | `variantCourseName`, `name` |
| `g:description` | Metabeskrivelse, ellers brødtekst (maks. 5.000 tegn) | `description`, `bodyText` |
| `g:link` | `https://www.fof.dk/aftenskolen/<skole>/<kursus>?holdnr=<nr>` | `courseSlug`, `variantCourseNo` |
| `g:image_link` | Kursussidens `og:image`, ellers herobillede med `?width=1200` | fof.dk, `imageUrl` |
| `g:availability` | Altid `in_stock` | Fast |
| `g:quantity` | Altid `1`, uanset ledige pladser | Fast |
| `g:price` | Pristypen `ALMEN`, ellers standardprisen, ellers første pris. Fx `200.00 DKK`. | `prices` |
| `g:condition` | Altid `new` | Fast |
| `g:brand` | Skolens navn | `associationName` |
| `g:google_product_category`, `g:fb_product_category` | Altid `Education` | Fast |
| `g:product_type` | Taksonomiens sti, fx `Kurser > Sprog > Italiensk` | `taxonomyPaths` (den længste sti) |
| `g:custom_label_0` til `2` | Niveau 1 til 3 i taksonomien. Kan være tomme. | `taxonomyPaths` |
| `g:custom_label_3` | Holdets **første** tag i Umbracos rækkefølge (maks. 100 tegn) | `tagIds`, `tag-mapping.csv` |
| `g:custom_label_4` | By uden postdistrikt: `København K` bliver til `København`. Tom for hold uden by, fx online. | `cities` |
| `g:internal_label` | **Alle** tags plus postdistrikt som liste, fx `['Korte kurser','København V']` | `tagIds`, `cities` |
| `g:start_date` | Starttidspunkt (ISO 8601) | `variantStartDate` |

`custom_label_3` og `internal_label` står efter `start_date` og udelades, når holdet ikke har noget at sætte i dem.

Custom labels kan kun rumme én værdi, når der skal filtreres i Meta. Derfor ligger listen af tags i `internal_label`.

## Id-format

| Skole | Format | Eksempel |
|---|---|---|
| FOF København og Nordsjælland | Rå holdnummer | `26260904` |
| Alle andre | `<KODE>-<holdnummer>` | `AAR-264364` |

Formatet er det samme i skolefeeds og i det samlede feed. Nogle holdnumre bruges af flere skoler, og præfikset holder id'erne unikke på tværs.

**Pixlen sender samme værdi som `content_ids` via GTM.** Ændres formatet her, skal GTM ændres samtidig, og Meta vil se alle berørte hold som nye produkter.

### Skolekoder

| Skole (slug) | Kode |
|---|---|
| `fof-djursland` | DJU |
| `fof-herning` | HER |
| `fof-nordvestjylland` | NVJ |
| `fof-odder` | ODD |
| `fof-randers-favrskov-mariagerfjord-viborg` | RFMV |
| `fof-sydjylland` | SJY |
| `fof-sydoestjylland` | SOJ |
| `fof-soenderjylland` | SDJ |
| `fof-sydvestjylland` | SVJ |
| `fof-aalborg` | AAL |
| `fof-aarhus` | AAR |
| `fof-fyn-fredericia` | FYN |
| `fof-oestfyn` | OFY |
| `fof-koebenhavn-og-nordsjaelland` | KBH (bruges ikke i id) |
| `fof-koebenhavns-omegn` | KBO |
| `fof-koege-bugt` | KOE |
| `fof-syd-og-vestsjaelland` | SVS |
| `fof-sydoest` | SYO |

Bevidst ikke med: **Fjordlandet** er fjernet, og **Vendsyssel** har aldrig været med.

## Metabilleder

Indekset har kun kursets herobillede, så scriptet henter hver kursusside og bruger dens `og:image`.

- `og:image` på fof.dk peger på Next.js' billedproxy (`/_next/image?url=…`). Scriptet bruger den underliggende `/media/…`-URL.
- Resultatet caches pr. kursus-URL i `og-image-cache.json` og hentes igen efter 7 dage, så ændringer i Umbraco slår igennem inden for en uge.
- Slet en post i cachen for at tvinge en ny hentning.
- Tømmes hele cachen, henter næste kørsel alle sider. Det tager ca. 2 minutter.

## Tags

Indeksets `tags`-felt er tomt. Holdene har i stedet `tagIds`, der peger på `tag`-noder i `fof-external-production` (`x__Key` til `nodeName`). Hvert id slås derefter op i `tag-mapping.csv`.

### tag-mapping.csv

Semikolonsepareret UTF-8, som kan åbnes direkte i dansk Excel.

| Kolonne | Bruges af scriptet | Betydning |
|---|---|---|
| `tag_id` | Ja | Nøgle (Umbraco `x__Key`) |
| `type` | Ja | `sted`, `format`, `emne`, `målgruppe`, `tid`, `kampagne`, `underviser` eller `intern` |
| `normaliseret` | Ja | Ensrettet navn i feedet, fx `hold køge` til `Køge`. Er feltet tomt, bruges `tag`. |
| `tag` | Kun som reserve | Navnet i Umbraco |
| `skole`, `hold_nu`, `gaet_grundlag` | Nej | Til orientering |

- Tags af typen `intern` og `underviser` kommer ikke med i feedet.
- Tags, der ikke står i filen, kommer med under deres Umbraco-navn, og loggen skriver `[TAGS] … not in tag-mapping.csv`. Tilføj dem med type og navn.
- Første udkast blev genereret automatisk (`gaet_grundlag` viser hvordan) og er ikke nødvendigvis gennemgået i sin helhed.
