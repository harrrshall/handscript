
import 'dotenv/config';
import { redis } from '../lib/redis';

async function main() {
    console.log('Fetching collected emails...');
    const emails = await redis.smembers('collected_emails');
    console.log('Total Emails:', emails.length);
    console.log('Emails:', emails);
}

main().catch(console.error);
