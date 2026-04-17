const fs = require('fs');
const path = require('path');

const replacements = {
  'bg-gray-950': 'bg-bg-app',
  'bg-gray-900': 'bg-bg-panel',
  'bg-gray-800': 'bg-bg-surface',
  'bg-gray-700': 'bg-bg-surface-hover',
  'bg-gray-600': 'bg-bg-surface-hover',
  'bg-black': 'bg-bg-app',
  'border-gray-800': 'border-border-panel',
  'border-gray-700': 'border-border-divider',
  'text-gray-200': 'text-text-primary',
  'text-gray-300': 'text-text-secondary',
  'text-gray-400': 'text-text-muted',
  'text-gray-500': 'text-text-muted',
  'text-white': 'text-accent-text',
  'bg-blue-600': 'bg-accent-primary',
  'bg-blue-500': 'bg-accent-hover',
  'hover:bg-blue-500': 'hover:bg-accent-hover',
  'hover:bg-blue-700': 'hover:bg-accent-hover',
  'text-blue-400': 'text-accent-primary',
  'text-blue-500': 'text-accent-primary',
  'hover:text-blue-400': 'hover:text-accent-primary',
  'hover:text-white': 'hover:text-accent-text',
  'hover:bg-gray-800': 'hover:bg-bg-surface',
  'hover:bg-gray-700': 'hover:bg-bg-surface-hover',
  'hover:bg-gray-600': 'hover:bg-bg-surface-hover',
  'ring-gray-500': 'ring-border-panel',
  'bg-[#1e1e1e]': 'bg-bg-panel',
  'border-blue-400': 'border-accent-primary',
  'hover:text-blue-300': 'hover:text-accent-hover'
};

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx')) { 
      results.push(file);
    }
  });
  return results;
}

const files = walk('src');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  Object.keys(replacements).forEach(key => {
    // Regex taking hyphens, brackets, hash into account
    const keyEscaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('(?<=[\\s"\'`])' + keyEscaped + '(?=[\\s"\'`])', 'g');
    if (regex.test(content)) {
      changed = true;
      content = content.replace(regex, replacements[key]);
    }
  });
  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
  }
});
console.log('Replacements completed.');
