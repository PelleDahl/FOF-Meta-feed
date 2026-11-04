# Beslutninger og historik

Hvorfor projektet ser ud, som det gør. Læs dette, før du foreslår en større ændring, så det samme ikke afprøves igen.

## Tidslinje

| Dato | Hvad | Hvorfor |
|---|---|---|
| 2026-02 | Lokalt PowerShell-script samler fof.dk's feeds | Første version, uden for dette repo |
| 2026-06-15 | Repoet oprettes. GitHub Actions fletter fof.dk's feeds. | Automatisering |
| 2026-08-06 | Workflowet flyttes til en selvhostet Windows-runner | Årsagen er ikke dokumenteret |
| 2026-08-07 | Tilbage til GitHubs hostede runner, `cancel-in-progress` tilføjes | Kørsler hobede sig op i køen |
| 2026-08-27 | jsDelivr-URL og automatisk cache-tømning | `raw.githubusercontent.com` leverer `text/plain` |
| 2026-10-20 | Fejlrapport til fof.dk. KBH bygges fra søgeindekset. | fof.dk's feeds mangler ca. 25 % af de ledige hold |
| 2026-10-20 | Metabillede hentes fra kursussiderne | Metabilledet findes ikke i indekset |
| 2026-10-21 | `tag-mapping.csv` indføres | Tags i Umbraco er uensartede |
| 2026-10-23 | Alle skoler bygges kun fra indekset, med ét feed pr. skole | Skolerne skal have hver deres shop i Meta |
| 2026-10-23 | By i `custom_label_4`, postdistrikt i `internal_label` | Produktsæt pr. by skal være ét filter |
| 2026-10-26 | KBH kommer med i det samlede feed | Der skal bruges ét samlet feed med alle skoler |
| 2026-10-26 | Skolekode som id-præfiks for alle undtagen KBH | Unikke id'er, der matcher pixlen |

## Fravalg

| Fravalg | Begrundelse |
|---|---|
| **fof.dk's egne feeds som kilde** (`/feeds/<skole>/feed.xml`) | Mangler ca. 25 % af holdene. Se [fejlrapporten](fejlrapport-fof-feeds.md). Bør først genovervejes, når den er rettet og efterprøvet. |
| **Selvhostet runner** | Afprøvet i august 2026 og droppet efter et døgn. Gør desuden produktionen afhængig af én maskine. |
| **`raw.githubusercontent.com` som feed-URL** | Forkert content-type |
| **Kommaseparerede tags i `custom_label`** | En custom label kan ikke bruges som liste i Meta. Listen ligger i `internal_label`. |
| **Skolekode på KBH's id'er** | KBH's katalog og pixel bruger det rå holdnummer |
| **Metabillede i søgeindekset** | Kræver ændringer i indekset. Hentning fra kursussiderne med cache var enklere. |
| **Undervisernavne og interne tags i feedet** | Fravalgt. Kalender-, format- og rundvisningstags skal derimod med. |

## Mennesker og systemer

- **Ansvarlig:** Pelle Dahl Skovmøller.
- **Fejlrapporten** er rettet til udvikleren af FOFFrontend, hvor fof.dk's feed-generator ligger.
- **Prioritet:** Meta først. Google Merchant kommer senere.
