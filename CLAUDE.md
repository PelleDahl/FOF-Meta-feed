# FOF Feed Generator

Produktionssystem: bygger Meta-produktfeeds for 18 FOF-skoler. Læs [docs/README.md](docs/README.md) før du ændrer noget.

- Repoet er offentligt, og `/docs` publiceres på GitHub Pages. Skriv aldrig nøgler, interne stier eller persondata i repoet.
- Omdøb ikke repo, branch eller feedfiler. Meta henter fra de URL'er.
- `<g:id>`-formatet skal matche pixlen i GTM.
- Kør `git pull --rebase` før push. Botten committer feeds flere gange i døgnet.
- Et push til `main` starter en produktionskørsel.
- Skriv ikke Liquid-syntaks (dobbelte krøllede parenteser eller krøllet parentes med procenttegn) i Markdown-filer. GitHub Pages bygger dem med Jekyll, og det kan få bygget til at fejle.
