export interface Config {
  clipperScale?: number;
  curveTolerance?: number;
  spacing?: number;
  rotations?: number;
  populationSize?: number;
  mutationRate?: number;
  useHoles?: boolean;
  exploreConcave?: boolean;
  workerUrl?: string;
}

export interface Placement {
  id: number;
  x: number;
  y: number;
  rotation: number;
}

export class SvgNest {
  constructor();
  parseSvg(svgString: string): SVGElement;
  setBin(element: SVGElement): void;
  config(c?: Config): Config;
  start(
    progressCallback: (progress: number) => void,
    displayCallback: (
      svgList: SVGElement[] | null,
      efficiency: number,
      placedParts: number,
      totalParts: number
    ) => void
  ): boolean;
  stop(): void;
}

export default SvgNest;