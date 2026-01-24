import fs from "fs";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.join(__dirname, "..");
const srcDir = path.join(rootDir, "src");

if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir);
}
if (!fs.existsSync(path.join(srcDir, "util"))) {
  fs.mkdirSync(path.join(srcDir, "util"));
}

function transformFile(relPath, transformFn) {
  const fullPath = path.join(rootDir, relPath);
  let content = fs.readFileSync(fullPath, "utf8");
  content = transformFn(content);
  const destPath = path.join(srcDir, relPath);
  fs.writeFileSync(destPath, content);
}

// Transform Clipper
transformFile("util/clipper.js", (content) => {
  return `const ClipperLib = (function() {
    var module = { exports: {} };
    ${content}
    return module.exports;
  })();
  export default ClipperLib;
  export { ClipperLib };`;
});

// 2. GeometryUtil
transformFile("util/geometryutil.js", (content) => {
  let body = content.substring(
    content.indexOf("{") + 1,
    content.lastIndexOf("}")
  );
  body = body.replace(/root.GeometryUtil\s*=\s*/, "const GeometryUtil = ");
  return `
${body}
export { GeometryUtil };
export default GeometryUtil;`;
});

// Transform Matrix
transformFile("util/matrix.js", (content) => {
  let transformed = content.replace(
    /\(typeof window !== 'undefined' \? window : self\)\.Matrix = Matrix;/,
    ""
  );
  return `${transformed}\nexport { Matrix };\nexport default Matrix;`;
});

