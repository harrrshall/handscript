'use client';

import { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Start the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface UploadProps {
    onJobCreated: (jobId: string) => void;
    onError: (msg: string) => void;
}

export default function Upload({ onJobCreated, onError }: UploadProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = async (file: File) => {
        setIsProcessing(true);
        setProgress(0);
        setStatusText('Loading PDF...');

        try {
            const buffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(buffer).promise;
            const totalPages = pdf.numPages;

            if (totalPages > 200) {
                throw new Error('PDF too large. Max 200 pages allowed.');
            }

            const imageUrls: string[] = [];

            // Process pages concurrently in batches
            const BATCH_SIZE = 5;

            for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
                const batchEnd = Math.min(i + BATCH_SIZE - 1, totalPages);
                setStatusText(`Extracting pages ${i}-${batchEnd} of ${totalPages}...`);

                const batchPromises = [];
                for (let p = i; p <= batchEnd; p++) {
                    batchPromises.push((async () => {
                        const page = await pdf.getPage(p);
                        const viewport = page.getViewport({ scale: 2.0 }); // 2.0 scale for better OCR
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        if (!context) throw new Error('Canvas context failed');

                        // @ts-ignore - types mismatch in latest pdfjs-dist
                        await page.render({ canvasContext: context, viewport }).promise;

                        // Convert to blob
                        const blob = await new Promise<Blob>((resolve, reject) => {
                            canvas.toBlob((b) => {
                                if (b) resolve(b);
                                else reject(new Error('Canvas to Blob failed'));
                            }, 'image/png');
                        });

                        // Upload
                        const formData = new FormData();
                        formData.append('file', blob, `page-${p}.png`);

                        const res = await fetch('/api/upload', { method: 'POST', body: formData });
                        if (!res.ok) throw new Error('Upload failed');
                        const data = await res.json();
                        return { index: p - 1, url: data.url };
                    })());
                }

                const batchResults = await Promise.all(batchPromises);
                batchResults.forEach(r => imageUrls[r.index] = r.url);

                setProgress(Math.round((batchEnd / totalPages) * 50)); // First 50% is upload
            }

            setStatusText('Creating job...');
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageCount: totalPages,
                    pageManifest: imageUrls
                })
            });

            if (!res.ok) throw new Error('Failed to create job');
            const data = await res.json();

            onJobCreated(data.jobId);
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
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-6 px-6 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:opacity-90 transition-opacity"
                    >
                        Select File
                    </button>
                </>
            )}
        </div>
    );
}
