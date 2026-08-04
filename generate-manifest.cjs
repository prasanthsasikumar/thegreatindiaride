const fs = require('fs');
const path = require('path');

// Written by tag-media.cjs from an Instagram export: capture time, state, caption,
// subtitle pairing. Optional — without it the manifest is exactly what it was before.
const tags = fs.existsSync('./tags.json')
  ? JSON.parse(fs.readFileSync('./tags.json', 'utf8')).files || {}
  : {};

// Written by build-route.cjs from the trip sheet: the order regions were actually
// ridden through, plus nights and stop names. Optional.
const route = fs.existsSync('./route.json')
  ? JSON.parse(fs.readFileSync('./route.json', 'utf8'))
  : null;

function scanDirectory(dir, folderName) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const items = [];
  
  function scan(currentPath, relativePath = '') {
    const files = fs.readdirSync(currentPath);
    
    files.forEach(file => {
      const fullPath = path.join(currentPath, file);
      const relPath = relativePath ? path.join(relativePath, file).replace(/\\/g, '/') : file;
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        scan(fullPath, relPath);
      } else if (file.match(/\.(mp4|jpg|jpeg|png|gif)$/i)) {
        const mediaPath = `media/${folderName}/${relPath}`;
        const tag = tags[mediaPath] || {};

        items.push({
          name: file,
          path: mediaPath,
          size: stat.size,
          // mtime is the checkout date, not the capture date — `captured` is the real one.
          modified: stat.mtime,
          type: file.endsWith('.mp4') ? 'video' : 'image',
          ...(tag.captured && { captured: tag.captured, timeSource: tag.timeSource }),
          ...(tag.state && {
            state: tag.state,
            country: tag.country,
            // gps | time | manual — "time" is the low-confidence one.
            stateSource: tag.stateSource
          }),
          ...(tag.nearby && { nearby: tag.nearby }),
          ...(tag.caption && { caption: tag.caption }),
          ...(tag.subtitles && { subtitles: tag.subtitles })
        });
      }
    });
  }
  
  scan(dir);
  return items;
}

const manifest = {
  generated: new Date().toISOString(),
  baseUrl: process.env.BASE_URL || 'https://thegreatindiaride.prasanthsasikumar.com',
  stories: scanDirectory('./media/stories', 'stories'),
  reels: scanDirectory('./media/reels', 'reels'),
  profile: scanDirectory('./media/profile', 'profile'),
  garage: scanDirectory('./media/garage', 'garage')
};

manifest.stats = {
  totalStories: manifest.stories.length,
  totalReels: manifest.reels.length,
  totalProfile: manifest.profile.length,
  totalGarage: manifest.garage.length,
  totalFiles: manifest.stories.length + manifest.reels.length + manifest.profile.length + manifest.garage.length
};

// Region index, so the browser UI can build its filter chips without walking every item.
const everything = [...manifest.stories, ...manifest.reels, ...manifest.profile, ...manifest.garage];
const byState = {};
everything.forEach(item => {
  if (!item.state) return;
  if (!byState[item.state]) byState[item.state] = { count: 0, unsure: 0, country: item.country };
  byState[item.state].count++;
  if (item.stateSource === 'time') byState[item.state].unsure++;
});

// Route order beats frequency order: "Tamil Nadu → Karnataka → Goa" tells the story,
// "Arunachal 25, Himachal 21" does not. Regions with no route entry sort to the end.
const routeIndex = {};
if (route) route.regionOrder.forEach((r, i) => { routeIndex[r] = i; });
const routeMeta = {};
if (route) route.regions.forEach(r => { routeMeta[r.region] = r; });

manifest.regions = Object.keys(byState)
  .sort((a, b) => {
    const ia = a in routeIndex ? routeIndex[a] : Infinity;
    const ib = b in routeIndex ? routeIndex[b] : Infinity;
    return ia - ib || byState[b].count - byState[a].count || a.localeCompare(b);
  })
  .map(name => ({
    name,
    ...byState[name],
    ...(routeMeta[name] && {
      nights: routeMeta[name].nights,
      stops: routeMeta[name].stops,
      spend: routeMeta[name].spend,
    }),
  }));

if (route) {
  manifest.route = {
    nights: route.totals.nights,
    spend: route.totals.spend,
    regionOrder: route.regionOrder,
    legs: route.legs,
  };
}

manifest.stats.totalTagged = everything.filter(i => i.state).length;
manifest.stats.totalRegions = manifest.regions.length;
manifest.stats.stateFromGps = everything.filter(i => i.stateSource === 'gps').length;
manifest.stats.stateFromRoute = everything.filter(i => i.stateSource === 'route').length;
manifest.stats.stateFromTiming = everything.filter(i => i.stateSource === 'time').length;
manifest.stats.stateManual = everything.filter(i => i.stateSource === 'manual').length;

fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log('✓ Manifest generated successfully!');
console.log(`  Stories: ${manifest.stats.totalStories}`);
console.log(`  Reels: ${manifest.stats.totalReels}`);
console.log(`  Profile: ${manifest.stats.totalProfile}`);
console.log(`  Garage: ${manifest.stats.totalGarage}`);
console.log(`  Total: ${manifest.stats.totalFiles}`);
console.log(`  Tagged: ${manifest.stats.totalTagged} across ${manifest.stats.totalRegions} regions`);
