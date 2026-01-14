import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile } from '@/lib/blob';
import { wrapWithTemplate } from '@/lib/html-template';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const { jobId } = await params;

    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // Fetch assembled content
        const keys = Array.from({ length: job.totalPages }, (_, i) => `job:${jobId}:page:${i}`);
        const results = await redis.mget(keys);
        let assembledHtml = '';
        for (let i = 0; i < results.length; i++) {
            const res = results[i] as any;
            if (res) {
                const parsed = typeof res === 'string' ? JSON.parse(res) : res;
                // Prefer HTML
                if (parsed.html) {
                    assembledHtml += parsed.html;
                } else if (parsed.typst) {
                    // Legacy support? Probably just ignore or wrap in p
                    assembledHtml += `<p>[Legacy Typst Content]</p>`;
                } else if (parsed.markdown) {
                    assembledHtml += `<p>${parsed.markdown}</p>`;
                }
                assembledHtml += '<div style="page-break-after: always;"></div>';
            }
        }

        let pdfUrl: string;

        // Call Modal.com endpoint if configured
        const modalEndpoint = process.env.MODAL_PDF_ENDPOINT;

        if (modalEndpoint) {
            try {
                console.log('Using Modal.com for PDF generation...');
                // Wrap full document
                const fullHtml = wrapWithTemplate(assembledHtml);

                const response = await fetch(modalEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ html: fullHtml }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Modal service failed: ${response.status} ${errorText}`);
                }

                const data = await response.json();
                const { pdf, error } = data;

                if (error) {
                    throw new Error(`Modal error: ${error}`);
                }

                if (!pdf) {
                    throw new Error('No PDF returned from Modal');
                }

                // Upload to Vercel Blob
                const pdfBuffer = Buffer.from(pdf, "base64");
                pdfUrl = await uploadFile(pdfBuffer, `${jobId}.pdf`);
            } catch (modalError) {
                console.error('Modal generation failed:', modalError);
                throw modalError;
            }
        } else {
            console.log('MODAL_PDF_ENDPOINT not set.');
            throw new Error('MODAL_PDF_ENDPOINT not set');
        }

        // Update Job
        job.status = 'complete';
        job.finalPdfUrl = pdfUrl;
        await redis.set(`job:${jobId}`, job, { ex: 30 * 24 * 60 * 60 });

        return NextResponse.json({
            success: true,
            pdfUrl,
        });

    } catch (error) {
        console.error('Render failed:', error);
        return NextResponse.json({ error: 'Render failed', details: String(error) }, { status: 500 });
    }
}

