'use client';

import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

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
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const isFormValid = selectedFile && validateEmail(email);

    const handleFileSelect = (file: File) => setSelectedFile(file);

    const handleConvert = async () => {
        if (!selectedFile || !validateEmail(email)) {
            if (!validateEmail(email)) setEmailError("Please enter a valid email");
            return;
        }

        setIsProcessing(true);
        setProgress(0);
        setStatusText('Loading PDF...');

        try {
            const buffer = await selectedFile.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(buffer).promise;
            const totalPages = pdf.numPages;

            if (totalPages > 200) throw new Error('PDF too large. Max 200 pages.');

            const keys: string[] = [];
            const BATCH_SIZE = 5;

            for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
                const batchEnd = Math.min(i + BATCH_SIZE - 1, totalPages);
                setStatusText(`Uploading ${i}-${batchEnd} of ${totalPages}...`);

                const batchPromises = [];
                for (let p = i; p <= batchEnd; p++) {
                    batchPromises.push((async () => {
                        const page = await pdf.getPage(p);
                        const viewport = page.getViewport({ scale: 1.0 });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        if (!context) throw new Error('Canvas context failed');
                        // @ts-ignore
                        await page.render({ canvasContext: context, viewport }).promise;

                        return new Promise<{ index: number, key: string }>((resolve, reject) => {
                            canvas.toBlob(async (blob) => {
                                if (!blob) { reject(new Error('Blob failed')); return; }
                                try {
                                    const key = `uploads/${Date.now()}-${Math.random().toString(36).substring(7)}-${p}.jpg`;
                                    const presignRes = await fetch('/api/get-upload-url', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ key, contentType: 'image/jpeg' })
                                    });
                                    if (!presignRes.ok) throw new Error('Failed to get upload URL');
                                    const { uploadUrl } = await presignRes.json();
                                    const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
                                    if (!uploadRes.ok) throw new Error('Upload failed');
                                    resolve({ index: p - 1, key });
                                } catch (e) { reject(e); }
                            }, 'image/jpeg', 0.85);
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
                body: JSON.stringify({ pageCount: totalPages, pageManifest: keys, email })
            });
            if (!res.ok) throw new Error('Failed to create job');
            const data = await res.json();
            onJobCreated(data.jobId, keys, email);
        } catch (err: any) {
            console.error(err);
            onError(err.message || 'Failed to process PDF');
            setIsProcessing(false);
        }
    };

    return (
        <div className="w-full max-w-md px-2 sm:px-0">
            <div className="card-premium rounded-2xl overflow-hidden">
                <div className="p-4 sm:p-6">
                    {isProcessing ? (
                        <div className="space-y-3">
                            <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                            </div>
                            <p className="text-xs text-cool-grey text-center animate-pulse">{statusText}</p>
                        </div>
                    ) : (
                        <>
                            {/* Dropzone - Compact */}
                            <div className="relative group/dropzone cursor-pointer">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="application/pdf"
                                    className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
                                    onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileSelect(file); }}
                                />
                                <div className={`border border-dashed rounded-lg p-6 sm:p-8 text-center transition-all ${selectedFile ? 'border-primary bg-primary/5' : 'border-slate-300 group-hover/dropzone:border-primary/50 group-hover/dropzone:bg-slate-50'
                                    }`}>
                                    <div className={`w-10 h-10 sm:w-12 sm:h-12 mx-auto rounded-full flex items-center justify-center mb-3 transition-transform group-hover/dropzone:scale-105 ${selectedFile ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-cool-grey group-hover/dropzone:text-primary'
                                        }`}>
                                        <span className="material-symbols-outlined text-xl sm:text-2xl">{selectedFile ? 'description' : 'cloud_upload'}</span>
                                    </div>
                                    {selectedFile ? (
                                        <>
                                            <p className="text-sm font-medium text-slate-grey truncate">{selectedFile.name}</p>
                                            <p className="text-[10px] text-cool-grey mt-1">Click to change</p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm font-medium text-slate-grey">Drop PDF or <span className="text-primary underline">browse</span></p>
                                            <p className="text-[10px] text-cool-grey/60 mt-1">Up to 200 pages</p>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Email + Convert - Compact */}
                            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-cool-grey/50 text-lg">mail</span>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                                        placeholder="Your email"
                                        className={`w-full pl-10 pr-3 py-2.5 text-sm border rounded-lg bg-slate-50/50 text-slate-grey placeholder-cool-grey/40 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all ${emailError ? 'border-red-400' : 'border-slate-200'
                                            }`}
                                    />
                                </div>
                                {emailError && <p className="text-[10px] text-red-500">{emailError}</p>}
                                <button
                                    onClick={handleConvert}
                                    disabled={!isFormValid}
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${isFormValid
                                        ? 'text-white bg-primary hover:bg-primary/90 shadow-lg shadow-primary/15 hover:shadow-primary/25 hover:-translate-y-0.5 btn-primary'
                                        : 'text-cool-grey/50 bg-slate-100 cursor-not-allowed'
                                        }`}
                                >
                                    <span className="material-symbols-outlined text-base">auto_fix_high</span>
                                    Convert to PDF
                                </button>
                                <p className="text-center text-[10px] text-cool-grey/50 flex items-center justify-center gap-1">
                                    <span className="material-symbols-outlined text-[12px]">lock</span> handscriptnotes.vercel.app
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
