import { createSignal, createMemo, createEffect } from 'solid-js';
import SvgNest from 'svgnest';

const App = () => {
  const [nestInstance, setNestInstance] = createSignal<SvgNest | null>(null);
  const [svgRoot, setSvgRoot] = createSignal<SVGElement | null>(null);
  const [selectedBin, setSelectedBin] = createSignal<SVGElement | null>(null);
  const [isNesting, setIsNesting] = createSignal(false);
  const [progress] = createSignal(0);
  const [resultSvgs, setResultSvgs] = createSignal<SVGElement[]>([]);
  const [stats, setStats] = createSignal({ efficiency: 0, placed: 0, total: 0 });

  const [viewTransform, setViewTransform] = createSignal({ x: 0, y: 0, scale: 1 });
  let isPanning = false;
  let hasMoved = false;
  let lastMousePos = { x: 0, y: 0 };
  let lastTouchDistance = 0;
  let lastTouchCenter = { x: 0, y: 0 };

  const handleWheel = (e: WheelEvent) => {
    if (isNesting()) return;
    
    const container = e.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    
    setViewTransform(prev => {
      const newScale = prev.scale * scaleFactor;
      const worldX = (mouseX - prev.x) / prev.scale;
      const worldY = (mouseY - prev.y) / prev.scale;
      return {
        scale: newScale,
        x: mouseX - worldX * newScale,
        y: mouseY - worldY * newScale
      };
    });
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (isNesting() || e.button !== 0) return;
    isPanning = true;
    hasMoved = false;
    lastMousePos = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMousePos.x;
    const dy = e.clientY - lastMousePos.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
    }
    setViewTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    lastMousePos = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isPanning = false;
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (isNesting()) return;
    hasMoved = false;
    if (e.touches.length === 1) {
      isPanning = true;
      lastMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      isPanning = false; // Stop panning when starting pinch
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
      lastTouchCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isNesting()) return;
    const container = e.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();

    if (e.touches.length === 1 && isPanning) {
      const dx = e.touches[0].clientX - lastMousePos.x;
      const dy = e.touches[0].clientY - lastMousePos.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      setViewTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      e.preventDefault(); // Prevent browser zoom/scroll
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      const scaleFactor = distance / lastTouchDistance;
      lastTouchDistance = distance;

      const relativeCenterX = centerX - rect.left;
      const relativeCenterY = centerY - rect.top;

      setViewTransform(prev => {
        const newScale = prev.scale * scaleFactor;
        const worldX = (relativeCenterX - prev.x) / prev.scale;
        const worldY = (relativeCenterY - prev.y) / prev.scale;
        return {
          scale: newScale,
          x: relativeCenterX - worldX * newScale,
          y: relativeCenterY - worldY * newScale
        };
      });
      
      // Also pan with the center move
      const panDx = centerX - lastTouchCenter.x;
      const panDy = centerY - lastTouchCenter.y;
      setViewTransform(prev => ({ ...prev, x: prev.x + panDx, y: prev.y + panDy }));
      lastTouchCenter = { x: centerX, y: centerY };
    }
  };

  const handleTouchEnd = () => {
    isPanning = false;
  };

  const [config, setConfig] = createSignal({
    spacing: 0,
    rotations: 4,
    populationSize: 10,
    mutationRate: 10,
    useHoles: false,
    exploreConcave: false,
    curveTolerance: 0.3,
    clipperScale: 10000000,
  });

  const handleFileUpload = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      
      const nest = new SvgNest();
      const root = nest.parseSvg(content);
      
      // Clear selection
      setSelectedBin(null);
      setResultSvgs([]);
      setStats({ efficiency: 0, placed: 0, total: 0 });
      
      setNestInstance(nest);
      setSvgRoot(root);
    };
    reader.readAsText(file);
  };

  const onSvgClick = (e: MouseEvent) => {
    if (isNesting() || hasMoved) return;
    
    let target = e.target as SVGElement;
    // Walk up to find a direct child of the SVG root if needed
    // but usually elements are direct children after parseSvg clean
    if (target.tagName === 'svg') return;

    // Remove previous highlights
    if (selectedBin()) {
      selectedBin()?.style.setProperty('stroke', '');
      selectedBin()?.style.setProperty('stroke-width', '');
    }

    setSelectedBin(target);
    target.style.setProperty('stroke', '#ff4757');
    target.style.setProperty('stroke-width', '2px');
  };

  const toggleNesting = () => {
    const nest = nestInstance();
    const bin = selectedBin();

    if (!nest || !bin) {
      alert('Please upload an SVG and select a bin element first!');
      return;
    }

    if (isNesting()) {
      nest.stop();
      setIsNesting(false);
    } else {
      setResultSvgs([]);
      
      nest.config({ ...config() });
      nest.setBin(bin);
      
      const started = nest.start(
        () => { /* progress not granular in parallel yet */ },
        (svgList, efficiency, placed, total) => {
          if (svgList && svgList.length > 0) {
            setResultSvgs(svgList);
            setStats({ efficiency, placed, total });
          }
        }
      );

      if (started) setIsNesting(true);
    }
  };

  return (
    <>
      <aside class="card" style={{ "overflow-y": 'auto', "max-height": '100%' }}>
        <h2 class="header">svgnest</h2>
        
        <section style={{ "margin-bottom": '20px' }}>
          <h3>1. Load SVG</h3>
          <input type="file" accept=".svg" onInput={handleFileUpload} disabled={isNesting()} />
        </section>

        <section style={{ "margin-bottom": '20px' }}>
          <h3>2. Configuration</h3>
          <div style={{ display: 'grid', "grid-template-columns": '1fr 80px', gap: '10px', "align-items": 'center' }}>
            <span style={{ "font-size": '0.9em' }}>Spacing</span>
            <input type="number" value={config().spacing} onInput={(e) => setConfig({ ...config(), spacing: +e.currentTarget.value })} disabled={isNesting()} />
            
            <span style={{ "font-size": '0.9em' }}>Rotations</span>
            <input type="number" value={config().rotations} onInput={(e) => setConfig({ ...config(), rotations: +e.currentTarget.value })} disabled={isNesting()} />
            
            <span style={{ "font-size": '0.9em' }}>Population</span>
            <input type="number" value={config().populationSize} onInput={(e) => setConfig({ ...config(), populationSize: +e.currentTarget.value })} disabled={isNesting()} />
            
            <span style={{ "font-size": '0.9em' }}>Mutation %</span>
            <input type="number" value={config().mutationRate} onInput={(e) => setConfig({ ...config(), mutationRate: +e.currentTarget.value })} disabled={isNesting()} />

            <div style={{ "grid-column": 'span 2', display: 'flex', gap: '15px', "margin-top": '5px' }}>
              <label style={{ display: 'flex', "align-items": 'center', gap: '5px', cursor: 'pointer' }}>
                <input type="checkbox" checked={config().exploreConcave} onChange={(e) => setConfig({ ...config(), exploreConcave: e.currentTarget.checked })} disabled={isNesting()} />
                <span style={{ "font-size": '0.9em' }}>Explore concave</span>
              </label>
              <label style={{ display: 'flex', "align-items": 'center', gap: '5px', cursor: 'pointer' }}>
                <input type="checkbox" checked={config().useHoles} onChange={(e) => setConfig({ ...config(), useHoles: e.currentTarget.checked })} disabled={isNesting()} />
                <span style={{ "font-size": '0.9em' }}>Use holes</span>
              </label>
            </div>
          </div>
        </section>

        <section>
          <button 
            onClick={toggleNesting} 
            disabled={!nestInstance() || !selectedBin()}
            style={{ 
              width: '100%', 
              padding: '12px', 
              background: isNesting() ? '#ff4757' : (!nestInstance() || !selectedBin() ? '#ccc' : '#2ed573'),
              color: 'white',
              border: 'none',
              "border-radius": '4px',
              cursor: (!nestInstance() || !selectedBin()) && !isNesting() ? 'not-allowed' : 'pointer',
              "font-weight": 'bold'
            }}
          >
            {isNesting() ? 'Stop nesting' : 'Start nesting'}
          </button>
          
          {isNesting() && progress() > 0 && (
            <div style={{ "margin-top": '10px' }}>
              <div>Progress: {(progress() * 100).toFixed(1)}%</div>
              <div style={{ background: '#eee', height: '8px', "border-radius": '4px', overflow: 'hidden' }}>
                <div style={{ background: '#2f3542', width: `${progress() * 100}%`, height: '100%' }}></div>
              </div>
            </div>
          )}
        </section>

        {stats().total > 0 && (
          <section style={{ "margin-top": '20px', padding: '10px', background: '#f1f2f6', "border-radius": '4px' }}>
            <strong>Results:</strong>
            <div>Efficiency: {(stats().efficiency * 100).toFixed(2)}%</div>
            <div>Placed: {stats().placed} / {stats().total} in {resultSvgs().length} {resultSvgs().length === 1 ? 'instance' : 'instances'}</div>
          </section>
        )}
      </aside>

      <main style={{ display: 'flex', "flex-direction": 'column', gap: '20px', "min-height": '0', "max-height": '100%' }}>
        <div class="card" style={{ flex: '1 0 400px', display: 'flex', "flex-direction": 'column', "min-height": '400px' }}>
          <div style={{ display: 'flex', "justify-content": 'space-between', "align-items": 'center' }}>
            <h3>Input viewer (click to set bin, drag to pan, scroll to zoom)</h3>
            <button onClick={() => setViewTransform({ x: 0, y: 0, scale: 1 })} style={{ "font-size": '0.8em', padding: '2px 8px' }}>Reset view</button>
          </div>
          <div 
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={onSvgClick}
            style={{ 
              border: '1px dashed #ccc', 
              flex: 1, 
              display: 'flex', 
              "align-items": 'center', 
              "justify-content": 'center',
              overflow: 'hidden',
              cursor: isNesting() ? 'default' : (isPanning ? 'grabbing' : 'grab'),
              position: 'relative',
              "min-height": '300px'
            }}
            ref={(el) => {
              // Update DOM when svgRoot changes
              createMemo(() => {
                const root = svgRoot();
                el.innerHTML = '';
                if (root) {
                  const wrapper = document.createElement('div');
                  wrapper.style.display = 'flex';
                  wrapper.style.alignItems = 'center';
                  wrapper.style.justifyContent = 'center';
                  wrapper.style.width = '100%';
                  wrapper.style.height = '100%';
                  wrapper.style.transformOrigin = '0 0';
                  wrapper.style.transition = isPanning ? 'none' : 'transform 0.1s ease-out';
                  
                  createEffect(() => {
                    const t = viewTransform();
                    wrapper.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
                  });

                  root.setAttribute('width', '100%');
                  root.setAttribute('height', '100%');
                  wrapper.appendChild(root);
                  el.appendChild(wrapper);
                }
              });
            }}
          />
        </div>

        <div class="card" style={{ flex: '1 0 400px', display: 'flex', "flex-direction": 'column', "min-height": '400px' }}>
          <h3>Result viewer</h3>
          <div 
            style={{ 
              border: '1px solid #eee', 
              flex: 1,
              display: 'grid', 
              "grid-template-columns": 'repeat(auto-fill, minmax(30%, 1fr))',
              gap: '15px',
              overflow: 'auto',
              background: '#fafafa',
              padding: '15px'
            }}
            ref={(el) => {
              createMemo(() => {
                const svgs = resultSvgs();
                el.innerHTML = '';
                svgs.forEach((svg) => {
                  const container = document.createElement('div');
                  container.style.width = '100%';
                  container.style.height = '250px';
                  container.style.background = 'white';
                  container.style.border = '1px solid #ddd';
                  container.style.display = 'flex';
                  container.style.padding = '5px';
                  container.style.boxSizing = 'border-box';
                  
                  svg.setAttribute('width', '100%');
                  svg.setAttribute('height', '100%');
                  container.appendChild(svg);
                  el.appendChild(container);
                });
              });
            }}
          />
        </div>
      </main>
    </>
  );
};

export default App;
