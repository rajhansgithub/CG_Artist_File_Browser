import fs from 'fs';
import path from 'path';
import { listDrivesNode, readDirectoryNode, readFileBufferNode } from './benchmark_node.mjs';

async function main() {
  const args = process.argv.slice(2);
  const testDir = args[0] || 'D:\\CG_ARTIST_TOOL_RESOURCES';
  const stressParent = args[1] || null;

  // 1. List drives (10 iterations)
  const driveTimes = [];
  let driveCount = 0;
  for (let i = 0; i < 10; i++) {
    const res = await listDrivesNode();
    driveCount = res.drives.length;
    driveTimes.push(res.elapsed);
  }
  const avgDriveMs = driveTimes.reduce((a, b) => a + b, 0) / driveTimes.length;

  // 2. Directory scan on D:\CG_ARTIST_TOOL_RESOURCES (20 iterations)
  const scanTimes = [];
  let itemCount = 0;
  for (let i = 0; i < 20; i++) {
    const res = await readDirectoryNode(testDir, { filter: 'all', search: '', recursive: false });
    itemCount = res.itemsCount;
    scanTimes.push(res.elapsed);
  }
  const avgScanMs = scanTimes.reduce((a, b) => a + b, 0) / scanTimes.length;

  // 3. File buffer reads on CG Assets (5 iterations each)
  const filesToTest = [
    'amber_phantom_bottle_v001.usd',
    'amber_phantom_promo_render_v001.exr',
    'Bus Garage.exr',
    'final.fbx',
    'Meshy_AI_Silver_Garden_Goblet_0925221452_generate.fbx',
    'Mumbai_Dry_Gin_Art_Deco_Front_Back_Labels_1935.png',
    'Rajasthan_Reserve_Snell_Roundhand_Whisky_Front_Back_Labels_v2.png',
    'RajhansDewangan_Film_Showreel_2024_v002.mp4',
    'Tomoco Studio.exr',
  ];

  const fileReads = [];
  for (const fname of filesToTest) {
    const fpath = path.join(testDir, fname);
    if (fs.existsSync(fpath)) {
      const reads = [];
      let sz = 0;
      for (let i = 0; i < 5; i++) {
        const r = await readFileBufferNode(fpath);
        sz = r.sizeMB;
        reads.push(r);
      }
      const avgMs = reads.reduce((a, b) => a + b.elapsed, 0) / reads.length;
      const avgTp = reads.reduce((a, b) => a + b.throughputMBs, 0) / reads.length;
      fileReads.push({
        file_name: fname,
        size_mb: sz,
        read_ms: avgMs,
        throughput_mb_s: avgTp
      });
    }
  }

  // 4. Stress tests if provided
  const stressScans = [];
  if (stressParent && fs.existsSync(stressParent)) {
    const entries = fs.readdirSync(stressParent, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const fullDir = path.join(stressParent, ent.name);
        const times = [];
        let cnt = 0;
        for (let i = 0; i < 10; i++) {
          const res = await readDirectoryNode(fullDir, { filter: 'all', search: '', recursive: true, maxDepth: 5 });
          cnt = res.itemsCount;
          times.push(res.elapsed);
        }
        const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
        stressScans.push({
          name: ent.name,
          files_count: cnt,
          scan_ms: avgMs
        });
      }
    }
  }

  const report = {
    drives_time_ms: avgDriveMs,
    drives_count: driveCount,
    cg_res_scan_ms: avgScanMs,
    cg_res_count: itemCount,
    file_reads: fileReads,
    stress_scans: stressScans
  };

  console.log('BENCHMARK_JSON_START');
  console.log(JSON.stringify(report, null, 2));
  console.log('BENCHMARK_JSON_END');
}

main().catch(console.error);
