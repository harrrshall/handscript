import { POST } from '../../app/api/get-upload-url/route';
import { NextRequest } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mock S3 Client and Presigner
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

describe('POST /api/get-upload-url', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('API-UPL-001: Returns upload URL for valid request', async () => {
        (getSignedUrl as jest.Mock).mockResolvedValue('https://s3.example.com/upload-key');

        const req = new NextRequest('http://localhost:3000/api/get-upload-url', {
            method: 'POST',
            body: JSON.stringify({ key: 'test/file.png', contentType: 'image/png' }),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toHaveProperty('uploadUrl', 'https://s3.example.com/upload-key');
        expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
            Key: 'test/file.png',
            ContentType: 'image/png',
        }));
    });

    it('API-UPL-002: Missing key rejected', async () => {
        const req = new NextRequest('http://localhost:3000/api/get-upload-url', {
            method: 'POST',
            body: JSON.stringify({ contentType: 'image/png' }),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data).toHaveProperty('error', 'Invalid key');
    });

    it('API-UPL-003: Invalid key type rejected', async () => {
        const req = new NextRequest('http://localhost:3000/api/get-upload-url', {
            method: 'POST',
            body: JSON.stringify({ key: 123, contentType: 'image/png' }),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data).toHaveProperty('error', 'Invalid key');
    });

    it('API-UPL-005: Content-Type respected', async () => {
        (getSignedUrl as jest.Mock).mockResolvedValue('https://s3.example.com/upload-key');

        const req = new NextRequest('http://localhost:3000/api/get-upload-url', {
            method: 'POST',
            body: JSON.stringify({ key: 'test/file.txt', contentType: 'text/plain' }),
        });

        await POST(req);

        expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
            ContentType: 'text/plain',
        }));
    });

    it('API-UPL-007: B2 credentials error (Internal Server Error)', async () => {
        (getSignedUrl as jest.Mock).mockRejectedValue(new Error('S3 Error'));

        const req = new NextRequest('http://localhost:3000/api/get-upload-url', {
            method: 'POST',
            body: JSON.stringify({ key: 'test/file.png' }),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data).toHaveProperty('error', 'Failed to generate upload URL');
    });
});
