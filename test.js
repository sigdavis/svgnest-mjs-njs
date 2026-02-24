import fs from 'fs';
import SvgNest from './dist/svgnest.mjs'; // Import our newly built backend ESM module

const svgInput = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect id="bin" x="0" y="0" width="100" height="100" fill="none" stroke="black" />
  
  <rect x="0" y="0" width="20" height="20" fill="red" />
  <rect x="0" y="0" width="20" height="20" fill="green" />
  <rect x="0" y="0" width="20" height="20" fill="blue" />
</svg>
`;

console.log("1. Initializing SvgNest...");
const nest = new SvgNest();

console.log("2. Parsing SVG using JSDOM...");
const root = nest.parseSvg(svgInput);

console.log("3. Setting the Bin...");
const bin = root.querySelector('#bin');
nest.setBin(bin);

console.log("4. Configuring Worker Threads...");
nest.config({
  populationSize: 2,
  rotations: 1,
  // Point the parallel thread manager to our newly built backend worker!
  workerUrl: './dist/nestWorker.js' 
});

console.log("5. Starting the nesting algorithm (this might take a second)...");
nest.start(
  (progress) => {
    // You'll see this update as the worker threads calculate intersections
    console.log(`   Worker Progress: ${(progress * 100).toFixed(1)}%`);
  },
  (svgList, efficiency, placedCount, totalCount) => {
    if (svgList && svgList.length > 0) {
      console.log(`\n🎉 Success! Placed ${placedCount}/${totalCount} parts.`);
      console.log(`📈 Efficiency: ${(efficiency * 100).toFixed(2)}%`);
      
      // Because we are on the backend, we write the result to a file instead of the DOM
      const outputHtml = svgList[0].outerHTML;
      fs.writeFileSync('output.svg', outputHtml);
      
      console.log("💾 Saved the nested result to 'output.svg'!");
      
      // Stop the nest process and kill the worker threads
      nest.stop();
      process.exit(0);
    }
  }
);