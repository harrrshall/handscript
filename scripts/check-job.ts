
import 'dotenv/config';
import { redis } from '../lib/redis';

async function main() {
    console.log('Checking job: PgGJV97Fvc-BdgWpzPGof');
    const job = await redis.get('job:PgGJV97Fvc-BdgWpzPGof');
    console.log('Job Data:', JSON.stringify(job, null, 2));
}

main().catch(console.error);
