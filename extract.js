const fs = require('fs');

const files = ['ai-original.js', 'local-summary.js', 'google-drive-sync.js'];

for (const file of files) {
    console.log(`\n--- Sections in ${file} ---`);
    if (!fs.existsSync(file)) {
        console.log("File not found");
        continue;
    }
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
        if (line.match(/^\/\/\s*={10,}/)) {
            const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
            if (nextLine && !nextLine.match(/^\/\/\s*={10,}/)) {
                 console.log(`Line ${i + 2}: ${nextLine}`);
            }
        }
    });
}
