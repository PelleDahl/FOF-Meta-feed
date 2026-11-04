# Dokumentation: FOF Feed Generator

Start her. Siden giver det overblik, en ny person eller Claude-session skal bruge for at arbejde sikkert i projektet.

> **Dette repo er offentligt, og `/docs` publiceres også via GitHub Pages.** Skriv aldrig nøgler, interne stier, personoplysninger eller andet fortroligt i repoet.

## Hvad projektet er

Ét Node-script (`merge-fof-feeds.js`, ingen npm-afhængigheder) bygger produktfeeds til Meta for alle 18 FOF-skoler ud fra FOF's søgeindeks i Azure AI Search. GitHub Actions kører scriptet flere gange i døgnet og committer feedfilerne til `main`. Meta henter dem derfra via en offentlig URL.

Projektet er **i produktion**: Metas kataloger og shops læser feedene, og annoncer og produktsæt bygger på dem.

```
Azure AI Search ──┐
                  ├─► merge-fof-feeds.js ─► fof-*-feed.xml ─► commit til main ─► jsDelivr ─► Meta
fof.dk (og:image) ┘     (GitHub Actions)
```

Produktionen kører udelukkende på GitHub. Den afhænger ikke af nogen pc, af OneDrive eller af en Claude-konto.

## Dokumenter

| Dokument | Indhold | Læs det når |
|---|---|---|
| [arkitektur.md](arkitektur.md) | Dataflow, filer, kodens opbygning, fejlhåndtering | Du skal ændre koden |
| [feed-format.md](feed-format.md) | Felter, udvælgelsesregler, id-format, skolekoder, tags | Du skal ændre feedets indhold |
| [drift.md](drift.md) | Runbook: fejlsøgning, lokal kørsel, ny skole, nøgler, kendte risici | Noget er galt, eller du skal vedligeholde |
| [beslutninger.md](beslutninger.md) | Hvorfor tingene er, som de er, og hvad der er afprøvet og fravalgt | Før du foreslår en større ændring |
| [fejlrapport-fof-feeds.md](fejlrapport-fof-feeds.md) | Rapporten om, at fof.dk's egne feeds mangler ca. 25 % af holdene | Du overvejer at bruge fof.dk's feeds igen |

## Regler, der ikke må brydes

1. **Omdøb ikke repo, GitHub-konto, branch `main` eller feedfiler.** Feed-URL'erne indeholder dem alle, og Meta henter fra de URL'er.
2. **Ændr ikke `<g:id>`-formatet alene.** Det skal matche `content_ids` fra pixlen i GTM. Ændres id'erne, ser Meta dem desuden som nye produkter. Se [feed-format.md](feed-format.md#id-format).
3. **Slet ikke feedfilerne eller `og-image-cache.json` fra repoet.** De er selve leverancen og den cache, kørslen bygger på.
4. **Hent altid før du pusher** (`git pull --rebase`). Botten committer feeds flere gange i døgnet, så din lokale kopi er hurtigt bagud.
5. **Et push til `main` starter en produktionskørsel**, også når kun dokumentation er ændret. Det er harmløst, men en kørsel i gang bliver afbrudt og erstattet.

## Status pr. 2026-11-04

- Samlet feed: 2.528 hold, alle med unikke id'er.
- De seneste 44 planlagte kørsler lykkedes. En kørsel tager typisk under et minut.

## Åbne spørgsmål

- **Hvilke feed-URL'er bruger Metas kataloger faktisk?** Det kan kun ses i Meta Commerce Manager. Se [drift.md](drift.md#feed-urler).
- **Er fejlrapporten rettet hos fof.dk?** Rapporten er skrevet 2026-10-20. Svaret er ikke registreret her.
