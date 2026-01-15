'use client';

import { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Start the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs`;

interface UploadProps {
    onJobCreated: (jobId: string, images: string[], email?: string) => void;
    onError: (msg: string) => void;
}

export default function Upload({ onJobCreated, onError }: UploadProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [email, setEmail] = useState("");
    const [emailError, setEmailError] = useState("");

    const validateEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const processFile = async (file: File) => {
        if (!validateEmail(email)) {
            setEmailError("Please enter a valid email address");
            return;
        }

        setIsProcessing(true);
        // ... rest of logic
        setProgress(0);
        setStatusText('Loading PDF...');

        try {
            const buffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(buffer).promise;
            const totalPages = pdf.numPages;

            if (totalPages > 200) {
                throw new Error('PDF too large. Max 200 pages allowed.');
            }

            const keys: string[] = [];
            const BATCH_SIZE = 5;

            // Extract and upload pages
            for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
                const batchEnd = Math.min(i + BATCH_SIZE - 1, totalPages);
                setStatusText(`Uploading pages ${i}-${batchEnd} of ${totalPages}... (Please keep tab open)`);

                const batchPromises = [];
                for (let p = i; p <= batchEnd; p++) {
                    batchPromises.push((async () => {
                        const page = await pdf.getPage(p);
                        const viewport = page.getViewport({ scale: 1.5 }); // 1.5 scale for speed/quality balance
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        if (!context) throw new Error('Canvas context failed');

                        // @ts-ignore
                        await page.render({ canvasContext: context, viewport }).promise;

                        return new Promise<{ index: number, key: string }>((resolve, reject) => {
                            canvas.toBlob(async (blob) => {
                                if (!blob) {
                                    reject(new Error('Canvas to Blob failed'));
                                    return;
                                }
                                try {
                                    const key = `uploads/${Date.now()}-${Math.random().toString(36).substring(7)}-${p}.png`;

                                    // Get presigned URL
                                    const presignRes = await fetch('/api/get-upload-url', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ key, contentType: 'image/png' })
                                    });

                                    if (!presignRes.ok) throw new Error('Failed to get upload URL');
                                    const { uploadUrl } = await presignRes.json();

                                    // Upload to B2
                                    const uploadRes = await fetch(uploadUrl, {
                                        method: 'PUT',
                                        body: blob,
                                        headers: { 'Content-Type': 'image/png' }
                                    });

                                    if (!uploadRes.ok) throw new Error('Failed to upload to storage');
                                    resolve({ index: p - 1, key });
                                } catch (e) {
                                    reject(e);
                                }
                            }, 'image/png');
                        });
                    })());
                }

                const batchResults = await Promise.all(batchPromises);
                batchResults.forEach(r => keys[r.index] = r.key);

                setProgress(Math.round((batchEnd / totalPages) * 100));
            }

            setStatusText('Creating job...');

            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageCount: totalPages,
                    pageManifest: keys,
                    email: email,
                })
            });

            if (!res.ok) throw new Error('Failed to create job');
            const data = await res.json();

            // Pass keys to parent for processing
            onJobCreated(data.jobId, keys, email);

        } catch (err: any) {
            console.error(err);
            onError(err.message || 'Failed to process PDF');
            setIsProcessing(false);
        }
    };

    return (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 flex flex-col items-center justify-center text-center transition-colors hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-900/50">

            {isProcessing ? (
                <div className="w-full max-w-sm space-y-4">
                    <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                        <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                    </div>
                    <p className="text-sm text-gray-500 font-medium animate-pulse">{statusText}</p>
                </div>
            ) : (
                <>
                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Upload PDF</h3>
                    <p className="mt-1 text-sm text-gray-500">Up to 200 pages</p>

                    <div className="mt-6 w-full max-w-xs text-left">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Email for delivery
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                if (emailError) setEmailError("");
                            }}
                            placeholder="your@email.com"
                            className={`w-full px-4 py-2 rounded-lg border ${emailError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none`}
                        />
                        {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
                    </div>

                    <input
                        type="file"
                        ref={fileInputRef}
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) processFile(file);
                        }}
                    />
                    <button
                        onClick={() => {
                            if (!validateEmail(email)) {
                                setEmailError("Email is required");
                                return;
                            }
                            fileInputRef.current?.click();
                        }}
                        className="mt-4 px-6 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:opacity-90 transition-opacity"
                    >
                        Select File
                    </button>
                </>
            )}
        </div>
    );
}
