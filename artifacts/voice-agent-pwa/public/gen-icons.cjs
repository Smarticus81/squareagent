const fs = require("fs");
function svg(s) {
  const r = Math.round(s * 0.2);
  const f = Math.round(s * 0.4);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<rect width="${s}" height="${s}" rx="${r}" fill="#7C3AED"/>`,
    `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="${f}" font-weight="700">B</text>`,
    `</svg>`,
  ].join("");
}
fs.writeFileSync("icon-192.svg", svg(192));
fs.writeFileSync("icon-512.svg", svg(512));
console.log("SVG icons created");
