'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

function parseMetadata(contents, extension) {
  const info = yaml.load(contents);
  if (!info || typeof info.version !== 'string' || !Array.isArray(info.files) || info.files.length === 0) {
    throw new Error(`Invalid ${extension} updater metadata`);
  }
  for (const file of info.files) {
    if (typeof file.url !== 'string' || path.posix.basename(file.url) !== file.url
      || !file.url.endsWith(`.${extension}`) || typeof file.sha512 !== 'string'
      || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`Invalid ${extension} updater file`);
    }
  }
  const primary = info.files.find(file => file.url === info.path);
  if (!primary || primary.sha512 !== info.sha512) throw new Error(`Inconsistent ${extension} updater path or hash`);
  return info;
}

function mergeLinuxUpdaterMetadata(appImageContents, debianContents) {
  const image = parseMetadata(appImageContents, 'AppImage');
  const debian = parseMetadata(debianContents, 'deb');
  if (image.version !== debian.version) throw new Error('Linux updater versions differ');
  const files = [...image.files, ...debian.files];
  if (new Set(files.map(file => file.url)).size !== files.length) throw new Error('Duplicate Linux updater files');
  // AppImage remains the legacy primary; current updaters select their own file
  // type from files. Build separately so Debian's package-type never enters it.
  return yaml.dump({ ...image, files }, { lineWidth: -1 });
}

if (require.main === module) {
  const [output, image, debian] = process.argv.slice(2);
  if (!output || !image || !debian) throw new Error('Usage: merge-linux-updater-metadata <output> <AppImage.yml> <deb.yml>');
  const contents = mergeLinuxUpdaterMetadata(fs.readFileSync(image, 'utf8'), fs.readFileSync(debian, 'utf8'));
  if (yaml.load(contents).version !== require('../package.json').version) throw new Error('Linux metadata version differs from source');
  fs.writeFileSync(output, contents);
}

module.exports = { mergeLinuxUpdaterMetadata };
