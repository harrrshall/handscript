import { put, list, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';

const IS_LOCAL = !process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'public/uploads');

if (IS_LOCAL) {
    if (!fs.existsSync(LOCAL_UPLOAD_DIR)) {
        fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    }
}

export async function uploadFile(file: File | Blob | Buffer | string, filename: string): Promise<string> {
    const name = filename || `file-${nanoid()}`;

    if (IS_LOCAL) {
        const buffer = Buffer.isBuffer(file)
            ? file
            : typeof file === 'string'
                ? Buffer.from(file)
                : Buffer.from(await (file as Blob).arrayBuffer());

        // Ensure unique filename locally to mimic blob behavior
        const uniqueName = `${nanoid()}-${name}`;
        const filePath = path.join(LOCAL_UPLOAD_DIR, uniqueName);
        fs.writeFileSync(filePath, buffer);

        // Return a local URL (assuming standard Next.js public folder serving)
        return `http://localhost:3000/uploads/${uniqueName}`;
    } else {
        const blob = await put(name, file, { access: 'public' });
        return blob.url;
    }
}

export async function deleteFile(url: string) {
    if (IS_LOCAL) {
        if (url.startsWith('http://localhost:3000/uploads/')) {
            const filename = url.replace('http://localhost:3000/uploads/', '');
            const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    } else {
        await del(url);
    }
}
