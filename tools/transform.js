import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const srcDir = path.join(rootDir, "src");

if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
if (!fs.existsSync(path.join(srcDir, "util"))) fs.mkdirSync(path.join(srcDir, "util"));

function transformFile(relPath, transformFn) {
	const fullPath = path.join(rootDir, relPath);
	let content = fs.readFileSync(fullPath, "utf8");
	content = transformFn(content);
	const destPath = path.join(srcDir, relPath);
	fs.writeFileSync(destPath, content);
}

// 1. Transform Clipper
transformFile("util/clipper.js", (content) => {
	return `const ClipperLib = (function() {
    var module = { exports: {} };
    ${content}
    return module.exports;
  })();
  export default ClipperLib;
  export { ClipperLib };`;
});

// 2. Transform GeometryUtil
transformFile("util/geometryutil.js", (content) => {
	let body = content.substring(content.indexOf("{") + 1, content.lastIndexOf("}"));
	body = body.replace(/root.GeometryUtil\s*=\s*/, "const GeometryUtil = ");
	return `\n${body}\nexport { GeometryUtil };\nexport default GeometryUtil;`;
});

// 3. Transform Matrix
transformFile("util/matrix.js", (content) => {
	let transformed = content.replace(/\(typeof window !== 'undefined' \? window : self\)\.Matrix = Matrix;/, "");
	return `${transformed}\nexport { Matrix };\nexport default Matrix;`;
});

