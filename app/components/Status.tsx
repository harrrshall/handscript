'use client';

import { useState, useEffect, useRef } from 'react';

interface StatusProps {
    jobId: string;
    images?: string[];
    email?: string;
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

    // If email is provided, show success immediately
    const showEmailConfirmation = !!email;

    if (showEmailConfirmation) {
        return (
            <div className="w-full bg-white rounded-2xl shadow-soft p-12 text-center space-y-6 border border-white/60 ring-1 ring-slate-900/5">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <span className="material-symbols-outlined text-green-600 text-4xl">check_circle</span>
                </div>
                <h2 className="text-2xl font-display font-bold text-slate-grey">You're All Set!</h2>
                <p className="text-cool-grey font-light">
                    Your PDF will be delivered to <strong className="font-medium text-slate-grey">{email}</strong> within 1-2 minutes.
                </p>
                <p className="text-sm text-cool-grey/60 font-light">
                    You can safely close this page. We'll handle everything from here.
                </p>
                <button
                    onClick={onReset}
                    className="mt-6 px-8 py-3 bg-slate-100 hover:bg-slate-200 text-slate-grey rounded-lg transition-colors font-medium"
                >
                    Convert Another File
                </button>
            </div>
        );
    }

    if (finalUrl) {
        return (
            <div className="w-full bg-white rounded-2xl shadow-soft p-12 text-center space-y-6 border border-white/60 ring-1 ring-slate-900/5">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <span className="material-symbols-outlined text-green-600 text-4xl">check_circle</span>
                </div>
                <h2 className="text-2xl font-display font-bold text-slate-grey">Conversion Complete!</h2>
                {email && <p className="text-cool-grey font-light">Also sent to {email}</p>}
                <a
                    href={finalUrl}
                    download="handscript-notes.pdf"
                    className="inline-flex items-center justify-center px-8 py-3.5 bg-primary text-white rounded-lg font-semibold shadow-lg shadow-primary/10 hover:shadow-primary/20 hover:-translate-y-0.5 transition-all duration-200"
                >
                    <span className="material-symbols-outlined mr-2">download</span>
                    Download PDF
                </a>
                <button onClick={onReset} className="block w-full text-sm text-cool-grey hover:text-primary font-light mt-4 transition-colors">
                    Convert another file
                </button>
            </div>
        );
    }

    const percent = Math.round((progress.completed / progress.total) * 100);

    return (
        <div className="w-full bg-white rounded-2xl shadow-soft p-12 border border-white/60 ring-1 ring-slate-900/5 space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h3 className="text-xl font-display font-bold text-slate-grey capitalize">{status.replace('_', ' ')}</h3>
                    <p className="text-cool-grey font-light">
                        {status === 'processing' ? `Processing page ${progress.completed} of ${progress.total}` : 'Please wait...'}
                    </p>
                </div>
                <span className="text-3xl font-display font-bold text-primary">{percent}%</span>
            </div>

            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                <div
                    className="bg-primary h-full transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${percent}%` }}
                />
            </div>

            <div className="flex items-center justify-center gap-2 text-cool-grey/60">
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                <span className="text-sm font-light">Processing your notes...</span>
            </div>
        </div>
    );
}
