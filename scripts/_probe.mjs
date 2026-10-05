import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, idle_timeout: 20 });
const userId = "81c18643-5f18-4afa-afa6-4d7cf5c3b46c";
const rows = await sql`
  select day, sleep_total_min from health_daily
  where user_id = ${userId}::uuid and data_origin = 'com.samsung.shealth'
    and sleep_total_min is not null
  order by day
`;
const nights = rows.map(r => ({ day: String(r.day).slice(0,10), min: Number(r.sleep_total_min) }));
console.log("nights with sleep:", nights.length);
for (const n of nights) console.log(`  ${n.day}  ${n.min} min  (${(n.min/60).toFixed(1)} h)`);

const last = nights.slice(-14);
const sorted = [...last.map(n => n.min)].sort((a,b)=>a-b);
const mid = sorted.length % 2 ? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
let owed = 0;
for (const n of last) { const gap = mid - n.min; if (gap > 0) owed += gap; }
console.log(`\nlast ${last.length} nights`);
console.log(`median: ${mid} min (${(mid/60).toFixed(1)} h)`);
console.log(`debt: ${owed} min = ${(owed/60).toFixed(1)} h`);
const small = last.filter(n => n.min < mid * 0.6);
console.log(`suspiciously short nights (<60% of median): ${small.map(n=>`${n.day}:${n.min}`).join(", ") || "none"}`);
await sql.end();
