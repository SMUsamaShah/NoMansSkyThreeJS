// Column-anomaly scan per horizontal band: WHERE in the frame does the seam live?
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const f = process.argv[2];
const p = PNG.sync.read(readFileSync(f));
const { width: W, height: H, data } = p;
const bands = [[0,0.12],[0.12,0.25],[0.25,0.38],[0.38,0.50],[0.50,0.62],[0.62,0.75]];
for (const [a,b] of bands) {
  const y0 = Math.round(H*a), y1 = Math.round(H*b);
  const col = new Float64Array(W);
  for (let x=0;x<W;x++){let s=0;for(let y=y0;y<y1;y++){const i=(y*W+x)*4;s+=data[i]+data[i+1]+data[i+2];}col[x]=s/((y1-y0)*3);}
  let best=0,bx=0;
  for (let x=4;x<W-4;x++){const d=col[x]-(col[x-3]+col[x+3])/2;if(Math.abs(d)>Math.abs(best)){best=d;bx=x;}}
  console.log(`  y ${(a*100).toFixed(0)}-${(b*100).toFixed(0)}%  worst column x=${bx} ${best.toFixed(2)}/255`);
}
