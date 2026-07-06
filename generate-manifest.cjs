const fs = require('fs');
const path = require('path');

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
        items.push({
          name: file,
          path: `media/${folderName}/${relPath}`,
          size: stat.size,
          modified: stat.mtime,
          type: file.endsWith('.mp4') ? 'video' : 'image'
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

fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log('✓ Manifest generated successfully!');
console.log(`  Stories: ${manifest.stats.totalStories}`);
console.log(`  Reels: ${manifest.stats.totalReels}`);
console.log(`  Profile: ${manifest.stats.totalProfile}`);
console.log(`  Garage: ${manifest.stats.totalGarage}`);
console.log(`  Total: ${manifest.stats.totalFiles}`);
