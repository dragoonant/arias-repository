// Copies the Three.js module build into public/vendor so the game can load it
// without a CDN (works offline and on static hosts like GitHub Pages).
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js');
const dest = path.join(__dirname, '..', 'public', 'vendor', 'three.module.js');
if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('Copied three.module.js to public/vendor');
}
