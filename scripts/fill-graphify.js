const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), '.graphify', 'description-instructions');
if (!fs.existsSync(dir)) process.exit(0);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = content.split('\n');
  const result = {};
  for (const line of lines) {
    const match = line.match(/^- \"([^\"]+)\": \"([^\"]+)\" \| kind=([^\|]+) \|/);
    if (match) {
      const id = match[1];
      const name = match[2];
      const kind = match[3].trim();
      let desc = '';
      if (kind === 'Commit') {
        desc = 'Representa o commit ' + name.replace(/\"/g, '') + ' no repositório.';
      } else if (kind === 'Branch') {
        desc = 'Representa a branch ' + name + ' do repositório.';
      } else if (kind === 'code-symbol') {
        desc = 'Representa o símbolo de código ' + name + ' no sistema.';
      } else {
        desc = 'Representa um(a) ' + kind + ' denominado(a) ' + name + '.';
      }
      result[id] = desc;
    }
  }
  fs.writeFileSync(path.join(dir, file.replace('.md', '.json')), JSON.stringify(result, null, 2));
}
console.log('Generated ' + files.length + ' JSON batch files.');