// 4. Transform SvgParser
transformFile("svgparser.js", (content) => {
	let body = content.substring(content.indexOf("{") + 1, content.lastIndexOf("}"));

	const domSetup = `
import { JSDOM } from 'jsdom';
const dom = new JSDOM(\`<!DOCTYPE html><body></body>\`);
const win = dom.window;

if (typeof global !== 'undefined') {
  global.window = win;
  global.document = win.document;
  global.DOMParser = win.DOMParser;
  global.SVGElement = win.SVGElement || function(){};
}

const stubTransformList = {
  numberOfItems: 0,
  getItem: function(i) { return null; },
  appendItem: function(item) {},
  removeItem: function(i) {},
  clear: function() {},
  consolidate: function() { return null; }
};
const stubAnimatedTransform = {
  baseVal: stubTransformList,
  animVal: stubTransformList
};

const elementProto = win.Element.prototype;
if (!Object.getOwnPropertyDescriptor(elementProto, "transform")?.get) {
  Object.defineProperty(elementProto, "transform", {
    get: function() { return stubAnimatedTransform; },
    configurable: true
  });
}

if (!elementProto.getBBox) {
  elementProto.getBBox = function () {
    const attr = (name) => parseFloat(this.getAttribute(name) || "0") || 0;
    return { x: attr("x"), y: attr("y"), width: attr("width"), height: attr("height") };
  };
}
if (!elementProto.getCTM) { elementProto.getCTM = function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }; }
if (!elementProto.getScreenCTM) { elementProto.getScreenCTM = function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }; }

const svgStubs = [
  "SVGPathElement", "SVGRectElement", "SVGCircleElement", "SVGEllipseElement",
  "SVGLineElement", "SVGPolylineElement", "SVGPolygonElement"
];
for (let i = 0; i < svgStubs.length; i++) {
  const name = svgStubs[i];
  if (!win[name]) {
    const stub = function () {};
    stub.prototype = Object.create(elementProto);
    win[name] = stub;
    if (typeof global !== 'undefined') global[name] = stub;
  }
}

try { require('pathseg'); } catch(e) {}

const window = win;
const document = win.document;
const DOMParser = win.DOMParser;
`;

	body = `import GeometryUtil from './util/geometryutil.js';\nimport Matrix from './util/matrix.js';\n${domSetup}\n` + body;
	body = body.replace(/function SvgParser\(/g, "function _SvgParser(");
	body = body.replace(/SvgParser.prototype/g, "_SvgParser.prototype");
	body = body.replace(/new SvgParser\(/g, "new _SvgParser(");

	const getPointsHelper = `
	_SvgParser.prototype.getPoints = function(element) {
		var points = [];
		if (element.points && element.points.numberOfItems !== undefined) {
			for (var i = 0; i < element.points.numberOfItems; i++) {
				var p = element.points.getItem(i);
				points.push({ x: p.x, y: p.y });
			}
		} else {
			var pointsAttr = element.getAttribute('points') || element.getAttribute('d');
			if (pointsAttr) {
				var pairs = pointsAttr.replace(/[MLZ]/gi, ' ').trim().split(/[\\s,]+/);
				for (var i = 0; i < pairs.length; i += 2) {
					if (pairs[i] && pairs[i+1]) {
						points.push({ x: parseFloat(pairs[i]), y: parseFloat(pairs[i+1]) });
					}
				}
			}
		}
		return points;
	};
  `;

	body = body.replace(/this.conf\s*=\s*\{[\s\S]*?\};\s*\}/, `$&${getPointsHelper}`);

	body = body.replace(
		/let transformedPoly = ''\s*for\(var i=0; i<element\.points\.numberOfItems; i\+\+\)\{[\s\S]*?transformedPoly \+= pointPairString;[\s\S]*?\}/,
		`let transformedPoly = ''; var points = this.getPoints(element);
     for(var i=0; i<points.length; i++){
        var point = points[i]; var transformed = transform.calc(point.x, point.y);
        transformedPoly += \`\${transformed[0]},\${transformed[1]} \`;
     }`
	);
	body = body.replace(
		/for\(i=0; i<element\.points\.numberOfItems; i\+\+\)\{\s*var point = element\.points\.getItem\(i\);\s*poly\.push\(\{ x: point\.x, y: point\.y \}\);\s*\}/,
		`var points = this.getPoints(element); for(i=0; i<points.length; i++){ poly.push({ x: points[i].x, y: points[i].y }); }`
	);

	body = body.replace(
		/for\(var i=0; i<element\.points\.numberOfItems; i\+\+\)\{\s*var point = element\.points\.getItem\(i\);\s*points \+= point\.x \+ ' ' \+ point\.y \+ ',';\s*\}/g,
		`var pts = this.getPoints(element); for(var i=0; i<pts.length; i++){ points += pts[i].x + ' ' + pts[i].y + ','; }`
	);

	body = body.replace(/root.SvgParser\s*=\s*\{([\s\S]*?)\};/, "const SvgParser = {$1};");
	return `${body}\nexport { SvgParser };\nexport default SvgParser;`;
});

// 5. Transform PlacementWorker
transformFile("util/placementworker.js", (content) => {
	let transformed = `import GeometryUtil from './geometryutil.js';\nimport ClipperLib from './clipper.js';\n` + content;
	transformed = transformed.replace(/\(typeof window !== 'undefined' \? window : self\)\.PlacementWorker = PlacementWorker;/, "");
	transformed = transformed.replace(/var self = global.env.self;/, "var self = this;");
	transformed = transformed.replace(/global.env.searchEdges/g, "this.config.exploreConcave");
	transformed = transformed.replace(/global.env.useHoles/g, "this.config.useHoles");
	transformed += "\nexport { PlacementWorker };\nexport default PlacementWorker;";
	return transformed;
});

// 6. Create nestWorker.js
const nestWorkerContent = `import { parentPort } from 'worker_threads';
import GeometryUtil from './geometryutil.js';
import ClipperLib from './clipper.js';
import PlacementWorker from './placementworker.js';

function toClipperCoordinates(polygon) {
  var clone = [];
  for (var i = 0; i < polygon.length; i++) clone.push({ X: polygon[i].x, Y: polygon[i].y });
  return clone;
}

function toNestCoordinates(polygon, scale) {
  var clone = [];
  for (var i = 0; i < polygon.length; i++) clone.push({ x: polygon[i].X / scale, y: polygon[i].Y / scale });
  return clone;
}

function minkowskiDifference(A, B, clipperScale) {
  var Ac = toClipperCoordinates(A);
  ClipperLib.JS.ScaleUpPath(Ac, clipperScale);
  var Bc = toClipperCoordinates(B);
  ClipperLib.JS.ScaleUpPath(Bc, clipperScale);
  for (var i = 0; i < Bc.length; i++) { Bc[i].X *= -1; Bc[i].Y *= -1; }
  var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
  var clipperNfp;
  var largestArea = null;
  for (var i = 0; i < solution.length; i++) {
    var n = toNestCoordinates(solution[i], clipperScale);
    var sarea = GeometryUtil.polygonArea(n);
    if (largestArea === null || largestArea > sarea) { clipperNfp = n; largestArea = sarea; }
  }
  for (var i = 0; i < clipperNfp.length; i++) { clipperNfp[i].x += B[0].x; clipperNfp[i].y += B[0].y; }
  return [clipperNfp];
}

parentPort.on('message', function(data) {
  const { type, pair, config, placelist, ids, rotations, nfpCache, binPolygon } = data;

  if (type === 'nfp') {
    const { A, B, key } = pair;
    const searchEdges = config.exploreConcave;
    const useHoles = config.useHoles;

    const rotatedA = GeometryUtil.rotatePolygon(A, key.Arotation);
    const rotatedB = GeometryUtil.rotatePolygon(B, key.Brotation);

    let nfp;
    if (key.inside) {
      if (GeometryUtil.isRectangle(rotatedA, 0.001)) { nfp = GeometryUtil.noFitPolygonRectangle(rotatedA, rotatedB); } 
      else { nfp = GeometryUtil.noFitPolygon(rotatedA, rotatedB, true, searchEdges); }
      if (nfp && nfp.length > 0) { for (let i = 0; i < nfp.length; i++) { if (GeometryUtil.polygonArea(nfp[i]) > 0) nfp[i].reverse(); } }
    } else {
      if (searchEdges) { nfp = GeometryUtil.noFitPolygon(rotatedA, rotatedB, false, searchEdges); } 
      else { nfp = minkowskiDifference(rotatedA, rotatedB, config.clipperScale); }
      if (nfp && nfp.length > 0) {
        for (let i = 0; i < nfp.length; i++) {
          if (GeometryUtil.polygonArea(nfp[i]) > 0) nfp[i].reverse();
          if (i > 0 && GeometryUtil.pointInPolygon(nfp[i][0], nfp[0])) { if (GeometryUtil.polygonArea(nfp[i]) < 0) nfp[i].reverse(); }
        }
      }
    }
    parentPort.postMessage({ type: 'nfp', key: JSON.stringify(key), value: nfp });
  } else if (type === 'place') {
    const worker = new PlacementWorker(binPolygon, placelist, ids, rotations, config, nfpCache);
    const result = worker.placePaths(placelist);
    parentPort.postMessage({ type: 'place', result });
  }
});`;
const nestWorkerPath = path.join(srcDir, "util/nestWorker.js");
fs.writeFileSync(nestWorkerPath, nestWorkerContent);

// 7. Create parallel.js
const parallelContent = `import { Worker } from 'worker_threads';
import os from 'os';

export class Parallel {
  constructor(workerUrl) {
    this.workerUrl = workerUrl;
    this.maxWorkers = os.cpus().length || 4;
    this.workers = [];
    this.idleWorkers = [];
  }

  async map(data, type, commonData) {
    return new Promise((resolve) => {
      const results = [];
      let finished = 0;
      let started = 0;
      const total = data.length;

      const checkFinished = () => { if (finished === total) resolve(results); };

      const runNext = () => {
        while (started < total && this.idleWorkers.length > 0) {
          const worker = this.idleWorkers.pop();
          const index = started++;
          const item = data[index];

          worker.on('message', (data) => {
            results[index] = data;
            finished++;
            this.idleWorkers.push(worker);
            runNext();
            checkFinished();
          });

          worker.postMessage({ type, ...item, ...commonData });
        }
        
        if (this.workers.length < this.maxWorkers && started < total) {
          this.createWorker().then(runNext);
        }
      };

      runNext();
    });
  }

  async createWorker() {
    const worker = new Worker(this.workerUrl);
    this.workers.push(worker);
    this.idleWorkers.push(worker);
    return worker;
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.idleWorkers = [];
  }
}
`;
fs.writeFileSync(path.join(srcDir, "util/parallel.js"), parallelContent);

// 8. Transform SvgNest
transformFile("svgnest.js", (content) => {
	let header = `import SvgParser from './svgparser.js';\nimport GeometryUtil from './util/geometryutil.js';\nimport ClipperLib from './util/clipper.js';\nimport { Parallel } from './util/parallel.js';\nimport { JSDOM } from 'jsdom';\n\nconst document = new JSDOM(\`<!DOCTYPE html><body></body>\`).window.document;\n`;

	const iifeStart = content.indexOf("(function");
	const firstBrace = content.indexOf("{", iifeStart);
	let body = content.substring(firstBrace + 1);

	let newBody = body.replace(/\}\s*\)\s*\(\s*window\s*\)\s*;?\s*$/, "");
	if (newBody === body) newBody = body.replace(/\}\s*\)\s*\((this|typeof\s+window\s*!==\s*'undefined'\s*\?\s*window\s*:\s*self)\)\s*;?\s*$/, "");
	body = newBody.trim();

	body = body.replace(/root\.SvgNest\s*=\s*new SvgNest\(\);/, "");
	body = body.replace(/this\.parsesvg = function/g, "this.parseSvg = function");
	body = body.replace(/this\.setbin = function/g, "this.setBin = function");
	body = body.replace(/exploreConcave:\s*false\s*\};/, "exploreConcave: false };");

	const configStart = body.indexOf("this.config = function(c){");
	const startStart = body.indexOf("this.start = function(progressCallback, displayCallback){");

	const configReplacement = `this.config = function(c){
            if(!c) return config;
            if(c.curveTolerance && !GeometryUtil.almostEqual(parseFloat(c.curveTolerance), 0)) config.curveTolerance =  parseFloat(c.curveTolerance);
            if('spacing' in c) config.spacing = parseFloat(c.spacing);
            if(c.rotations && parseInt(c.rotations) > 0) config.rotations = parseInt(c.rotations);
            if(c.populationSize && parseInt(c.populationSize) > 2) config.populationSize = parseInt(c.populationSize);
            if(c.mutationRate && parseInt(c.mutationRate) > 0) config.mutationRate = parseInt(c.mutationRate);
            if('useHoles' in c) config.useHoles = !!c.useHoles;
            if('exploreConcave' in c) config.exploreConcave = !!c.exploreConcave;
            if(c.workerUrl) config.workerUrl = c.workerUrl;

            if(c.flowElement) {
                try {
                    const path = require('path');
                    const { createRequire } = require('module');
                    const req = createRequire(path.join(c.flowElement.getPluginResourcesPath(), 'node_modules'));
                    req('pathseg');
                } catch(e) { console.log("SvgNest: flowElement pathseg load skipped"); }
            }
            
            SvgParser.config({ tolerance: config.curveTolerance});
            best = null; nfpCache = {}; binPolygon = null; GA = null;
            return config;
        }\n`;

	body = body.substring(0, configStart) + configReplacement + body.substring(startStart);

	body = body.replace(
		/binPolygon\s*=\s*SvgParser.polygonify\(bin\);[\s\S]*?if\s*\(!binPolygon\s*\|\|\s*binPolygon\.length\s*<\s*3\)\{/,
		`binPolygon = SvgParser.polygonify(bin);\nbinPolygon = this.cleanPolygon(binPolygon);\nbinPolygon.id = -1;\nif(!binPolygon || binPolygon.length < 3){`
	);

	body = body.replace(
		/if\s*\(config\.spacing\s*>\s*0\)\{[\s\S]*?binPolygon\s*=\s*offsetBin\.pop\(\);[\s\S]*?\}\s*\}\s*\/\/\s*put bin on origin/,
		`if(config.spacing > 0){ var offsetBin = this.polygonOffset(binPolygon, -0.5*config.spacing); if(offsetBin.length == 1) binPolygon = offsetBin.pop(); }\nbinPolygon.id = -1;\n`
	);

	body = body.replace(
		/workerTimer = setInterval\(function\(\)\{[\s\S]*?progressCallback\(progress\);\s*\}, 100\);/,
		`workerTimer = setInterval(function(){
				if(!self.working){ self.launchWorkers.call(self, tree, binPolygon, config, progressCallback, displayCallback); self.working = true; }
				progressCallback(progress);
			}, 100);
			return true;`
	);

	const parallelLaunchWorkers = `
  var parallel = null;
  this.launchWorkers = async function(tree, binPolygon, config, progressCallback, displayCallback){
    if(GA === null){
      var adam = tree.slice(0);
      adam.sort((a, b) => Math.abs(GeometryUtil.polygonArea(b)) - Math.abs(GeometryUtil.polygonArea(a)));
      GA = new GeneticAlgorithm(adam, binPolygon, config);
    }
    var individual = null;
    for(var i=0; i<GA.population.length; i++){ if(!GA.population[i].fitness){ individual = GA.population[i]; break; } }
    if(individual === null){ GA.generation(); individual = GA.population[1]; }

    var placelist = individual.placement;
    var rotations = individual.rotation;
    var ids = placelist.map(p => p.id);
    placelist.forEach((p, i) => p.rotation = rotations[i]);

    var nfpPairs = [];
    var newCache = {};
    for(var i=0; i<placelist.length; i++){
      var part = placelist[i];
      var key = {A: -1, B: part.id, inside: true, Arotation: 0, Brotation: rotations[i]};
      if(!nfpCache[JSON.stringify(key)]) nfpPairs.push({ pair: {A: binPolygon, B: part, key} });
      else newCache[JSON.stringify(key)] = nfpCache[JSON.stringify(key)];
      
      for(var j=0; j<i; j++){
        var placed = placelist[j];
        var key = {A: placed.id, B: part.id, inside: false, Arotation: rotations[j], Brotation: rotations[i]};
        if(!nfpCache[JSON.stringify(key)]) nfpPairs.push({ pair: {A: placed, B: part, key} });
        else newCache[JSON.stringify(key)] = nfpCache[JSON.stringify(key)];
      }
    }
    nfpCache = newCache;

    if(!parallel) {
      if (!config.workerUrl) {
          try {
             const path = require('path');
             config.workerUrl = path.join(__dirname, 'nestWorker.js');
          } catch(e) {}
      }
      if (!config.workerUrl) throw new Error("SvgNest: config.workerUrl required.");
      parallel = new Parallel(config.workerUrl);
    }

    const nfpResults = await parallel.map(nfpPairs, 'nfp', { config });
    nfpResults.forEach(r => { if(r && r.value) nfpCache[r.key] = r.value; });

    const placeResults = await parallel.map([{ placelist, ids, rotations, nfpCache, binPolygon }], 'place', { config });
    const placements = placeResults.map(r => r.result);

    if(placements && placements.length > 0 && placements[0]){
      individual.fitness = placements[0].fitness;
      var bestresult = placements[0];
      if(!best || bestresult.fitness < best.fitness){
        best = bestresult;
        var placedArea = 0;
        var totalArea = 0;
        var numParts = placelist.length;
        var numPlacedParts = 0;
        for(var i=0; i<best.placements.length; i++){
          totalArea += Math.abs(GeometryUtil.polygonArea(binPolygon));
          for(var j=0; j<best.placements[i].length; j++){
            placedArea += Math.abs(GeometryUtil.polygonArea(tree[best.placements[i][j].id]));
            numPlacedParts++;
          }
        }
        displayCallback(this.applyPlacement(best.placements), placedArea/totalArea, numPlacedParts, numParts);
      } else {
        displayCallback();
      }
    }
    this.working = false;
  };
  `;

	const launchWorkersStart = body.indexOf("this.launchWorkers = function");
	const getPartsStart = body.indexOf("this.getParts = function");
	body = body.substring(0, launchWorkersStart) + parallelLaunchWorkers + body.substring(getPartsStart);

	return `${header}${body.trim()}\nexport { SvgNest };\nexport default SvgNest;`;
});

// Create src/index.js
fs.writeFileSync(path.join(srcDir, "index.js"), `import SvgNest from './svgnest.js';\nexport { SvgNest };\nexport default SvgNest;\n`);
