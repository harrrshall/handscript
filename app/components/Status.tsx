'use client';

import { useState, useEffect, useRef } from 'react';

interface StatusProps {
    jobId: string;
    images?: string[];
    onComplete: () => void;
    onError: (msg: string) => void;
    onReset: () => void;
}

export default function Status({ jobId, images, onComplete, onError, onReset }: StatusProps) {
    const [status, setStatus] = useState<string>('initializing');
    const [progress, setProgress] = useState({ total: 1, completed: 0, failed: 0 });
    const [finalUrl, setFinalUrl] = useState<string | null>(null);

    const hasTriggeredFinalize = useRef(false);
    const processingStarted = useRef(false);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;
        const POLLING_INTERVAL = 1000;

        const poll = async () => {
            try {
                const res = await fetch(`/api/jobs/${jobId}/status`);
                if (!res.ok) {
                    if (res.status === 404) throw new Error('Job not found');
                    return;
                }
                const data = await res.json();

                setStatus(data.status);
                setProgress({
                    total: data.progress.total || 1,
                    completed: data.progress.completed || 0,
                    failed: data.progress.failed || 0
                });

                if (data.status === 'complete' && data.finalPdfUrl) {
                    setFinalUrl(data.finalPdfUrl);
                    onComplete();
                } else if (data.status === 'failed') {
                    throw new Error(data.error || 'Job failed');
                }
            } catch (err: any) {
                clearInterval(intervalId);
                onError(err.message);
            }
        };

        intervalId = setInterval(poll, POLLING_INTERVAL);
        return () => clearInterval(intervalId);
    }, [jobId, onComplete, onError]);

    useEffect(() => {
        if (images && images.length > 0 && !processingStarted.current && status !== 'complete') {
            processingStarted.current = true;

            const processBatches = async () => {
                const BATCH_SIZE = 20; // Increased to 20 thanks to Signed URLs & B2
                const batches: { start: number, keys: string[] }[] = [];

                // 'images' prop now contains B2 keys based on Upload.tsx changes
                for (let i = 0; i < images.length; i += BATCH_SIZE) {
                    batches.push({
                        start: i,
                        keys: images.slice(i, i + BATCH_SIZE)
                    });
                }

                // Browser limit is roughly 6-10 per domain.
                const CONCURRENCY_LIMIT = 5;

                // Helper for concurrency
                const pool = async () => {
                    const results = [];
                    const executing: Promise<any>[] = [];

                    for (const batch of batches) {
                        const p = fetch('/api/process-batch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                jobId,
                                startPageIndex: batch.start,
                                keys: batch.keys
                            })
                        }).then(r => {
                            if (!r.ok) {
                                return r.json().then(errData => {
                                    throw new Error(errData.details || `Batch failed: ${r.statusText}`);
                                }).catch(e => {
                                    // Fallback if json parsing fails
                                    throw new Error(`Batch failed: ${r.statusText}`);
                                });
                            }
                            return r.json();
                        });

                        results.push(p);
                        const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
                        executing.push(e);

                        if (executing.length >= CONCURRENCY_LIMIT) {
                            await Promise.race(executing);
                        }
                    }
                    return Promise.all(results);
                };

                try {
                    await pool();
                    // All batches sent and resolved
                } catch (e: any) {
                    console.error("Batch processing error", e);
                    // Continue to polling? Or finalize anyway?
                }
            };

            processBatches().catch(console.error);
        }
    }, [images, jobId, status]);

    useEffect(() => {
        if (
            !hasTriggeredFinalize.current &&
            progress.total > 0 &&
            // Check if done
            (progress.completed + progress.failed >= progress.total) &&
            status === 'processing'
        ) {
            hasTriggeredFinalize.current = true;
            (async () => {
                try {
                    setStatus('finalizing');
                    const res = await fetch(`/api/jobs/${jobId}/finalize`, { method: 'POST' });
                    if (!res.ok) throw new Error('Finalize failed');
                    // Finalize should update status to complete, which polling will pick up
                } catch (err: any) {
                    onError(err.message);
                }
            })();
        }
    }, [progress, status, jobId, onError]);

    if (finalUrl) {
        return (
            <div className="w-full text-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold">Conversion Complete!</h2>
                <a
                    href={finalUrl}
                    download="handscript-notes.pdf"
                    className="inline-block px-8 py-3 bg-black dark:bg-white text-white dark:text-black rounded-lg font-bold shadow-lg hover:scale-105 transition-transform"
                >
                    Download PDF
                </a>
                <button onClick={onReset} className="block w-full text-sm text-gray-500 hover:underline mt-4">
                    Convert another file
                </button>
            </div>
        );
    }

    const percent = Math.round((progress.completed / progress.total) * 100);

    return (
        <div className="w-full space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h3 className="text-xl font-bold capitalize">{status.replace('_', ' ')}</h3>
                    <p className="text-gray-500">
                        {status === 'processing' ? `Processing page ${progress.completed} of ${progress.total}` : 'Please wait...'}
                    </p>
                </div>
                <span className="text-2xl font-mono">{percent}%</span>
            </div>

            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-4 overflow-hidden">
                <div
                    className="bg-blue-600 h-full transition-all duration-500 ease-out"
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}
