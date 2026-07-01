# maptiler-demo

Small demo built with the MapTiler SDK: type a city, get a curated set of
neighbourhoods rendered on a MapTiler map, coloured by rent tier, with
photos, click-to-explore, and a tier filter.

## Stack

- MapTiler Cloud (map tiles, Geocoding API for accurate on-land neighbourhood coordinates)
- MapLibre GL under the hood (via `@maptiler/sdk` from CDN)
- Anthropic Claude API for neighbourhood generation from a city query
- Node.js + Express backend, vanilla HTML/CSS/JS frontend

## Run

```bash
cp .env.example .env      # add your keys
npm install
npm start                 # http://localhost:3000
```

You will need:
- A MapTiler Cloud API key (dashboard.maptiler.com)
- An Anthropic API key (console.anthropic.com)

## Notes

- `/config` returns the MapTiler key to the browser (needed to render the map).
  Restrict the key by allowed origin in the MapTiler dashboard for anything
  beyond local demo use.
- Geocoding runs server-side to avoid extra client requests; results are
  bounded to a ~30km box around the city centre so a "Chelsea" query in
  London does not resolve to Chelsea, Massachusetts.
