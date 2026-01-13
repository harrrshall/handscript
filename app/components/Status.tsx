'use client';

import { useState, useEffect, useRef } from 'react';

interface StatusProps {
    jobId: string;
    onComplete: () => void;
    onError: (msg: string) => void;
    onReset: () => void;
}

export default function Status({ jobId, onComplete, onError, onReset }: StatusProps) {
    const [status, setStatus] = useState<string>('initializing');
    const [progress, setProgress] = useState({ total: 1, completed: 0, failed: 0 });
    const [finalUrl, setFinalUrl] = useState<string | null>(null);

    const hasTriggeredAssembly = useRef(false);
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
        if (progress.total > 0 && !processingStarted.current && status !== 'complete') {
            processingStarted.current = true;

            const processPages = async () => {
                const CONCURRENCY = 10;
                const pages = Array.from({ length: progress.total }, (_, i) => i);

                for (let i = 0; i < pages.length; i += CONCURRENCY) {
                    const batch = pages.slice(i, i + CONCURRENCY);
                    await Promise.all(batch.map(pageIndex =>
                        fetch('/api/process', {
                            method: 'POST',
                            body: JSON.stringify({ jobId, pageIndex })
                        })
                    ));
                }
            };

            processPages().catch(console.error);
        }
    }, [progress.total, jobId, status]);

    useEffect(() => {
        if (
            !hasTriggeredAssembly.current &&
            progress.total > 0 &&
            progress.completed + progress.failed === progress.total &&
            status === 'processing'
        ) {
            hasTriggeredAssembly.current = true;
            (async () => {
                try {
                    setStatus('assembling');
                    const assembleRes = await fetch(`/api/jobs/${jobId}/assemble`, { method: 'POST' });
                    if (!assembleRes.ok) throw new Error('Assembly failed');

                    setStatus('rendering');
                    const renderRes = await fetch(`/api/jobs/${jobId}/render`, { method: 'POST' });
                    if (!renderRes.ok) throw new Error('Render failed');
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