// Transform SvgParser
transformFile("svgparser.js", (content) => {
  let body = content.substring(
    content.indexOf("{") + 1,
    content.lastIndexOf("}")
  );
  // SvgParser uses GeometryUtil and Matrix
  body =
    `import GeometryUtil from './util/geometryutil.js';\nimport Matrix from './util/matrix.js';\n` +
    body;

  body = body.replace(/function SvgParser\(/g, "function _SvgParser(");
  body = body.replace(/SvgParser.prototype/g, "_SvgParser.prototype");
  body = body.replace(/new SvgParser\(/g, "new _SvgParser(");

  // Helper for JSDOM compatibility
  const getPointsHelper = `
	_SvgParser.prototype.getPoints = function(element) {
		var points = [];
		if (element.points && element.points.numberOfItems !== undefined) {
			for (var i = 0; i < element.points.numberOfItems; i++) {
				var p = element.points.getItem(i);
				points.push({ x: p.x, y: p.y });
			}
		} else {
			var pointsAttr = element.getAttribute('points');
			if (pointsAttr) {
				var pairs = pointsAttr.trim().split(/[\\s,]+/);
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

  // Inject helper after constructor
  body = body.replace(
    /this.conf\s*=\s*\{[\s\S]*?\};\s*\}/,
    `$&${getPointsHelper}`
  );

  // Replace loops in applyTransform and polygonify
  body = body.replace(
    /let transformedPoly = ''\s*for\(var i=0; i<element\.points\.numberOfItems; i\+\+\)\{[\s\S]*?transformedPoly \+= pointPairString;[\s\S]*?\}/,
    `let transformedPoly = ''
					var points = this.getPoints(element);
					for(var i=0; i<points.length; i++){
						var point = points[i];
						var transformed = transform.calc(point.x, point.y);
						const pointPairString = \`\${transformed[0]},\${transformed[1]} \`;
						transformedPoly += pointPairString;
					}`
  );

  body = body.replace(
    /for\(i=0; i<element\.points\.numberOfItems; i\+\+\)\{\s*var point = element\.points\.getItem\(i\);\s*poly\.push\(\{ x: point\.x, y: point\.y \}\);\s*\}/,
    `var points = this.getPoints(element);
				for(i=0; i<points.length; i++){
					poly.push({ x: points[i].x, y: points[i].y });
				}`
  );

  body = body.replace(
    /root.SvgParser\s*=\s*\{([\s\S]*?)\};/,
    "const SvgParser = {$1};"
  );

  return `${body}\nexport { SvgParser };\nexport default SvgParser;`;
});

// 5. PlacementWorker
transformFile("util/placementworker.js", (content) => {
  let transformed =
    `import GeometryUtil from './geometryutil.js';
import ClipperLib from './clipper.js';
` + content;
  transformed = transformed.replace(
    /\(typeof window !== 'undefined' \? window : self\)\.PlacementWorker = PlacementWorker;/,
    ""
  );
  transformed = transformed.replace(
    /var self = global.env.self;/,
    "var self = this;"
  );
  transformed = transformed.replace(
    /global.env.searchEdges/g,
    "this.config.exploreConcave"
  );
  transformed = transformed.replace(
    /global.env.useHoles/g,
    "this.config.useHoles"
  );
  transformed +=
    "\nexport { PlacementWorker };\nexport default PlacementWorker;";
  return transformed;
});

// 6. Create src/util/nestWorker.js
const nestWorkerContent = `
import GeometryUtil from './geometryutil.js';
import ClipperLib from './clipper.js';
import PlacementWorker from './placementworker.js';

function toClipperCoordinates(polygon) {
  var clone = [];
  for (var i = 0; i < polygon.length; i++) {
    clone.push({ X: polygon[i].x, Y: polygon[i].y });
  }
  return clone;
}

function toNestCoordinates(polygon, scale) {
  var clone = [];
  for (var i = 0; i < polygon.length; i++) {
    clone.push({ x: polygon[i].X / scale, y: polygon[i].Y / scale });
  }
  return clone;
}

function minkowskiDifference(A, B, clipperScale) {
  var Ac = toClipperCoordinates(A);
  ClipperLib.JS.ScaleUpPath(Ac, clipperScale);
  var Bc = toClipperCoordinates(B);
  ClipperLib.JS.ScaleUpPath(Bc, clipperScale);
  for (var i = 0; i < Bc.length; i++) {
    Bc[i].X *= -1;
    Bc[i].Y *= -1;
  }
  var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
  var clipperNfp;
  var largestArea = null;
  for (var i = 0; i < solution.length; i++) {
    var n = toNestCoordinates(solution[i], clipperScale);
    var sarea = GeometryUtil.polygonArea(n);
    if (largestArea === null || largestArea > sarea) {
      clipperNfp = n;
      largestArea = sarea;
    }
  }
  for (var i = 0; i < clipperNfp.length; i++) {
    clipperNfp[i].x += B[0].x;
    clipperNfp[i].y += B[0].y;
  }
  return [clipperNfp];
}

self.onmessage = function(e) {
  const { type, pair, config, placelist, ids, rotations, nfpCache, binPolygon } = e.data;

  if (type === 'nfp') {
    const { A, B, key } = pair;
    const searchEdges = config.exploreConcave;
    const useHoles = config.useHoles;

    const rotatedA = GeometryUtil.rotatePolygon(A, key.Arotation);
    const rotatedB = GeometryUtil.rotatePolygon(B, key.Brotation);

    let nfp;
    if (key.inside) {
      if (GeometryUtil.isRectangle(rotatedA, 0.001)) {
        nfp = GeometryUtil.noFitPolygonRectangle(rotatedA, rotatedB);
      } else {
        nfp = GeometryUtil.noFitPolygon(rotatedA, rotatedB, true, searchEdges);
      }
      if (nfp && nfp.length > 0) {
        for (let i = 0; i < nfp.length; i++) {
          if (GeometryUtil.polygonArea(nfp[i]) > 0) nfp[i].reverse();
        }
      }
    } else {
      if (searchEdges) {
        nfp = GeometryUtil.noFitPolygon(rotatedA, rotatedB, false, searchEdges);
      } else {
        nfp = minkowskiDifference(rotatedA, rotatedB, config.clipperScale);
      }
      if (nfp && nfp.length > 0) {
        for (let i = 0; i < nfp.length; i++) {
          if (GeometryUtil.polygonArea(nfp[i]) > 0) nfp[i].reverse();
          if (i > 0 && GeometryUtil.pointInPolygon(nfp[i][0], nfp[0])) {
            if (GeometryUtil.polygonArea(nfp[i]) < 0) nfp[i].reverse();
          }
        }
      }
    }
    self.postMessage({ type: 'nfp', key: JSON.stringify(key), value: nfp });
  } else if (type === 'place') {
    const worker = new PlacementWorker(binPolygon, placelist, ids, rotations, config, nfpCache);
    const result = worker.placePaths(placelist);
    self.postMessage({ type: 'place', result });
  }
};
`;
const nestWorkerPath = path.join(srcDir, "util/nestWorker.js");
fs.writeFileSync(nestWorkerPath, nestWorkerContent);

// Bundle nestWorker.js so it's a standalone file
import { buildSync } from "esbuild";
buildSync({
  entryPoints: [nestWorkerPath],
  bundle: true,
  outfile: nestWorkerPath,
  allowOverwrite: true,
  format: "iife", // Use IIFE for standalone worker
  target: "esnext",
});

// 7. Create src/util/parallel.js
const parallelContent = `
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

export class Parallel {
  constructor(workerUrl) {
    this.workerUrl = workerUrl;
    this.maxWorkers = isNode ? 4 : (navigator.hardwareConcurrency || 4);
    this.workers = [];
    this.idleWorkers = [];
  }

  async map(data, type, commonData) {
    return new Promise((resolve) => {
      const results = [];
      let finished = 0;
      let started = 0;
      const total = data.length;

      const checkFinished = () => {
        if (finished === total) {
          resolve(results);
        }
      };

      const runNext = () => {
        while (started < total && this.idleWorkers.length > 0) {
          const worker = this.idleWorkers.pop();
          const index = started++;
          const item = data[index];

          worker.onmessage = (e) => {
            results[index] = e.data;
            finished++;
            this.idleWorkers.push(worker);
            runNext();
            checkFinished();
          };

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
    let worker;
    if (isNode) {
      // Use a dynamic import that bundlers won't try to resolve statically
      const moduleName = ['web', 'worker'].join('-');
      const { default: Worker } = await import(/* @vite-ignore */ moduleName);
      worker = new Worker(this.workerUrl);
    } else {
      // Use standard Worker for bundled IIFE worker script
      // Ensure the URL is valid by creating a URL object if it's not absolute
      let url = this.workerUrl;
      try {
        if (!url.startsWith('http') && !url.startsWith('blob') && !url.startsWith('/')) {
           url = new URL(url, window.location.href).href;
        }
      } catch(e) {}
      worker = new Worker(url);
    }
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
  let header = `import SvgParser from './svgparser.js';
import GeometryUtil from './util/geometryutil.js';
import ClipperLib from './util/clipper.js';
import { Parallel } from './util/parallel.js';

`;

  // Extract body: from the start of the IIFE content to the end
  const iifeStart = content.indexOf("(function");
  const firstBrace = content.indexOf("{", iifeStart);
  // Get everything from the first brace to the end of the file
  let body = content.substring(firstBrace + 1);

  // Robustly remove the trailing part of the IIFE: })(this); or })(window); and the closing brace of the IIFE
  // We match the last '}' that is part of the IIFE structure
  // Note: svgnest.js uses })(window);
  // util/geometryutil.js uses })(typeof window ...);
  // We handle both generic cases or specific ones.

  // Try removing the standard window one first
  let newBody = body.replace(/\}\s*\)\s*\(\s*window\s*\)\s*;?\s*$/, "");

  if (newBody === body) {
    // Try the more complex one if the first didn't match
    newBody = body.replace(
      /\}\s*\)\s*\((this|typeof\s+window\s*!==\s*'undefined'\s*\?\s*window\s*:\s*self)\)\s*;?\s*$/,
      ""
    );
  }
  body = newBody;

  // Clean up any remaining artifacts
  body = body.trim();

  // Remove global assignment
  body = body.replace(/root\.SvgNest\s*=\s*new SvgNest\(\);/, "");

  body = body.replace(/this\.parsesvg = function/g, "this.parseSvg = function");
  body = body.replace(/this\.setbin = function/g, "this.setBin = function");

  body = body.replace(
    /exploreConcave:\s*false\s*\};/,
    "exploreConcave: false };"
  );

  const configStart = body.indexOf("this.config = function(c){");
  const startStart = body.indexOf(
    "this.start = function(progressCallback, displayCallback){"
  );

  const configReplacement = `this.config = function(c){
			if(!c){
				return config;
			}
			
			if(c.curveTolerance && !GeometryUtil.almostEqual(parseFloat(c.curveTolerance), 0)){
				config.curveTolerance =  parseFloat(c.curveTolerance);
			}
			
			if('spacing' in c){
				config.spacing = parseFloat(c.spacing);
			}
			
			if(c.rotations && parseInt(c.rotations) > 0){
				config.rotations = parseInt(c.rotations);
			}
			
			if(c.populationSize && parseInt(c.populationSize) > 2){
				config.populationSize = parseInt(c.populationSize);
			}
			
			if(c.mutationRate && parseInt(c.mutationRate) > 0){
				config.mutationRate = parseInt(c.mutationRate);
			}
			
			if('useHoles' in c){
				config.useHoles = !!c.useHoles;
			}
			
			if('exploreConcave' in c){
				config.exploreConcave = !!c.exploreConcave;
			}

			if(c.workerUrl){
				config.workerUrl = c.workerUrl;
			}
			
			SvgParser.config({ tolerance: config.curveTolerance});
			
			best = null;
			nfpCache = {};
			binPolygon = null;
			GA = null;
						
			return config;
		}
		
		// progressCallback is called when progress is made
		// displayCallback is called when a new placement has been made
		`;

  body =
    body.substring(0, configStart) +
    configReplacement +
    body.substring(startStart);

  // Add binPolygon.id = -1 fixes
  body = body.replace(
    /binPolygon\s*=\s*SvgParser.polygonify\(bin\);[\s\S]*?if\s*\(!binPolygon\s*\|\|\s*binPolygon\.length\s*<\s*3\)\{/,
    `binPolygon = SvgParser.polygonify(bin);
			binPolygon = this.cleanPolygon(binPolygon);
			binPolygon.id = -1;
						
			if(!binPolygon || binPolygon.length < 3){`
  );

  body = body.replace(
    /if\s*\(config\.spacing\s*>\s*0\)\{[\s\S]*?binPolygon\s*=\s*offsetBin\.pop\(\);[\s\S]*?\}\s*\}\s*\/\/\s*put bin on origin/,
    `if(config.spacing > 0){
				var offsetBin = this.polygonOffset(binPolygon, -0.5*config.spacing);
				if(offsetBin.length == 1){
					binPolygon = offsetBin.pop();
				}
			}
			binPolygon.id = -1;
			// put bin on origin`
  );

  body = body.replace(
    /workerTimer = setInterval\(function\(\)\{[\s\S]*?progressCallback\(progress\);\s*\}, 100\);/,
    `workerTimer = setInterval(function(){
				if(!self.working){
					self.launchWorkers.call(self, tree, binPolygon, config, progressCallback, displayCallback);
					self.working = true;
				}
				
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
    for(var i=0; i<GA.population.length; i++){
      if(!GA.population[i].fitness){
        individual = GA.population[i];
        break;
      }
    }
    if(individual === null){
      GA.generation();
      individual = GA.population[1];
    }

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

    nfpCache = newCache;

    if(!parallel) {
      // Default workerUrl resolution that works in most environments
      let workerUrl = config.workerUrl;
      if (!workerUrl) {
        try {
          // In the bundled version, nestWorker.js is in the same directory
          workerUrl = new URL('./nestWorker.js', import.meta.url).href;
        } catch (e) {
          // Fallback
          workerUrl = 'nestWorker.js'; 
        }
      }
      parallel = new Parallel(workerUrl);
    }

    const nfpResults = await parallel.map(nfpPairs, 'nfp', { config });
    nfpResults.forEach(r => {
      if(r && r.value) nfpCache[r.key] = r.value;
    });

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
  body =
    body.substring(0, launchWorkersStart) +
    parallelLaunchWorkers +
    body.substring(getPartsStart);

  // Clean up any remaining artifacts from IIFE stripping at the very end
  body = body.trim();

  return `${header}${body}
export { SvgNest };
export default SvgNest;`;
});

// Create src/index.js
const indexContent = `import SvgNest from './svgnest.js';
export { SvgNest };
export default SvgNest;
`;
fs.writeFileSync(path.join(srcDir, "index.js"), indexContent);

console.log("Transformation complete!");
