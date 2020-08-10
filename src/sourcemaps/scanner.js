'use strict';

const fs = require('fs');
const glob = require('glob');
const path = require('path');
const BasicSourceMapConsumer = require('source-map/lib/source-map-consumer').BasicSourceMapConsumer;

class Scanner {
  constructor(options) {
    this.files = [];
    this.mappings = {};
    this.targetPath = options.targetPath;
    this.projectPath = './';
    this.sources = options.sources;
  }

  async scan() {
    await this.scanFiles();
  }

  async scanFiles() {
    if (this.targetPath) {
      this.files = this.targetFiles();
    }

    for (const file of this.files) {
      output.status('Found', file.filePathName);

      this.extractMapPath(file);
      await this.loadMapData(file);

      for(const error of file.errors) {
        output.warn('Error', error.error);
      }
    }
    output.verbose('files:', this.files);
  }

  extractMapPath(file) {
    const mapPath = this.parseMapPath(file.filePathName);

    if(mapPath) {
      output.status('', mapPath);
      file.mapPathName = mapPath;
      file.sourceMappingURL = true;
    } else {
      output.warn('', 'map not found');
    }
  }

  async loadMapData(file) {
    if (file.mapPathName) {
      try {
        const filePath = path.dirname(file.filePathName);
        const mapPath = path.resolve(filePath, file.mapPathName);
        const data = fs.readFileSync(mapPath).toString();

        if (data) {
          file.mapData = data;
          file.map = JSON.parse(file.mapData);
          file.sources = (this.sources && file.map.sources) ? await this.originalSources(file) : {};
          file.validated = await this.validate(file);
        } else {
          output.warn('', 'map data not valid');
        }

        if (file.validated) {
          output.success('', 'valid');
        } else {
          output.warn('', 'map not valid');
        }

      } catch (e) {
        file.errors.push({
          error: 'Error parsing map file: ' + e.message,
          file: file
        });
      }
    }
  }

  async originalSources(file) {
    const map = file.map;
    const filenames = map.sources;
    const sources = {};

    output.status('', `${filenames.length} original sources`);

    const consumer = await new BasicSourceMapConsumer(map);

    for (const filename of filenames) {
      if (filename) {
        if (filename.includes('.') && !filename.startsWith('..')) {
          const filepath = path.join(this.projectPath, filename);
          output.verbose(filepath);
          try {
            output.verbose('', filename);
            sources[filename] = consumer.sourceContentFor(filepath, true);
          } catch (e) {
            output.warn('', e.message);
            file.errors.push({
              error: e.message,
              file: file
            });
          }
        } else {
          // Avoid known issues with names Rollbar API doesn't accept.
          output.verbose('', 'Ignored: ' + filename);
        }
      }
    }

    return sources;
  }

  async validate(file) {
    const map = file.map;

    file.metadata.version =  map.version;
    file.metadata.file =  map.file;
    if (map.sections) {
      file.metadata.sections = map.sections.length;
    }

    if (map.sources) {
      file.metadata.sources = map.sources;
    }

    const consumer = await new BasicSourceMapConsumer(map);
    const mappings = {};
    consumer.eachMapping(function (m) {
      mappings[m.generatedLine] = true;
    });

    return true;
  }

  mappedFiles() {
    return this.files;
  }

  targetFiles() {
    const globPath = path.join(this.targetPath, '**/*.js');
    const outFiles = [];

    const files = glob.sync(globPath);
    for (const filename of files) {
      outFiles.push(this.initFile(filename));
    }

    return outFiles;
  }

  initFile(filePathName) {
    return {
      filePathName: filePathName,
      fileName: path.relative(this.targetPath, filePathName),
      sourceMappingURL: false,
      mapPathName: null,
      mapData: null,
      validated: false,
      metadata: {},
      errors: []
    }
  }

  parseMapPath(path) {
    const regex = /^\s*\/\/#\s*sourceMappingURL\s*=\s*(.+)\s*$/;
    const data = fs.readFileSync(path).toString();
    const lines = data.split('\n').reverse();

    for (const line of lines) {
      const matched = line.match(regex);
      if (matched) {
        return matched[1];
      }
    }
  }
}

module.exports = Scanner;
