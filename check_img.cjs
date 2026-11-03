const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'frontend', 'public', 'logo.png.jpeg');
const buf = fs.readFileSync(filePath);
console.log('File size:', buf.length);
console.log('First 8 bytes (hex):', buf.slice(0, 8).toString('hex'));

// Check if JPEG (ffd8ffe0, ffd8ffe1, etc.) or PNG (89504e470d0a1a0a)
if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    console.log('It is actually a PNG!');
} else if (buf[0] === 0xff && buf[1] === 0xd8) {
    console.log('It is a JPEG!');
} else {
    console.log('Unknown format');
}
