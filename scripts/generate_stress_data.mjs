import fs from 'fs';
import path from 'path';

const TARGET_DIR = 'D:\\CG_ARTIST_TOOL_RESOURCES\\_benchmark_temp_suite';

function generate() {
  if (fs.existsSync(TARGET_DIR)) {
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  // 1. 100 files
  const dir100 = path.join(TARGET_DIR, '01_batch_100_files');
  fs.mkdirSync(dir100, { recursive: true });
  for (let i = 1; i <= 100; i++) {
    const ext = i % 4 === 0 ? '.exr' : (i % 4 === 1 ? '.fbx' : (i % 4 === 2 ? '.png' : '.usd'));
    const pad = String(i).padStart(4, '0');
    fs.writeFileSync(path.join(dir100, `asset_turn_${pad}${ext}`), `dummy content for benchmark asset ${pad}`);
  }

  // 2. 1,000 files
  const dir1000 = path.join(TARGET_DIR, '02_batch_1000_files');
  fs.mkdirSync(dir1000, { recursive: true });
  for (let i = 1; i <= 1000; i++) {
    const ext = i % 5 === 0 ? '.exr' : (i % 5 === 1 ? '.fbx' : (i % 5 === 2 ? '.png' : (i % 5 === 3 ? '.hdr' : '.glb')));
    const pad = String(i).padStart(4, '0');
    fs.writeFileSync(path.join(dir1000, `render_seq_${pad}${ext}`), `dummy frame data ${pad}`);
  }

  // 3. 5,000 files nested across departments
  const dir5000 = path.join(TARGET_DIR, '03_nested_5000_assets');
  const depts = ['models', 'textures', 'lookdev', 'lighting_exr', 'cache_usd'];
  for (const dept of depts) {
    fs.mkdirSync(path.join(dir5000, dept), { recursive: true });
  }

  for (let i = 1; i <= 5000; i++) {
    const dept = depts[i % depts.length];
    const ext = dept === 'models' ? '.fbx' : (dept === 'textures' ? '.png' : (dept === 'lookdev' ? '.gltf' : (dept === 'lighting_exr' ? '.exr' : '.usd')));
    const pad = String(i).padStart(5, '0');
    fs.writeFileSync(path.join(dir5000, dept, `element_${pad}${ext}`), `dummy production data ${pad}`);
  }

  console.log('Generated test folders in', TARGET_DIR);
}

generate();
