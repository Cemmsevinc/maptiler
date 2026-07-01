const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
env.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/config', (req, res) => {
  res.json({ maptilerKey: process.env.MAPTILER_KEY });
});

// Use MapTiler Geocoding to get accurate real-world coordinates for a neighborhood
async function geocodeNeighborhood(nbName, cityName, cityLat, cityLng) {
  try {
    const query = `${nbName}, ${cityName}`;
    const d = 0.3; // ~30km bounding box around city center
    const bbox = [cityLng - d, cityLat - d, cityLng + d, cityLat + d].join(',');
    const res = await fetch(
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${process.env.MAPTILER_KEY}&limit=1&bbox=${bbox}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.features?.[0];
    return f ? { lat: f.center[1], lng: f.center[0] } : null;
  } catch(e) { return null; }
}

async function fetchPhotos(placeName) {
  const parts = placeName.split(',').map(s => s.trim());
  const city = parts[0];
  const country = parts[1] || '';
  const photos = [];

  // Try "City, Country" article first (e.g. "Split, Croatia"), then plain city name
  const titleCandidates = country ? [`${city}, ${country}`, city] : [city];
  let foundTitle = null;

  for (const title of titleCandidates) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { 'User-Agent': 'WorldVibesDemo/1.0' } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.type !== 'disambiguation') {
          const url = data.originalimage?.source || data.thumbnail?.source?.replace(/\/\d+px-/, '/900px-');
          if (url) photos.push(url);
          foundTitle = data.title;
          break;
        }
      }
    } catch(e) {}
  }

  const searchTitle = foundTitle || (country ? `${city}, ${country}` : city);
  try {
    const listRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(searchTitle)}&prop=images&format=json&imlimit=12`,
      { headers: { 'User-Agent': 'WorldVibesDemo/1.0' } }
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      const page = Object.values(listData.query?.pages || {})[0];
      const files = (page?.images || [])
        .map(i => i.title)
        .filter(t => /\.(jpg|jpeg|png)$/i.test(t))
        .filter(t => !/flag|coat|emblem|logo|map|icon|locator|seal|blank|silhouette|portrait|statue/i.test(t))
        .slice(0, 5);
      if (files.length) {
        const urlRes = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(files.join('|'))}&prop=imageinfo&iiprop=url&iiurlwidth=900&format=json`,
          { headers: { 'User-Agent': 'WorldVibesDemo/1.0' } }
        );
        if (urlRes.ok) {
          const urlData = await urlRes.json();
          const urls = Object.values(urlData.query?.pages || {})
            .filter(p => p.imageinfo?.[0]?.url && /\.(jpg|jpeg|png)$/i.test(p.imageinfo[0].url))
            .map(p => p.imageinfo[0].url);
          photos.push(...urls);
        }
      }
    }
  } catch(e) {}

  return [...new Set(photos)].slice(0, 4);
}

app.post('/vibe', async (req, res) => {
  const { vibe } = req.body;
  if (!vibe) return res.status(400).json({ error: 'No vibe provided' });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1800,
      messages: [{
        role: 'user',
        content: `You are a relocation expert. The user said: "${vibe}"

Suggest exactly 3 cities where this person could live well. For each city, also provide 4 real neighborhoods with their actual coordinates, average rent, and budget tier.

Return ONLY valid JSON, no markdown, no backticks, all text in English:
{
  "places": [
    {
      "name": "City, Country",
      "lat": 0.0,
      "lng": 0.0,
      "story": "Two specific sentences about why this city fits. Be concrete.",
      "fact": "One surprising or counterintuitive fact about everyday life, cost, or culture in this city that most people don't know.",
      "stats": {
        "rent": "€850/mo avg 1-bed",
        "saving": "40% cheaper than UK",
        "climate": "27°C avg summer",
        "flight": "2.5hr from London"
      },
      "neighborhoods": [
        {
          "name": "Neighborhood Name",
          "lat": 0.0,
          "lng": 0.0,
          "tier": "budget",
          "rent": "€650/mo",
          "vibe": "One sentence about the character of this neighborhood."
        }
      ]
    }
  ]
}

Tier must be exactly one of: "budget", "mid", "premium"
Provide exactly 4 neighborhoods per city with realistic coordinates.
Budget = under city average, mid = around average, premium = above average.`
      }]
    });

    let raw = message.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    const data = JSON.parse(raw);
    const places = data.places || [];

    // Geocode all neighborhoods in parallel using MapTiler for accurate on-land coordinates
    await Promise.all(places.map(async place => {
      await Promise.all(place.neighborhoods.map(async nb => {
        const coords = await geocodeNeighborhood(nb.name, place.name, place.lat, place.lng);
        if (coords) { nb.lat = coords.lat; nb.lng = coords.lng; }
      }));
    }));

    const photosPerPlace = await Promise.all(places.map(p => fetchPhotos(p.name)));
    places.forEach((p, i) => { p.photos = photosPerPlace[i]; });

    res.json({ places });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));
