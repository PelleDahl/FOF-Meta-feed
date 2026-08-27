# FOF Feed Generator

Samler produktfeeds fra alle FOF-skoler til én fælles Meta/Google-produktfeed (`fof-alle-skoler-feed.xml`).

## Live feed-URL

```
https://cdn.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-alle-skoler-feed.xml
```

Brug denne URL i Meta Commerce Manager / Google Merchant Center — **ikke** `raw.githubusercontent.com`. GitHub's raw-service sender altid `Content-Type: text/plain`, hvilket kan få feed-parsere til at afvise eller fejllæse filen. jsDelivr spejler samme GitHub-repo, men sætter korrekt `Content-Type: application/xml`.

jsDelivr's CDN cacher indhold i op til ca. 24 timer efter et push til `main`. Skal ændringer slå igennem med det samme, kan cachen purges manuelt via: `https://purge.jsdelivr.net/gh/PelleDahl/FOF-Meta-feed@main/fof-alle-skoler-feed.xml`

## Kørsel

```
node merge-fof-feeds.js
```

## Hvad scriptet gør

1. Henter XML-feedet for hver skole i `FEED_URLS`.
2. Udtrækker alle `<item>`-elementer fra hvert feed.
3. Præfikser `<g:id>` med skolens korte kode (se nedenfor), f.eks. `264364` → `DJU-264364`. Uden præfikset kan to skoler tilfældigt bruge samme holdnummer, hvilket giver dubletter i den samlede feed — præfikset gør hvert `<g:id>` unikt på tværs af skoler.
4. Samler alle items fra alle skoler i én fælles `<rss>`-feed og skriver den til `fof-alle-skoler-feed.xml`.
5. Logger resultatet af kørslen til `logs/feed-merge-YYYY-MM-DD.log`. Logfiler ældre end 60 dage (`LOG_RETENTION_DAYS`) slettes automatisk ved næste kørsel.

Fejler hentning af et enkelt skolefeed (timeout, non-200, for mange redirects), logges fejlen, og scriptet fortsætter med de øvrige skoler.

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

- **Fjordlandet** er bevidst fjernet fra feedet.
- **Vendsyssel** har aldrig indgået i feedet.
