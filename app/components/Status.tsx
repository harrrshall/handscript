'use client';

import { useState, useEffect, useRef } from 'react';

interface StatusProps {
    jobId: string;
    images?: string[];
    email?: string; // Add email prop
    onComplete: () => void;
    onError: (msg: string) => void;
    onReset: () => void;
}

export default function Status({ jobId, images, email, onComplete, onError, onReset }: StatusProps) {
    const [status, setStatus] = useState<string>('initializing');
    const [progress, setProgress] = useState({ total: 1, completed: 0, failed: 0 });
    const [finalUrl, setFinalUrl] = useState<string | null>(null);

    const hasTriggeredFinalize = useRef(false);
    const processingStarted = useRef(false);

    useEffect(() => {
        if (email) {
            return;
        }

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

    // Processing is now handled server-side via QStash.
    // We only poll for status updates here.

    // If email is provided, we can just show success immediately or let user leave
    const showEmailConfirmation = !!email;

    if (showEmailConfirmation) {
        return (
            <div className="w-full text-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold">You're All Set!</h2>
                <p className="text-gray-600 dark:text-gray-300">
                    Your PDF will be delivered to <strong>{email}</strong> within 1-2 minutes.
                </p>
                <p className="text-sm text-gray-500">
                    You can safely close this page. We'll handle everything from here.
                </p>
                <button onClick={onReset} className="mt-6 px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors">
                    Convert Another File
                </button>
            </div>
        )
    }

    if (finalUrl) {
        return (
            <div className="w-full text-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold">Conversion Complete!</h2>
                {email && <p className="text-gray-500">Also sent to {email}</p>}
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
